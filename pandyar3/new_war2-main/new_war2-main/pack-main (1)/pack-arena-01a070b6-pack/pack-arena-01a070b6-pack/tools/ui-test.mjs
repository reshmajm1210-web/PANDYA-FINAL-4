/**
 * DOM smoke test: mounts the real index.html in jsdom, wires up the HUD and the
 * control layer and drives every interaction. This is what catches typos in
 * `data-*` hooks, missing nodes and handlers that throw — the failures that
 * would otherwise only show up as a dead button in the browser.
 *
 * Run with:  npm run test:ui
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost:5173/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// note: jsdom's performance shim recurses when hoisted to globalThis — Node's own is fine.
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.PointerEvent = dom.window.MouseEvent;

const { Hud } = await import('../src/ui/hud.js');
const { Controls } = await import('../src/ui/controls.js');
const { WEAPONS } = await import('../src/config.js');

let failures = 0;
const check = (label, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`  ${condition ? '✔' : '✘'} ${label}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nHUD wiring');
const hud = new Hud();
const missing = Object.entries(hud.el)
  .filter(([, value]) => value === null)
  .map(([key]) => key);
check('every HUD node resolves', missing.length === 0, missing.join(', '));
check('all five action buttons bound', ['attack', 'defend', 'weapon', 'heal', 'bow', 'dodge', 'special'].every((key) => hud.el.buttons[key]));
check('cooldown rings bound', ['attack', 'heal', 'bow'].every((key) => hud.el.cooldowns[key]));
check('weapon strip lists the rack', Object.keys(hud.chips).length === WEAPONS.length, Object.keys(hud.chips).join(', '));

let error = null;
try {
  hud.setProgress(0.5, 'Testing');
  hud.setRound(2);
  hud.setLives(2);
  hud.setLoot({ coins: 42, gems: 3 });
  hud.setWeapon(WEAPONS[2]);
  hud.setCooldown('bow', 0.5);
  hud.setHeld('defend', true);
  hud.flashEnemyAttack();
  hud.announce('Fight!');
  hud.damage('player', 62, 100);
  hud.damage('enemy', 12, 100);
  hud.floater('-13', { x: 100, y: 200 }, 'crit');
  hud.showHud();
  hud.setWallet({ coins: 500, pearls: 100 });
  hud.showResult({ win: true, coins: 42, gems: 3, lives: 2, reward: { coins: 500, pearls: 100 }, wallet: { coins: 1000, pearls: 200 } });
} catch (exception) {
  error = exception;
}
check('HUD updates run clean', !error, error?.message ?? '');
if (error && process.env.TRACE) console.log(error.stack.split('\n').slice(0, 12).join('\n'));
check('health bar scales', hud.el.bars.player.fill.style.transform === 'scaleX(0.62)', hud.el.bars.player.fill.style.transform);
check('hp readout follows', hud.el.bars.enemy.text.textContent === '12');
check('lives dim when spent', document.querySelectorAll('.life.is-active').length === 2);
check('loot counters update', hud.el.coins.textContent === '42' && hud.el.gems.textContent === '3');
check('weapon chip highlights', hud.chips.vel.classList.contains('is-on'));
check('cooldown variable set', hud.el.cooldowns.bow.style.getPropertyValue('--cd') === '0.5');
check('hero wallet shows credits', hud.el.walletCoins.textContent === '500' && hud.el.walletPearls.textContent === '100' && hud.el.reward.hidden === false);
check('result screen reveals', hud.el.result.hidden === false && hud.el.resultTitle.textContent === 'Level Clear!');
check('floating text mounts', document.querySelectorAll('.floater').length === 1);

console.log('\nControls');
const seen = { move: [], action: [], hold: [] };
const controls = new Controls({
  onMove: (direction) => seen.move.push(direction),
  onAction: (name) => seen.action.push(name),
  onHold: (name, down) => seen.hold.push(`${name}:${down}`),
});

const fire = (node, type, init = {}) => node.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, ...init }));
for (const name of ['attack', 'weapon', 'heal', 'bow']) fire(hud.el.buttons[name], 'pointerdown');
check('taps reach the game', seen.action.join(',') === 'attack,weapon,heal,bow', seen.action.join(','));

fire(hud.el.buttons.defend, 'pointerdown');
fire(hud.el.buttons.defend, 'pointerup');
check('defend is a hold', seen.hold.join(' ') === 'defend:true defend:false', seen.hold.join(' '));

const keyboard = (type, code) => dom.window.dispatchEvent(new dom.window.KeyboardEvent(type, { code, bubbles: true }));
keyboard('keydown', 'KeyW');
keyboard('keyup', 'KeyW');
keyboard('keydown', 'KeyJ');
check('keyboard moves and swings', seen.move.join(',') === '1,0' && seen.action.at(-1) === 'attack', `${seen.move.join(',')} / ${seen.action.at(-1)}`);

controls.setEnabled(false);
seen.action.length = 0;
fire(hud.el.buttons.attack, 'pointerdown');
check('input locks between rounds', seen.action.length === 0);

console.log(failures === 0 ? '\n✔ all UI checks passed\n' : `\n✘ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
