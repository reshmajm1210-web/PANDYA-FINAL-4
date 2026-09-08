/**
 * Headless smoke test for the character layer.
 *
 * There is no browser in this environment, so this harness stubs the handful of
 * DOM APIs GLTFLoader touches, loads the *real* shipped GLBs and drives a
 * Fighter through a full combat cycle. It catches the things that actually go
 * wrong with rig/weapon plumbing: missing bones, bad scale, NaN transforms,
 * missing animation clips and mis-sized props.
 *
 * Run with:  npm run test:assets
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ----------------------------------------------------------- DOM shims --- */
globalThis.self = globalThis;
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
class StubImage {
  width = 1;
  height = 1;
  #listeners = {};
  addEventListener(type, fn) {
    (this.#listeners[type] ??= []).push(fn);
  }
  removeEventListener() {}
  set src(_value) {
    setTimeout(() => this.#listeners.load?.forEach((fn) => fn({ type: 'load' })), 0);
  }
  set onload(fn) {
    this.addEventListener('load', fn);
  }
  set onerror(_fn) {}
}
globalThis.Image = StubImage;
globalThis.document = {
  createElementNS: () => {
    const listeners = {};
    return {
      width: 1,
      height: 1,
      style: {},
      addEventListener: (type, fn) => ((listeners[type] ??= []).push(fn)),
      removeEventListener: () => {},
      set src(_value) {
        setTimeout(() => listeners.load?.forEach((fn) => fn({ type: 'load' })), 0);
      },
      get src() {
        return '';
      },
    };
  },
  createElement: () => ({ getContext: () => null, style: {} }),
};

const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
const { Fighter, WeaponRack } = await import('../src/game/fighter.js');
const { ARENA, COMBAT, SHIELD, WEAPONS } = await import('../src/config.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(ROOT, 'public/assets');

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const parse = (file) =>
  new Promise((resolve, reject) => {
    const buffer = fs.readFileSync(path.join(ASSET_DIR, file));
    loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', resolve, reject);
  });

/* -------------------------------------------------------------- asserts -- */
let failures = 0;
const check = (label, condition, detail = '') => {
  const mark = condition ? '✔' : '✘';
  if (!condition) failures++;
  console.log(`  ${mark} ${label}${detail ? `  — ${detail}` : ''}`);
};
const finite = (vector) => Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);

/* ----------------------------------------------------------------- rack -- */
const rack = new WeaponRack({ load: (file) => parse(file) });
await rack.preload();
console.log('\nWeapon rack');
for (const def of [...WEAPONS, SHIELD]) {
  const prop = rack.build(def);
  const box = new THREE.Box3().setFromObject(prop);
  const size = box.getSize(new THREE.Vector3());
  check(
    `${def.id.padEnd(7)} prepared`,
    prop && finite(size) && Math.abs(size.y - def.length) < def.length * 0.25,
    `size ${size.toArray().map((v) => v.toFixed(2)).join(' × ')} (target length ${def.length})`,
  );
}

/* ------------------------------------------------------------- fighters -- */
for (const [id, file, startX] of [
  ['hero', 'characters/hero.glb', ARENA.playerStart],
  ['villain', 'characters/villain.glb', ARENA.enemyStart],
]) {
  console.log(`\nFighter: ${id}`);
  const gltf = await parse(file);
  const fighter = new Fighter({
    gltf,
    rack,
    side: id === 'hero' ? 'player' : 'enemy',
    height: ARENA.fighterHeight,
    startX,
    maxHp: COMBAT.maxHp,
  });

  check('right hand bone', !!fighter.hands.right, fighter.hands.right?.name);
  check('left hand bone', !!fighter.hands.left, fighter.hands.left?.name);
  check('head bone', !!fighter.headBone, fighter.headBone?.name);
  check('hip bone', !!fighter.hipBone, fighter.hipBone?.name);

  const required = ['idle', 'walk', 'attack', 'block', 'hit', 'death'];
  check('clips present', required.every((name) => fighter.has(name)), [...fighter.clips.keys()].join(', '));

  // Bind-pose height, measured through the skeleton like the game does.
  fighter.root.updateMatrixWorld(true);
  const bones = new THREE.Box3();
  const point = new THREE.Vector3();
  fighter.model.traverse((object) => {
    if (object.isBone) bones.expandByPoint(object.getWorldPosition(point));
  });
  const height = bones.max.y - bones.min.y;
  check('stands at target height', Math.abs(height - ARENA.fighterHeight) < 0.2, `${height.toFixed(2)} m`);
  check('feet on the ground', Math.abs(bones.min.y) < 0.2, `lowest bone y=${bones.min.y.toFixed(3)}`);

  check('grip axis measured', finite(fighter.gripAxis) && fighter.handSpan > 0.02, `span ${fighter.handSpan.toFixed(3)} m, axis ${fighter.gripAxis.toArray().map((v) => v.toFixed(2)).join(',')}`);

  // Every weapon must attach without NaNs and end up in front of the fighter.
  for (const def of WEAPONS) {
    fighter.equip(def);
    fighter.root.updateMatrixWorld(true);
    const prop = fighter.attached[def.hand];
    const centre = new THREE.Box3().setFromObject(prop).getCenter(new THREE.Vector3());
    const distance = centre.distanceTo(fighter.root.position);
    check(`equips ${def.id}`, !!prop && finite(centre) && distance < 3.2, `prop centre ${distance.toFixed(2)} m from body`);
  }

  // Drive a full combat cycle: swing, block, take a hit, die, revive.
  fighter.setWeaponById('sword');
  let error = null;
  try {
    let impacts = 0;
    fighter.setMove(1);
    for (let i = 0; i < 30; i++) fighter.update(1 / 60);
    fighter.attack(fighter.weapon, { onImpact: () => impacts++ });
    for (let i = 0; i < 120; i++) fighter.update(1 / 60);
    check('attack fires its impact window', impacts === 1, `${impacts} impact(s)`);
    check('returns to locomotion', !fighter.busy, `state ${fighter.state}`);

    fighter.startBlock();
    check('shield appears while blocking', !!fighter.attached.left?.userData.isShield);
    for (let i = 0; i < 30; i++) fighter.update(1 / 60);
    fighter.stopBlock();
    check('shield stows again', !fighter.attached.left?.userData.isShield);

    fighter.reactToHit(0.4);
    for (let i = 0; i < 60; i++) fighter.update(1 / 60);
    fighter.die();
    for (let i = 0; i < 60; i++) fighter.update(1 / 60);
    check('death holds the last pose', fighter.dead && fighter.state === 'dead');
    fighter.revive();
    for (let i = 0; i < 30; i++) fighter.update(1 / 60);
    check('revives back to idle', !fighter.dead && fighter.hp === COMBAT.maxHp && fighter.x === startX);
  } catch (exception) {
    error = exception;
  }
  check('combat cycle runs clean', !error, error?.message ?? '');

  fighter.root.updateMatrixWorld(true);
  const head = fighter.chestPoint(new THREE.Vector3());
  check('chest anchor is sane', finite(head) && head.y > 0.7 && head.y < 2.2, `y=${head.y.toFixed(2)}`);
}

console.log(failures === 0 ? '\n✔ all character checks passed\n' : `\n✘ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
