import { COMBAT, WEAPONS } from '../config.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Owns every pixel of the DOM overlay: health bars, lives, loot counters,
 * cooldown sweeps, floating combat text and the loading / start / result
 * screens. The 3D layer never touches the DOM directly.
 */
export class Hud {
  constructor() {
    this.el = {
      hud: $('#hud'),
      loading: $('[data-loading]'),
      loadFill: $('[data-load-fill]'),
      loadText: $('[data-load-text]'),
      start: $('[data-start]'),
      play: $('[data-play]'),
      result: $('[data-result]'),
      resultTitle: $('[data-result-title]'),
      resultSub: $('[data-result-sub]'),
      resultCoins: $('[data-result-coins]'),
      resultGems: $('[data-result-gems]'),
      resultLives: $('[data-result-lives]'),
      again: $('[data-again]'),
      announce: $('[data-announce]'),
      floaters: $('[data-floaters]'),
      lives: $('[data-lives]'),
      coins: $('[data-coins]'),
      gems: $('[data-gems]'),
      round: $('[data-round-label]'),
      weaponLabel: $('[data-weapon-label]'),
      weaponStrip: $('[data-weapon-strip]'),
      enemyIndicator: $('[data-enemy-indicator]'),
      points: $('[data-points]'),
      pause: $('[data-pause]'),
      paused: $('[data-paused]'),
      resume: $('[data-resume]'),
      resultPoints: $('[data-result-points]'),
      bonus: $('[data-bonus]'),
      bonusTime: $('[data-bonus-time]'),
      bonusKills: $('[data-bonus-kills]'),
      bonusSecrets: $('[data-bonus-secrets]'),
      retry: $('[data-retry]'),
      walletCoins: $('[data-wallet-coins]'),
      walletPearls: $('[data-wallet-pearls]'),
      reward: $('[data-reward]'),
      rewardCoins: $('[data-reward-coins]'),
      rewardPearls: $('[data-reward-pearls]'),
      walletTotalCoins: $('[data-wallet-total-coins]'),
      walletTotalPearls: $('[data-wallet-total-pearls]'),
      map: $('[data-map]'),
      level: $('[data-level]'),
      startLevel: $('[data-start-level]'),
      startKicker: $('[data-start-kicker]'),
      locked: $('[data-locked]'),
      lockedCount: $('[data-locked-count]'),
      lockedMap: $('[data-locked-map]'),
      bars: {
        player: { fill: $('[data-hp-fill="player"]'), lag: $('[data-hp-lag="player"]'), text: $('[data-hp-text="player"]'), bar: $('.bar--player'), portrait: $('.portrait--player') },
        enemy: { fill: $('[data-hp-fill="enemy"]'), lag: $('[data-hp-lag="enemy"]'), text: $('[data-hp-text="enemy"]'), bar: $('.bar--enemy'), portrait: $('.portrait--enemy') },
      },
      buttons: Object.fromEntries($$('[data-action], [data-hold]').map((node) => [node.dataset.action ?? node.dataset.hold, node])),
      cooldowns: Object.fromEntries($$('[data-cooldown]').map((node) => [node.dataset.cooldown, node])),
    };

    this.#buildWeaponStrip();
    this.setHp('player', COMBAT.maxHp, COMBAT.maxHp);
    this.setHp('enemy', COMBAT.maxHp, COMBAT.maxHp);
  }

