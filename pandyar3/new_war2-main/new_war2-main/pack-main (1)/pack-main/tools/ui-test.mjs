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
const { ARENA, WEAPONS } = await import('../src/config.js');
const { Game } = await import('../src/game/game.js');

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
check('minimap stays hidden with the HUD before play', hud.el.hud.hidden && hud.el.minimap.closest('#hud') === hud.el.hud);
check('all five action buttons bound', ['attack', 'defend', 'weapon', 'heal', 'bow'].every((key) => hud.el.buttons[key]));
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
  hud.showResult({ win: true, coins: 42, gems: 3, lives: 2 });
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
check('result screen reveals', hud.el.result.hidden === false && hud.el.resultTitle.textContent === 'You Win');
check('floating text mounts', document.querySelectorAll('.floater').length === 1);

console.log('\nMinimap');
const { min, max } = ARENA.bounds;
const span = max - min;
const percent = (marker) => parseFloat(marker.style.left);
const near = (actual, expected) => Math.abs(actual - expected) < 0.01;
const mapped = (x) => (x - min) / span * 100;
const markersAt = (player, enemy) => near(percent(hud.el.minimapPlayer), player) && near(percent(hud.el.minimapEnemy), enemy);

check('map is the final bottom HUD panel', hud.el.minimap.parentElement.classList.contains('hud__bottom') && hud.el.minimap.parentElement.lastElementChild === hud.el.minimap);
check('markers start at both fighter spawns', markersAt(mapped(ARENA.playerStart), mapped(ARENA.enemyStart)));
check('H / E distinguish fighters without relying on color', hud.el.minimapPlayer.textContent === 'H' && hud.el.minimapEnemy.textContent === 'E');
check('map legend names both fighters', /Hero/.test(document.querySelector('#minimap-legend').textContent) && /Enemy/.test(document.querySelector('#minimap-legend').textContent));

hud.setMinimap(min, max);
check('arena edges map to opposite ends of the lane', markersAt(0, 100));
hud.setMinimap(min + span / 4, min + span * 3 / 4);
check('world positions scale linearly', markersAt(25, 75));
check('accessible positions update without live announcements', hud.el.minimapPlayer.getAttribute('aria-label') === 'Hero: 25% across the arena' && hud.el.minimapEnemy.getAttribute('aria-label') === 'Enemy: 75% across the arena' && !hud.el.minimap.closest('[aria-live]'));
hud.setMinimap(min + span / 2, min + span / 2);
check('arena midpoint is centered for either fighter', markersAt(50, 50));
hud.setMinimap(min - span, max + span);
check('out-of-bounds positions clamp to the map', markersAt(0, 100));
hud.setMinimap(max + span, min - span);
check('both markers clamp at either edge', markersAt(100, 0));
hud.setMinimap(min + span / 4, min + span * 3 / 4);
hud.setMinimap(min + span / 2, min + span * 3 / 4);
check('hero can move without moving the enemy marker', markersAt(50, 75));
hud.setMinimap(min + span / 2, max);
check('enemy can move without moving the hero marker', markersAt(50, 100));

// Exercise the real movement + frame loop without constructing a WebGL renderer.
const laneFighter = (x, facing) => ({
  root: { position: { x } },
  get x() { return this.root.position.x; },
  facing,
  moveInput: 1,
  update() {},
});
let renderedMarkers;
const game = Object.assign(Object.create(Game.prototype), {
  running: true,
  state: 'fighting',
  clock: { getDelta: () => 0.05, elapsedTime: 1 },
  hud,
  player: laneFighter(ARENA.playerStart, 1),
  enemy: laneFighter(ARENA.enemyStart, -1),
  brain: { update() {} },
  effects: { update() {} },
  arena: { update() {}, trackFighters() {}, cameraTarget: { x: 0 } },
  renderer: { render() { renderedMarkers = [percent(hud.el.minimapPlayer), percent(hud.el.minimapEnemy)]; } },
  tickCooldowns() {},
});
hud.setMinimap(ARENA.playerStart, ARENA.enemyStart);
game.frame();
check('both fighters actually move in the test frame', game.player.x > ARENA.playerStart && game.enemy.x < ARENA.enemyStart);
check('frame tracks both positions after movement, before rendering', near(renderedMarkers[0], mapped(game.player.x)) && near(renderedMarkers[1], mapped(game.enemy.x)));
for (const state of ['ready', 'interlude', 'over']) {
  game.state = state;
  game.player.root.position.x = ARENA.playerStart;
  game.enemy.root.position.x = ARENA.enemyStart;
  hud.setMinimap(max, min); // Deliberately stale markers before a respawn / reset.
  game.frame();
  check(`map refreshes outside combat (${state})`, markersAt(mapped(ARENA.playerStart), mapped(ARENA.enemyStart)));
}
game.running = false;
hud.setMinimap(min, max);
game.frame();
check('stopped frame loop leaves the map alone', markersAt(0, 100));
hud.setMinimap(ARENA.playerStart, ARENA.enemyStart);

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
