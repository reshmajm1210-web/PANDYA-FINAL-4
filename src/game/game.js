import * as THREE from 'three';
import '../../progression.js';

import { ARENA, ASSETS, CAMERA, COMBAT, LEVELS, WEAPONS } from '../config.js';
import { AssetLoader } from '../engine/assets.js';
import { Sfx } from '../engine/sfx.js';
import { Arena } from '../world/arena.js';
import { Effects } from './effects.js';
import { EnemyBrain } from './ai.js';
import { Fighter, WeaponRack } from './fighter.js';
import { Hud } from '../ui/hud.js';
import { Controls } from '../ui/controls.js';

const randomInt = ([min, max]) => Math.floor(min + Math.random() * (max - min + 1));
const isCoarse = matchMedia('(hover: none) and (pointer: coarse)').matches;

/**
 * The match itself: owns the renderer, both fighters, the AI, combat rules,
 * lives / rounds / loot and the frame loop.
 */
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.hud = new Hud();
    this.sfx = new Sfx();
    this.clock = new THREE.Clock();
    this.running = false;
    this.state = 'boot'; // boot | ready | fighting | interlude | over
    this.projected = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isCoarse,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarse ? 1.6 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.loader = new AssetLoader({ onProgress: (value) => this.hud.setProgress(0.15 + value * 0.8) });
    this.arena = new Arena(this.renderer, this.loader);
    this.effects = new Effects(this.arena.scene);
    if (isCoarse) this.arena.sun.shadow.mapSize.set(1024, 1024);

    this.loot = { coins: 0, gems: 0 };
    this.lives = COMBAT.lives;
    this.round = 1;
    this.cooldowns = { attack: 0, heal: 0, bow: 0, weapon: 0, dodge: 0, special: 0 };
    this.healCharges = COMBAT.heal.charges;
    this.quickDrawFrom = null;
    this.points = 0;
    this.specialCharge = 0;
    this.paused = false;
    this.matchStartedAt = 0;
    this.kills = 0;
    this.wallet = Game.loadWallet();

    // Which Kingdom Path level are we fighting? Comes from `?level=N`.
    const levelParam = parseInt(new URLSearchParams(location.search).get('level'), 10);
    this.level = Number.isFinite(levelParam) ? Math.min(9, Math.max(1, levelParam)) : 1;
    this.levelDef = LEVELS[this.level - 1] ?? LEVELS[0];

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clock.getDelta();
    });
  }

  /* ---------------------------------------------------------- hero wallet */

  static WALLET_KEY = 'pandya.wallet';
  static LOCKOUT_KEY = 'pandya.lockoutUntil';
  static UNLOCK_KEY = 'pandyaUnlockedLevel';

  static loadWallet() {
    try {
      const saved = JSON.parse(localStorage.getItem(Game.WALLET_KEY) ?? 'null');
      if (saved && Number.isFinite(saved.coins) && Number.isFinite(saved.pearls)) return saved;
    } catch {
      /* corrupted / unavailable storage → fresh wallet */
    }
    // Fresh players start the campaign with 100 coins and 50 pearls; the same
    // wallet is shown on every page (home, map, battle…).
    return { coins: 100, pearls: 50 };
  }

  /** Real-time lockout used after using all lives. Returns remaining ms (0 = free). */
  static getLockoutRemaining() {
    let until = NaN;
    try {
      until = Number(localStorage.getItem(Game.LOCKOUT_KEY));
    } catch {
      /* storage unavailable */
    }
    if (!Number.isFinite(until)) return 0;
    return Math.max(0, until - Date.now());
  }

  static isLocked() {
    return Game.getLockoutRemaining() > 0;
  }

  /** Starts a fresh 5-hour lockout (called when the player uses every life). */
  static beginLockout() {
    try {
      localStorage.setItem(Game.LOCKOUT_KEY, String(Date.now() + COMBAT.lockoutMs));
    } catch {
      /* storage unavailable — no lockout */
    }
  }

  static clearLockout() {
    try {
      localStorage.removeItem(Game.LOCKOUT_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  static loadUnlocked() {
    return window.PandyaProgress.unlocked();
  }

  /** Credits the hero for a level won, persists the wallet and unlocks the next. */
  rewardHero() {
    this.wallet.coins += COMBAT.reward.coins;
    this.wallet.pearls += COMBAT.reward.pearls;
    try {
      localStorage.setItem(Game.WALLET_KEY, JSON.stringify(this.wallet));
    } catch {
      /* private mode etc. — wallet still lives for this session */
    }
    this.hud.setWallet(this.wallet);

    // Unlock the next Kingdom Path level (a level only opens after the last win).
    const nextUnlocked = window.PandyaProgress.completeLevel(this.level);

    return { ...COMBAT.reward, unlocked: nextUnlocked };
  }

  /* ------------------------------------------------------------------ boot */

  async boot() {
    // A level only opens after the previous one is won. Direct links to a
    // locked level are sent back to the Kingdom Path map.
    if (this.level > Game.loadUnlocked()) {
      window.location.href = 'map.html';
      return;
    }

    this.hud.setProgress(0.08, 'Summoning the kings…');
    const rack = new WeaponRack(this.loader);
    const [heroGltf, villainGltf] = await Promise.all([
      this.loader.load(ASSETS.hero),
      this.loader.load(ASSETS.villain),
      rack.preload(),
    ]);
    this.rack = rack;

    this.hud.setProgress(0.92, 'Raising the banners…');

    this.player = new Fighter({
      gltf: heroGltf,
      rack,
      side: 'player',
      height: ARENA.fighterHeight,
      startX: ARENA.playerStart,
      maxHp: COMBAT.maxHp,
    });
    // Each Kingdom Path level gets a tougher (but winnable) enemy.
    this.enemyMaxHp = Math.round(COMBAT.maxHp * (0.9 + (this.level - 1) * 0.05));
    this.enemy = new Fighter({
      gltf: villainGltf,
      rack,
      side: 'enemy',
      height: ARENA.fighterHeight * 1.04,
      startX: ARENA.enemyStart,
      maxHp: this.enemyMaxHp,
    });
    this.enemy.hp = this.enemyMaxHp;
    this.enemy.setWeaponById('sword');
    this.arena.scene.add(this.player.root, this.enemy.root);

    // Announce the level's enemy name/title on the enemy card.
    const enemyName = document.querySelector('[data-enemy-name]');
    if (enemyName) enemyName.textContent = this.levelDef.name;
    this.hud.setLevel(this.level, this.levelDef.title);

    this.brain = new EnemyBrain({
      self: this.enemy,
      target: this.player,
      actions: {
        move: (direction) => this.enemy.setMove(direction),
        attack: () => this.enemyAttack(),
        block: (on) => (on ? this.enemy.startBlock() : this.enemy.stopBlock()),
        dodge: () => {
          const ok = this.enemy.dodge({ distance: 1.4, direction: -1, invulnerable: 0.45, clampX: (x) => THREE.MathUtils.clamp(x, ARENA.bounds.min, ARENA.bounds.max) });
          if (ok) this.effects.dust(new THREE.Vector3(this.enemy.x, 0.02, 0), 14);
        },
        rage: () => this.enemyRage(),
      },
    });

    this.controls = new Controls({
      onMove: (direction) => this.player.setMove(direction),
      onAction: (name) => this.playerAction(name),
      onHold: (name, down) => {
        if (name !== 'defend') return;
        this.hud.setHeld('defend', down);
        if (down) this.player.startBlock();
        else this.player.stopBlock();
      },
    });
    this.controls.setEnabled(false);

    await this.arena.buildSkyline();
    await this.arena.buildBackdrop();
    this.hud.setProgress(1, 'Ready');
    this.hud.setWeapon(this.player.weapon);
    this.hud.setLives(this.lives);
    this.hud.setCooldown('special', 1);
    this.hud.setWallet(this.wallet);
    this.hud.setHp('player', this.player.hp, this.player.maxHp);
    this.hud.setHp('enemy', this.enemy.hp, this.enemy.maxHp);
    this.resize();

    // Render one frame behind the veil so the first visible frame is warm.
    this.renderer.render(this.arena.scene, this.arena.camera);
    await this.hud.hideLoading();
    this.hud.showStart();
    this.state = 'ready';
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());

    this.hud.el.play.addEventListener('click', () => this.startMatch());
    this.hud.el.again.addEventListener('click', () => this.continueLevel());
    this.hud.el.retry.addEventListener('click', () => this.replay());
    this.hud.el.map.addEventListener('click', () => this.backToMap());
    if (this.hud.el.lockedMap) this.hud.el.lockedMap.addEventListener('click', () => this.backToMap());
    this.hud.el.pause.addEventListener('click', () => this.togglePause());
    this.hud.el.resume.addEventListener('click', () => this.togglePause(false));

    // Honour the 5-hour lockout: if every life was spent, block the duel.
    if (Game.isLocked()) {
      this.hud.showLocked(Game.getLockoutRemaining());
      this.state = 'over';
    }
  }

  /* ------------------------------------------------------- level navigation */

  backToMap() {
    window.location.href = 'map.html';
  }

  continueLevel() {
    if (this.level < 9 && this.level + 1 <= Game.loadUnlocked()) {
      window.location.href = `battle.html?level=${this.level + 1}`;
    } else {
      // Milestone character selection (or final clear) returns to the map.
      window.location.href = 'map.html';
    }
  }

  replay() {
    if (Game.isLocked()) {
      this.hud.showLocked(Game.getLockoutRemaining());
      return;
    }
    this.restart();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.arena.resize(width, height);
    this.effects.setViewport(height * this.renderer.getPixelRatio(), CAMERA.fov);
  }

  /* ----------------------------------------------------------- match flow */

  async startMatch() {
    if (Game.isLocked()) {
      this.hud.showLocked(Game.getLockoutRemaining());
      return;
    }
    this.sfx.unlock();
    await this.hud.hideStart();
    this.hud.showHud();
    this.hud.setRound(this.round);
    this.hud.setLoot(this.loot);
    this.hud.setPoints(this.points);
    this.matchStartedAt = performance.now();
    this.state = 'interlude';
    this.hud.announce('Round ' + this.round);
    setTimeout(() => {
      if (this.state !== 'interlude') return;
      this.hud.announce('Fight!');
      this.state = 'fighting';
      this.controls.setEnabled(true);
    }, 1250);
  }

  restart() {
    this.hud.hideResult();
    this.lives = COMBAT.lives;
    this.round = 1;
    this.loot = { coins: 0, gems: 0 };
    this.healCharges = COMBAT.heal.charges;
    this.cooldowns = { attack: 0, heal: 0, bow: 0, weapon: 0, dodge: 0, special: 0 };
    this.points = 0;
    this.specialCharge = 0;
    this.kills = 0;
    this.hud.setCooldown('special', 1);
    this.player.revive();
    this.enemy.revive();
    this.player.setWeaponById('sword');
    this.enemy.setWeaponById('sword');
    this.brain.reset(0);
    this.hud.setLives(this.lives);
    this.hud.setLoot(this.loot);
    this.hud.setHp('player', this.player.hp, this.player.maxHp);
    this.hud.setHp('enemy', this.enemy.hp, this.enemy.maxHp);
    this.hud.setWeapon(this.player.weapon);
    this.hud.setRound(this.round);
    this.startMatch();
  }

  /* -------------------------------------------------------- player actions */

  playerAction(name) {
    if (name === 'pause') return this.togglePause();
    if (this.state !== 'fighting' || this.player.dead) return;
    if (name === 'attack') this.playerAttack();
    else if (name === 'dodge') this.playerDodge();
    else if (name === 'special') this.playerSpecial();
    else if (name === 'weapon') this.cycleWeapon();
    else if (name === 'heal') this.playerHeal();
    else if (name === 'bow') this.playerBow();
  }

  playerAttack() {
    const weapon = this.player.weapon;
    if (weapon.ranged) return this.playerBow();
    if (this.cooldowns.attack > 0 || this.player.busy || this.player.blocking) return;

    const duration = this.player.attack(weapon, { onImpact: () => this.resolveMelee(this.player, this.enemy, weapon) });
    if (!duration) return;
    this.cooldowns.attack = duration * 0.72;
    this.attackCooldownMax = this.cooldowns.attack;
    this.sfx.swing();
    this.brain.onPlayerAttack();

    // Swoosh sits where the blade travels.
    const point = this.player.handPoint(weapon.hand, new THREE.Vector3());
    this.player.after(duration * (weapon.impactAt ?? 0.45) * 0.7, () => {
      this.effects.swoosh(point.setY(1.25), this.player.facing, weapon.trail);
    });
  }

  playerBow() {
    if (this.cooldowns.bow > 0 || this.player.busy || this.player.blocking) return;
    const bow = WEAPONS.find((weapon) => weapon.id === 'bow');

    // Quick-draw: swap to the bow for the shot, then back to the old weapon.
    if (this.player.weapon.id !== 'bow') {
      this.quickDrawFrom = this.player.weaponIndex;
      this.player.setWeaponById('bow');
      this.hud.setWeapon(this.player.weapon);
    }

    const duration = this.player.attack(bow, {
      onImpact: () => {
        const from = this.player.handPoint('left', new THREE.Vector3());
        const to = this.enemy.chestPoint(new THREE.Vector3());
        this.sfx.bow();
        this.effects.arrow(from, to, {
          onHit: () => this.applyDamage(this.player, this.enemy, bow.damage, { ranged: true }),
        });
      },
    });
    if (!duration) return;

    this.cooldowns.bow = COMBAT.bowCooldown;
    this.bowCooldownMax = COMBAT.bowCooldown;
    this.brain.onPlayerAttack();

    if (this.quickDrawFrom !== null) {
      const restore = this.quickDrawFrom;
      this.quickDrawFrom = null;
      this.player.after(duration * 1.05, () => {
        if (this.player.dead) return;
        this.player.weaponIndex = restore;
        this.player.equip(WEAPONS[restore]);
        this.hud.setWeapon(this.player.weapon);
      });
    }
  }

  /** Evasive roll away from the enemy (villain pack "slide attack" clip). */
  playerDodge() {
    if (this.cooldowns.dodge > 0 || this.player.busy || this.player.blocking) return;
    const duration = this.player.dodge({
      distance: COMBAT.dodge.distance,
      direction: -1,
      invulnerable: COMBAT.dodge.invulnerable,
      clampX: (x) => THREE.MathUtils.clamp(x, ARENA.bounds.min, ARENA.bounds.max),
    });
    if (!duration) return;
    this.cooldowns.dodge = COMBAT.dodge.cooldown;
    this.dodgeCooldownMax = COMBAT.dodge.cooldown;
    this.sfx.swap();
    this.effects.dust(new THREE.Vector3(this.player.x, 0.02, 0), 18);
    this.player.after(duration * 0.35, () => this.effects.dust(new THREE.Vector3(this.player.x, 0.02, 0), 12));
  }

  /** Charged jump attack (villain pack "jump attack" clip). Unlocks after a few landed hits. */
  playerSpecial() {
    if (this.cooldowns.special > 0 || this.player.busy || this.player.blocking) return;
    if (this.specialCharge < COMBAT.special.charge) {
      this.hud.announce(`Special charging ${this.specialCharge}/${COMBAT.special.charge}`, { danger: true });
      return;
    }
    const weapon = { ...this.player.weapon, clip: 'special', damage: COMBAT.special.damage, range: COMBAT.special.range, speed: 1, impactAt: 0.55 };
    const duration = this.player.attack(weapon, {
      onImpact: () => {
        this.arena.addShake(0.6);
        this.effects.burst(new THREE.Vector3(this.player.x + this.player.facing * 1.2, 0.3, 0), { count: 50, color: '#ffd86b', speed: 5, gravity: -2, life: 0.8 });
        this.resolveMelee(this.player, this.enemy, weapon);
        this.addPoints(COMBAT.points.special);
      },
    });
    if (!duration) return;
    this.specialCharge = 0;
    this.cooldowns.special = COMBAT.special.cooldown;
    this.specialCooldownMax = COMBAT.special.cooldown;
    this.sfx.swing();
    this.brain.onPlayerAttack();
    this.hud.announce('Special!');
    this.effects.burst(this.player.chestPoint(new THREE.Vector3()), { count: 30, color: '#ffe27a', speed: 3, life: 0.5 });
  }

  togglePause(force) {
    const next = force ?? !this.paused;
    if (next && this.state !== 'fighting' && this.state !== 'interlude') return;
    this.paused = next;
    this.hud.setPaused(next);
    this.controls.setEnabled(!next && this.state === 'fighting');
    if (next) this.player.setMove(0);
  }

  addPoints(amount) {
    this.points += amount;
    this.hud.setPoints(this.points);
  }

  playerHeal() {
    if (this.cooldowns.heal > 0 || this.player.busy || this.player.blocking) return;
    if (this.healCharges <= 0) {
      this.hud.announce('No elixir left', { danger: true });
      return;
    }
    this.healCharges -= 1;
    this.cooldowns.heal = COMBAT.heal.cooldown;
    this.healCooldownMax = COMBAT.heal.cooldown;

    const before = this.player.hp;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + COMBAT.heal.amount);
    const gained = Math.round(this.player.hp - before);
    this.hud.setHp('player', this.player.hp, this.player.maxHp);
    this.sfx.heal();
    this.effects.heal(this.player.chestPoint(new THREE.Vector3()));
    this.floater(this.player, `+${gained}`, 'heal');
    this.hud.announce('Elixir of Madurai');
    if (this.player.has('powerUp')) this.player.oneShotClip('powerUp', { state: 'cast' });
  }

  cycleWeapon() {
    if (this.cooldowns.weapon > 0 || this.player.busy || this.player.blocking) return;
    this.cooldowns.weapon = 0.28;
    const weapon = this.player.cycleWeapon();
    this.hud.setWeapon(weapon);
    this.sfx.swap();
    this.hud.announce(weapon.name);
    this.effects.burst(this.player.handPoint(weapon.hand, new THREE.Vector3()), {
      count: 18,
      color: weapon.trail,
      speed: 2.4,
      life: 0.4,
    });
  }

  /**
   * Live weapon calibration, handy from the browser console:
   *
   *   game.tuneWeapon({ rotation: [0, 90, 0], offset: [0, 0.05, 0] })
   *   game.tuneWeapon({ align: 'forearm', length: 1.3, grip: 0.2 })
   *
   * Re-attaches the currently held prop with the patched values and prints the
   * snippet to paste back into src/config.js.
   */
  tuneWeapon(patch = {}) {
    const index = WEAPONS.findIndex((weapon) => weapon.id === this.player.weapon.id);
    if (index < 0) return null;
    const def = { ...WEAPONS[index], ...patch };
    WEAPONS[index] = def;
    this.player.equip(def);
    this.enemy.equip(this.enemy.weapon.id === def.id ? def : this.enemy.weapon);
    const { id, align, length, grip, rotation, offset } = def;
    console.info('[weapon]', JSON.stringify({ id, align, length, grip, rotation, offset }));
    return def;
  }

  /* --------------------------------------------------------- enemy actions */

  enemyAttack() {
    const weapon = this.enemy.weapon;
    const duration = this.enemy.attack(weapon, {
      onImpact: () => this.resolveMelee(this.enemy, this.player, { ...weapon, damage: this.brain.damage }),
    });
    if (!duration) return;
    this.hud.flashEnemyAttack();
    this.sfx.swing();
    const point = this.enemy.handPoint(weapon.hand, new THREE.Vector3());
    this.enemy.after(duration * 0.3, () => this.effects.swoosh(point.setY(1.3), this.enemy.facing, '#ff9d7a'));
  }

  enemyRage() {
    this.enemy.oneShotClip(this.enemy.has('powerUp') ? 'powerUp' : 'cast', { state: 'cast' });
    this.hud.announce('The king rages', { danger: true });
    this.effects.burst(this.enemy.chestPoint(new THREE.Vector3()), { count: 60, color: '#ff5a3c', speed: 5, gravity: -1.5, life: 0.9 });
    this.arena.addShake(0.5);
  }

  /* ----------------------------------------------------------- combat math */

  resolveMelee(attacker, defender, weapon) {
    if (attacker.dead || defender.dead) return;
    const distance = Math.abs(attacker.x - defender.x);
    if (distance > (weapon.range ?? 2.4)) {
      this.effects.dust(new THREE.Vector3(attacker.x + attacker.facing * 1.1, 0.02, 0), 10);
      return;
    }
    this.applyDamage(attacker, defender, weapon.damage);
  }

  applyDamage(attacker, defender, baseDamage, { ranged = false } = {}) {
    if (defender.dead) return;
    if (defender.invulnerable) {
      this.floater(defender, 'DODGED', 'block');
      if (defender === this.player) this.addPoints(COMBAT.points.dodge);
      return;
    }

    const now = performance.now() / 1000;
    let damage = baseDamage;
    let variant = 'damage';
    let crit = false;
    let blocked = false;
    let perfect = false;

    if (!ranged && Math.random() < COMBAT.critChance) {
      crit = true;
      damage *= COMBAT.critMultiplier;
      variant = 'crit';
    }

    if (defender.blocking) {
      blocked = true;
      perfect = now - defender.blockStartedAt <= COMBAT.perfectBlockWindow;
      damage *= perfect ? COMBAT.perfectBlockReduction : COMBAT.blockReduction;
      variant = 'block';
    }

    damage = Math.max(1, Math.round(damage));
    defender.hp = Math.max(0, defender.hp - damage);

    const impactPoint = defender.chestPoint(new THREE.Vector3());
    impactPoint.x -= defender.facing * 0.25;

    if (blocked) {
      this.effects.block(impactPoint);
      this.sfx.parry();
      this.floater(defender, perfect ? 'PARRY!' : `-${damage}`, 'block');
      this.arena.addShake(perfect ? 0.28 : 0.16);
      if (perfect && defender === this.player) {
        this.addLoot({ gems: COMBAT.gemsPerPerfectBlock });
        this.addPoints(COMBAT.points.parry);
      }
    } else {
      this.effects.impact(impactPoint, { color: crit ? '#ffe27a' : '#ffb36b', crit });
      this.sfx.hit(crit);
      this.floater(defender, `-${damage}`, variant);
      this.arena.addShake(crit ? 0.7 : 0.4);
      defender.reactToHit(COMBAT.hitStun);
    }

    this.hud.damage(defender.side, defender.hp, defender.maxHp);

    if (attacker === this.player) {
      this.addLoot({ coins: randomInt(COMBAT.coinsPerHit) + (crit ? 4 : 0), gems: crit ? COMBAT.gemsPerCrit : 0 });
      this.addPoints(crit ? COMBAT.points.crit : COMBAT.points.hit);
      if (!blocked && this.specialCharge < COMBAT.special.charge) {
        this.specialCharge += 1;
        this.hud.setCooldown('special', 1 - this.specialCharge / COMBAT.special.charge);
        if (this.specialCharge === COMBAT.special.charge) this.hud.announce('Special ready');
      }
    }

    if (defender.hp <= 0) this.onDefeat(defender);
  }

  addLoot({ coins = 0, gems = 0 }) {
    this.loot.coins += coins;
    this.loot.gems += gems;
    this.hud.setLoot(this.loot);
  }

  floater(fighter, text, variant) {
    const point = fighter.chestPoint(new THREE.Vector3());
    point.y += 0.55;
    point.project(this.arena.camera);
    if (point.z > 1) return;
    this.hud.floater(text, {
      x: (point.x * 0.5 + 0.5) * window.innerWidth,
      y: (-point.y * 0.5 + 0.5) * window.innerHeight,
    }, variant);
  }

  /* ------------------------------------------------------------- outcomes */

  onDefeat(fighter) {
    fighter.die();
    this.arena.addShake(0.8);
    this.effects.dust(new THREE.Vector3(fighter.x, 0.05, 0), 26);

    if (fighter === this.enemy) {
      this.state = 'over';
      this.controls.setEnabled(false);
      this.player.setMove(0);
      this.addLoot({ coins: COMBAT.coinsPerKill, gems: COMBAT.gemsPerKill });
      this.kills += 1;
      const seconds = (performance.now() - this.matchStartedAt) / 1000;
      const bonus = {
        time: Math.max(0, Math.round(COMBAT.points.timeBonus - seconds * 4)),
        kills: COMBAT.points.kill,
        secrets: Math.min(3, this.loot.gems),
      };
      this.addPoints(bonus.time + bonus.kills + this.lives * COMBAT.points.lifeBonus);
      const reward = this.rewardHero();
      this.hud.announce('Level Clear!');
      this.sfx.win();
      setTimeout(
        () => this.hud.showResult({
          win: true,
          coins: this.loot.coins,
          gems: this.loot.gems,
          lives: this.lives,
          points: this.points,
          bonus,
          reward,
          wallet: this.wallet,
          level: this.level,
          lastLevel: this.level >= 9,
        }),
        1900,
      );
      return;
    }

    // Player died — burn a life.
    this.lives -= 1;
    this.hud.setLives(this.lives);
    this.controls.setEnabled(false);
    this.player.setMove(0);

    if (this.lives <= 0) {
      this.state = 'over';
      this.brain.enabled = false;
      // All five lives spent → the kingdom needs time to recover: 5-hour lockout.
      Game.beginLockout();
      this.hud.announce('Game Over', { danger: true });
      this.sfx.lose();
      setTimeout(
        () =>
          this.hud.showResult({
            win: false,
            coins: this.loot.coins,
            gems: this.loot.gems,
            lives: 0,
            points: this.points,
            level: this.level,
          }),
        1900,
      );
      return;
    }

    this.state = 'interlude';
    this.brain.enabled = false;
    this.enemy.setMove(0);
    this.hud.announce(`${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left`, { danger: true });

    setTimeout(() => {
      if (this.state !== 'interlude') return;
      this.round += 1;
      this.healCharges = Math.max(this.healCharges, 1);
      const enemyWounds = this.enemy.hp; // the king keeps the damage he has taken
      this.player.revive();
      this.player.setWeaponById(this.player.weapon.id);
      this.enemy.revive();
      this.enemy.hp = Math.max(12, Math.round(enemyWounds));
      this.enemy.setWeaponById('sword');
      this.brain.reset(this.round - 1);
      this.brain.enabled = true;
      this.hud.setHp('player', this.player.hp, this.player.maxHp);
      this.hud.setHp('enemy', this.enemy.hp, this.enemy.maxHp);
      this.hud.setRound(this.round);
      this.hud.announce(`Round ${this.round}`);
      setTimeout(() => {
        if (this.state !== 'interlude') return;
        this.hud.announce('Fight!');
        this.state = 'fighting';
        this.controls.setEnabled(true);
      }, 1150);
    }, 2600);
  }

  /* ------------------------------------------------------------ frame loop */

  moveFighter(fighter, other, dt) {
    if (fighter.dead || fighter.moveInput === 0 || fighter.busy || fighter.blocking) return;
    const speed = fighter.moveInput > 0 ? COMBAT.moveSpeed : COMBAT.backSpeed;
    let next = fighter.x + fighter.moveInput * fighter.facing * speed * dt;

    const gap = ARENA.contactGap;
    if (fighter.facing > 0) next = Math.min(next, other.x - gap);
    else next = Math.max(next, other.x + gap);
    next = THREE.MathUtils.clamp(next, ARENA.bounds.min, ARENA.bounds.max);

    if (Math.abs(next - fighter.x) > 0.0001) {
      fighter.root.position.x = next;
      // Kick up dust every few steps.
      fighter.stepTimer = (fighter.stepTimer ?? 0) + dt;
      if (fighter.stepTimer > 0.34) {
        fighter.stepTimer = 0;
        this.effects.dust(new THREE.Vector3(next, 0.02, 0), 4);
      }
    }
  }

  tickCooldowns(dt) {
    for (const key of Object.keys(this.cooldowns)) {
      if (this.cooldowns[key] > 0) this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
    }
    this.hud.setCooldown('attack', this.attackCooldownMax ? this.cooldowns.attack / this.attackCooldownMax : 0);
    this.hud.setCooldown('heal', this.healCooldownMax ? this.cooldowns.heal / this.healCooldownMax : 0);
    this.hud.setCooldown('bow', this.bowCooldownMax ? this.cooldowns.bow / this.bowCooldownMax : 0);
    this.hud.setCooldown('dodge', this.dodgeCooldownMax ? this.cooldowns.dodge / this.dodgeCooldownMax : 0);
    if (this.cooldowns.special > 0) this.hud.setCooldown('special', this.cooldowns.special / this.specialCooldownMax);
  }

  frame() {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;

    if (this.paused) {
      this.renderer.render(this.arena.scene, this.arena.camera);
      return;
    }

    if (this.state === 'fighting') {
      this.brain.update(dt);
      this.moveFighter(this.player, this.enemy, dt);
      this.moveFighter(this.enemy, this.player, dt);
      this.tickCooldowns(dt);
    }

    this.player?.update(dt);
    this.enemy?.update(dt);
    this.effects.update(dt);
    this.arena.update(dt, elapsed);

    // Keep the camera centred between the duellists for a subtle dolly.
    if (this.player && this.enemy) {
      this.arena.trackFighters(this.player.x, this.enemy.x, elapsed);
      const midpoint = (this.player.x + this.enemy.x) * 0.5;
      this.arena.cameraTarget.x += (midpoint * 0.55 - this.arena.cameraTarget.x) * Math.min(1, dt * 2.2);
    }

    this.renderer.render(this.arena.scene, this.arena.camera);
  }
}