  #buildWeaponStrip() {
    this.el.weaponStrip.innerHTML = WEAPONS.map(
      (weapon) => `<span class="weapon-chip" data-chip="${weapon.id}">${weapon.name}</span>`,
    ).join('');
    this.chips = Object.fromEntries($$('[data-chip]', this.el.weaponStrip).map((node) => [node.dataset.chip, node]));
  }

  /* ------------------------------------------------------------- screens */

  setProgress(value, label) {
    this.el.loadFill.style.width = `${Math.round(value * 100)}%`;
    if (label) this.el.loadText.textContent = label;
  }

  async hideLoading() {
    this.el.loading.classList.add('is-fading');
    await new Promise((resolve) => setTimeout(resolve, 480));
    this.el.loading.hidden = true;
  }

  showStart() {
    this.el.start.hidden = false;
    this.el.start.classList.remove('is-fading');
  }

  async hideStart() {
    this.el.start.classList.add('is-fading');
    await new Promise((resolve) => setTimeout(resolve, 420));
    this.el.start.hidden = true;
  }

  showHud() {
    this.el.hud.hidden = false;
  }

  showResult({ win, coins, gems, lives, points = 0, bonus = null, reward = null, wallet = null, level = 1, lastLevel = false }) {
    const screen = this.el.result;
    screen.hidden = false;
    screen.classList.toggle('is-win', win);
    screen.classList.remove('is-fading');
    this.el.resultTitle.textContent = win ? 'Level Clear!' : 'Game Over';
    this.el.resultSub.textContent = win
      ? `Level ${level} — ${this.levelTitle ?? 'The warlord'} is defeated. Madurai holds its throne.`
      : 'The throne of Madurai falls silent. Rise and fight again.';
    this.#countUp(this.el.resultCoins, coins);
    this.#countUp(this.el.resultGems, gems);
    this.el.resultLives.textContent = String(lives);
    this.#countUp(this.el.resultPoints, points);

    // Level Clear shows the bonus breakdown + CONTINUE; Game Over shows REPLAY.
    this.el.bonus.hidden = !win || !bonus;
    if (bonus) {
      this.el.bonusTime.textContent = `+${bonus.time} PTS`;
      this.el.bonusKills.textContent = `+${bonus.kills} PTS`;
      this.el.bonusSecrets.textContent = `${bonus.secrets}/3`;
    }
    this.el.reward.hidden = !win || !reward;
    if (reward && wallet) {
      this.el.rewardCoins.textContent = `+${reward.coins}`;
      this.el.rewardPearls.textContent = `+${reward.pearls}`;
      this.#countUp(this.el.walletTotalCoins, wallet.coins);
      this.#countUp(this.el.walletTotalPearls, wallet.pearls);
    }

    // Win → CONTINUE + BACK TO MAP; Lose → REPLAY + BACK TO MAP.
    this.el.again.hidden = !win;
    this.el.retry.hidden = win;
    this.el.map.hidden = false;
    this.el.again.textContent = win ? (lastLevel ? 'Return to Map' : 'Continue') : '';
  }

  /** Shown on the start screen and the result card: which Kingdom Path level. */
  setLevel(level, title) {
    this.levelTitle = title;
    if (this.el.startLevel) this.el.startLevel.textContent = `Level ${level}`;
    if (this.el.startKicker) this.el.startKicker.textContent = title;
    if (this.el.level) this.el.level.textContent = `Level ${level}`;
    if (this.el.again) this.el.again.dataset.lastLevel = String(level >= 9);
  }

  /** Shows the real-time lockout overlay after using every life. */
  showLocked(remainingMs) {
    if (this.el.locked) {
      this.el.locked.hidden = false;
      this.#tickLocked(remainingMs);
    }
  }

  hideLocked() {
    if (this.el.locked) this.el.locked.hidden = true;
  }

  #tickLocked(remainingMs) {
    if (!this.el.locked || !this.el.lockedCount) return;
    clearTimeout(this._lockTimer);
    const render = () => {
      const remaining = Math.max(0, remainingMs - (performance.now() - this._lockStartedAt));
      if (remaining <= 0) {
        this.hideLocked();
        return;
      }
      const total = Math.ceil(remaining / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      this.el.lockedCount.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      this._lockTimer = setTimeout(render, 1000);
    };
    this._lockStartedAt = performance.now();
    render();
  }

  setPoints(points) {
    const text = points.toLocaleString('en-IN');
    if (this.el.points.textContent === text) return;
    this.el.points.textContent = text;
    this.#bump(this.el.points.parentElement);
  }

  setWallet({ coins, pearls }) {
    this.el.walletCoins.textContent = coins.toLocaleString('en-IN');
    this.el.walletPearls.textContent = pearls.toLocaleString('en-IN');
  }

  setPaused(paused) {
    this.el.paused.hidden = !paused;
  }

  hideResult() {
    this.el.result.classList.add('is-fading');
    setTimeout(() => {
      this.el.result.hidden = true;
    }, 420);
  }

  #countUp(node, value) {
    const start = performance.now();
    const duration = 700;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      node.textContent = String(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------ in-battle */

  setHp(side, hp, maxHp) {
    const bar = this.el.bars[side];
    const ratio = Math.max(0, hp / maxHp);
    bar.fill.style.transform = `scaleX(${ratio})`;
    bar.lag.style.transform = `scaleX(${ratio})`;
    bar.text.textContent = String(Math.max(0, Math.round(hp)));
    bar.bar.classList.toggle('is-low', ratio > 0 && ratio < 0.3);
  }

  /** Damage: the pale "lag" bar trails behind for a beat. */
  damage(side, hp, maxHp) {
    const bar = this.el.bars[side];
    const ratio = Math.max(0, hp / maxHp);
    bar.fill.style.transform = `scaleX(${ratio})`;
    bar.text.textContent = String(Math.max(0, Math.round(hp)));
    bar.bar.classList.toggle('is-low', ratio > 0 && ratio < 0.3);
    requestAnimationFrame(() => {
      bar.lag.style.transform = `scaleX(${ratio})`;
    });
    bar.portrait.classList.remove('is-hurt');
    void bar.portrait.offsetWidth;
    bar.portrait.classList.add('is-hurt');
  }

  setLives(count) {
    $$('.life', this.el.lives).forEach((node, index) => {
      const alive = index < count;
      if (!alive && node.classList.contains('is-active')) {
        node.classList.add('is-lost');
        setTimeout(() => node.classList.remove('is-lost'), 600);
      }
      node.classList.toggle('is-active', alive);
    });
  }

  setLoot({ coins, gems }) {
    if (coins !== undefined && this.el.coins.textContent !== String(coins)) {
      this.el.coins.textContent = String(coins);
      this.#bump(this.el.coins.parentElement);
    }
    if (gems !== undefined && this.el.gems.textContent !== String(gems)) {
      this.el.gems.textContent = String(gems);
      this.#bump(this.el.gems.parentElement);
    }
  }

  #bump(node) {
    node.classList.remove('is-bumped');
    void node.offsetWidth;
    node.classList.add('is-bumped');
  }

  setRound(round) {
    this.el.round.textContent = `Round ${round}`;
  }

  setWeapon(weapon) {
    this.el.weaponLabel.textContent = weapon.label;
    for (const [id, chip] of Object.entries(this.chips)) chip.classList.toggle('is-on', id === weapon.id);
  }

  setCooldown(key, ratio) {
    const node = this.el.cooldowns[key];
    if (!node) return;
    node.style.setProperty('--cd', String(Math.max(0, Math.min(1, ratio))));
    this.el.buttons[key]?.classList.toggle('is-cooling', ratio > 0.001);
  }

  setHeld(key, held) {
    this.el.buttons[key]?.classList.toggle('is-held', held);
  }

  flashEnemyAttack() {
    const node = this.el.enemyIndicator;
    node.classList.remove('is-live');
    void node.offsetWidth;
    node.classList.add('is-live');
    setTimeout(() => node.classList.remove('is-live'), 560);
  }

  announce(text, { danger = false } = {}) {
    const node = this.el.announce;
    node.textContent = text;
    node.classList.toggle('is-danger', danger);
    node.classList.remove('is-on');
    void node.offsetWidth;
    node.classList.add('is-on');
  }

  /** Floating combat text anchored to a projected 3D point. */
  floater(text, screenPosition, variant = 'damage') {
    const node = document.createElement('span');
    node.className = `floater floater--${variant}`;
    node.textContent = text;
    node.style.left = `${screenPosition.x}px`;
    node.style.top = `${screenPosition.y}px`;
    this.el.floaters.append(node);
    setTimeout(() => node.remove(), 1050);
  }
}
