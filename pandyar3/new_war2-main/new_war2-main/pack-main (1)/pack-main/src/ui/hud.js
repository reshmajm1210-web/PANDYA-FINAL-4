import { ARENA, COMBAT, WEAPONS } from '../config.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Owns every pixel of the DOM overlay: health bars, lives, loot counters,
 * cooldown sweeps, the minimap, floating combat text and loading / start / result
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
      minimap: $('[data-minimap]'),
      minimapPlayer: $('[data-minimap-player]'),
      minimapEnemy: $('[data-minimap-enemy]'),
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
    this.setMinimap(ARENA.playerStart, ARENA.enemyStart);
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

  showResult({ win, coins, gems, lives }) {
    const screen = this.el.result;
    screen.hidden = false;
    screen.classList.toggle('is-win', win);
    screen.classList.remove('is-fading');
    this.el.resultTitle.textContent = win ? 'You Win' : 'You Lose';
    this.el.resultSub.textContent = win
      ? 'The northern warlord kneels. Madurai holds its throne.'
      : 'The throne of Madurai falls silent. Rise and fight again.';
    this.#countUp(this.el.resultCoins, coins);
    this.#countUp(this.el.resultGems, gems);
    this.el.resultLives.textContent = String(lives);
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

  /** Fighters move on one world-X lane; percentages keep the map resize-safe. */
  setMinimap(playerX, enemyX) {
    const { min, max } = ARENA.bounds;
    const place = (marker, x, name) => {
      const percent = Math.max(0, Math.min(100, (x - min) / (max - min) * 100));
      marker.style.left = `${percent.toFixed(2)}%`;
      // Expose positions without announcing every frame to screen readers.
      const label = `${name}: ${Math.round(percent)}% across the arena`;
      if (marker.getAttribute('aria-label') !== label) marker.setAttribute('aria-label', label);
    };
    place(this.el.minimapPlayer, playerX, 'Hero');
    place(this.el.minimapEnemy, enemyX, 'Enemy');
  }

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
