import * as THREE from 'three';

import { ARENA, ASSETS, CAMERA, COMBAT, WEAPONS } from '../config.js';
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
    this.cooldowns = { attack: 0, heal: 0, bow: 0, weapon: 0 };
    this.healCharges = COMBAT.heal.charges;
    this.quickDrawFrom = null;

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clock.getDelta();
    });
  }

  /* ------------------------------------------------------------------ boot */

  async boot() {
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
    this.enemy = new Fighter({
      gltf: villainGltf,
      rack,
      side: 'enemy',
      height: ARENA.fighterHeight * 1.04,
      startX: ARENA.enemyStart,
      maxHp: COMBAT.maxHp,
    });
    this.enemy.setWeaponById('sword');
    this.arena.scene.add(this.player.root, this.enemy.root);

    this.brain = new EnemyBrain({
      self: this.enemy,
      target: this.player,
      actions: {
        move: (direction) => this.enemy.setMove(direction),
        attack: () => this.enemyAttack(),
        block: (on) => (on ? this.enemy.startBlock() : this.enemy.stopBlock()),
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
    this.hud.setProgress(1, 'Ready');
    this.hud.setWeapon(this.player.weapon);
    this.hud.setLives(this.lives);
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
    this.hud.el.again.addEventListener('click', () => this.restart());
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
    this.sfx.unlock();
    await this.hud.hideStart();
    this.hud.showHud();
    this.hud.setRound(this.round);
    this.hud.setLoot(this.loot);
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
    this.cooldowns = { attack: 0, heal: 0, bow: 0, weapon: 0 };
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
    if (this.state !== 'fighting' || this.player.dead) return;
    if (name === 'attack') this.playerAttack();
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

  playerHeal() {
    if (this.cooldowns.heal > 0 || this.player.busy) return;
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
    if (this.cooldowns.weapon > 0 || this.player.dead) return;
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
      if (perfect && defender === this.player) this.addLoot({ gems: COMBAT.gemsPerPerfectBlock });
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
      this.hud.announce('Victory!');
      this.sfx.win();
      setTimeout(() => this.hud.showResult({ win: true, coins: this.loot.coins, gems: this.loot.gems, lives: this.lives }), 1900);
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
      this.hud.announce('You Lose', { danger: true });
      this.sfx.lose();
      setTimeout(() => this.hud.showResult({ win: false, coins: this.loot.coins, gems: this.loot.gems, lives: 0 }), 1900);
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
  }

  frame() {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;

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

    // Track after movement in every state, including respawns and match resets.
    if (this.player && this.enemy) {
      this.hud.setMinimap(this.player.x, this.enemy.x);
      this.arena.trackFighters(this.player.x, this.enemy.x, elapsed);
      // Keep the camera centred between the duellists for a subtle dolly.
      const midpoint = (this.player.x + this.enemy.x) * 0.5;
      this.arena.cameraTarget.x += (midpoint * 0.55 - this.arena.cameraTarget.x) * Math.min(1, dt * 2.2);
    }

    this.renderer.render(this.arena.scene, this.arena.camera);
  }
}
