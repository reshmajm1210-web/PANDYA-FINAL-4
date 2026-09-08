import * as THREE from 'three';
import { SHIELD, WEAPONS } from '../config.js';

const DEG = Math.PI / 180;

/**
 * Normalises an arbitrary weapon model so that:
 *   • its longest axis points along +Y,
 *   • it is `length` units long,
 *   • the grip sits at the local origin (so it can be parented straight to a hand bone).
 */
/**
 * Finds the dominant axis of a point cloud (PCA via power iteration).
 * Props are modelled in wildly different orientations — the Tamil `vel`, for
 * instance, lies diagonally across two axes — so a bounding-box guess is not
 * enough to work out which way a weapon actually points.
 */
function dominantAxis(points) {
  const mean = new THREE.Vector3();
  for (const point of points) mean.add(point);
  mean.divideScalar(points.length || 1);

  const covariance = new Array(9).fill(0);
  const delta = new THREE.Vector3();
  for (const point of points) {
    delta.subVectors(point, mean);
    covariance[0] += delta.x * delta.x;
    covariance[1] += delta.x * delta.y;
    covariance[2] += delta.x * delta.z;
    covariance[4] += delta.y * delta.y;
    covariance[5] += delta.y * delta.z;
    covariance[8] += delta.z * delta.z;
  }
  covariance[3] = covariance[1];
  covariance[6] = covariance[2];
  covariance[7] = covariance[5];

  let vector = new THREE.Vector3(0.577, 0.577, 0.577);
  for (let i = 0; i < 32; i++) {
    const x = covariance[0] * vector.x + covariance[1] * vector.y + covariance[2] * vector.z;
    const y = covariance[3] * vector.x + covariance[4] * vector.y + covariance[5] * vector.z;
    const z = covariance[6] * vector.x + covariance[7] * vector.y + covariance[8] * vector.z;
    const next = new THREE.Vector3(x, y, z);
    if (next.lengthSq() < 1e-12) break;
    vector = next.normalize();
  }
  return vector;
}

/** Samples vertex positions of a subtree in its local space. */
function samplePoints(object, limit = 4000) {
  const points = [];
  const matrix = new THREE.Matrix4();
  object.updateMatrixWorld(true);
  const meshes = [];
  object.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  const total = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
  const stride = Math.max(1, Math.ceil(total / limit));
  for (const mesh of meshes) {
    matrix.copy(mesh.matrixWorld).premultiply(new THREE.Matrix4().copy(object.matrixWorld).invert());
    const attribute = mesh.geometry.attributes.position;
    for (let i = 0; i < attribute.count; i += stride) {
      points.push(new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(matrix));
    }
  }
  return points;
}

/**
 * Normalises an arbitrary weapon model so that:
 *   • its longest (principal) axis points along +Y,
 *   • its flattest axis points along +Z,
 *   • it is `length` units long,
 *   • the grip sits at the local origin (so it can be parented straight to a hand bone).
 */
function prepareWeapon(source, def) {
  const model = source.clone(true);
  // The bow export includes loose display arrows; projectiles are rendered by Effects.
  const excluded = [];
  model.traverse((node) => {
    if (def.excludeNodes?.includes(node.name)) excluded.push(node);
  });
  excluded.forEach((node) => node.removeFromParent());
  const oriented = new THREE.Group();
  oriented.add(model);

  const axis = dominantAxis(samplePoints(oriented));
  if (axis.y < 0) axis.negate();
  // PCA finds an axis, not which end is the blade. Use the asset's known polarity.
  if (def.flipAxis) axis.negate();
  oriented.quaternion.setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0));

  const holder = new THREE.Group();
  holder.add(oriented);
  holder.updateMatrixWorld(true);

  // Put the *thinnest* remaining axis on Z so flat props (shields, the valari)
  // can simply be told "face the enemy".
  const flatBounds = new THREE.Box3().setFromObject(oriented);
  const flatSize = flatBounds.getSize(new THREE.Vector3());
  if (flatSize.x < flatSize.z) {
    oriented.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    holder.updateMatrixWorld(true);
  }

  const orientedBounds = new THREE.Box3().setFromObject(oriented);
  const orientedSize = orientedBounds.getSize(new THREE.Vector3());
  const scale = def.length / (orientedSize.y || 1);
  oriented.scale.multiplyScalar(scale);
  holder.updateMatrixWorld(true);

  const finalBounds = new THREE.Box3().setFromObject(oriented);
  const gripY = finalBounds.min.y + (def.grip ?? 0.15) * def.length;
  // Centre the actual handle, not the whole curved weapon's bounding box.
  const gripBounds = new THREE.Box3();
  for (const point of samplePoints(holder)) {
    if (Math.abs(point.y - gripY) < def.length * 0.025) gripBounds.expandByPoint(point);
  }
  const centre = (gripBounds.isEmpty() ? finalBounds : gripBounds).getCenter(new THREE.Vector3());
  oriented.position.x -= centre.x;
  oriented.position.z -= centre.z;
  oriented.position.y -= gripY;

  holder.rotation.set(def.rotation[0] * DEG, def.rotation[1] * DEG, def.rotation[2] * DEG);
  holder.position.fromArray(def.offset ?? [0, 0, 0]);
  holder.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = false;
      object.frustumCulled = false;
    }
  });
  return holder;
}

/** Loads and caches the prepared weapon/shield props. */
export class WeaponRack {
  constructor(loader) {
    this.loader = loader;
    this.sources = new Map();
  }

  async preload() {
    const defs = [...WEAPONS, SHIELD];
    await Promise.all(
      defs.map(async (def) => {
        const gltf = await this.loader.load(def.file);
        this.sources.set(def.file, gltf.scene);
      }),
    );
  }

  build(def) {
    const source = this.sources.get(def.file);
    if (!source) return null;
    return prepareWeapon(source, def);
  }
}

/* ------------------------------------------------------------------------- */

const BONE = (root, pattern) => {
  let found = null;
  root.traverse((object) => {
    if (!found && object.isBone && pattern.test(object.name)) found = object;
  });
  return found;
};

/**
 * A duelling character: rig + animation state machine + weapon sockets.
 * Combat *rules* live in Game; this class only owns motion and presentation.
 */
export class Fighter {
  constructor({ gltf, rack, side, height, startX, maxHp }) {
    this.side = side; // 'player' | 'enemy'
    this.facing = side === 'player' ? 1 : -1;
    this.rack = rack;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.startX = startX;
    this.dead = false;
    this.blocking = false;
    this.blockStartedAt = -99;
    this.state = 'idle';
    this.timers = [];
    this.moveInput = 0;
    this.weaponIndex = 0;

    this.root = new THREE.Group();
    this.root.name = `${side}-fighter`;

    const model = gltf.scene;
    this.model = model;
    this.root.add(model);
    this.root.position.set(startX, 0, 0);
    this.root.rotation.y = this.facing > 0 ? Math.PI / 2 : -Math.PI / 2;

    // Animation
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = new Map();
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.clips.set(clip.name, { clip, action });
    }
    this.current = null;
    this.mixer.addEventListener('finished', (event) => this.#onFinished(event));

    // Weapon sockets
    this.hands = {
      right: BONE(model, /RightHand$/i) ?? BONE(model, /RightHand/i),
      left: BONE(model, /LeftHand$/i) ?? BONE(model, /LeftHand/i),
    };
    this.sockets = {};
    for (const [key, bone] of Object.entries(this.hands)) {
      const socket = new THREE.Group();
      socket.name = `socket-${key}`;
      bone?.add(socket);
      this.sockets[key] = socket;
    }
    this.attached = { right: null, left: null };

    this.forearms = {
      right: BONE(model, /RightForeArm$/i),
      left: BONE(model, /LeftForeArm$/i),
    };
    this.hipBone = BONE(model, /Hips$/i);
    this.headBone = BONE(model, /Head$/i);

    // The exported rest pose is not the animated pose (Mixamo re-roots the hips
    // in every clip), so pose the rig with its idle clip *before* measuring it.
    this.play('idle', { fade: 0 });
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);

    const boneBox = new THREE.Box3();
    const point = new THREE.Vector3();
    model.traverse((object) => {
      if (object.isBone) boneBox.expandByPoint(object.getWorldPosition(point));
    });
    // The head *bone* sits at the base of the skull: ~12% of the body remains above it.
    const rigHeight = Math.max(0.001, boneBox.max.y - boneBox.min.y);
    const scale = height / (rigHeight * 1.12);
    model.scale.multiplyScalar(scale);
    model.position.y = -boneBox.min.y * scale;
    this.root.updateMatrixWorld(true);

    // Cache the reference wrist frames ONCE. Equipping during a walk, hit or
    // bow recovery must not recalibrate the prop against that transient pose.
    this.referenceHands = {};
    for (const [hand, bone] of Object.entries(this.hands)) {
      if (!bone) continue;
      const wrist = bone.getWorldPosition(new THREE.Vector3());
      const elbow = this.forearms[hand]?.getWorldPosition(new THREE.Vector3());
      this.referenceHands[hand] = {
        quaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
        scale: bone.getWorldScale(new THREE.Vector3()),
        forearm: elbow ? wrist.sub(elbow).normalize() : new THREE.Vector3(0, 1, 0),
      };
    }
    this.equip(WEAPONS[0]);
  }

  /**
   * Aligns a hand socket so the prepared prop (long axis = +Y, flat face = +Z)
   * sits naturally in the fist for the given attachment mode.
   */
  #orientSocket(hand, def) {
    const bone = this.hands[hand];
    const socket = this.sockets[hand];
    if (!bone || !socket) return;
    const reference = this.referenceHands[hand];
    if (!reference) return;

    const facing = new THREE.Vector3(this.facing, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const mode = def.align ?? (hand === 'right' ? 'grip' : 'upright');

    let yDir;
    if (mode === 'grip') {
      // These idle clips hold the fists side by side, NOT along the hilt.
      // Point the blade upward, slightly towards the opponent, out of the fist.
      yDir = new THREE.Vector3(this.facing * 0.25, 1, 0).normalize();
    } else if (mode === 'forearm') {
      // Blade continues the line of the arm — the classic prop-socket heuristic.
      yDir = reference.forearm.clone();
    } else {
      yDir = up.clone();
    }
    let zDir = facing.clone();
    if (Math.abs(yDir.dot(zDir)) > 0.94) zDir.set(0, 0, 1); // degenerate basis guard

    const xAxis = new THREE.Vector3().crossVectors(yDir, zDir).normalize();
    zDir = new THREE.Vector3().crossVectors(xAxis, yDir).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yDir, zDir);
    const worldQuaternion = new THREE.Quaternion().setFromRotationMatrix(basis);

    socket.quaternion.copy(reference.quaternion).invert().multiply(worldQuaternion);
    socket.position.set(0, 0, 0);
    // Weapon lengths are in arena metres, independent of each character's rig scale.
    socket.scale.set(1 / reference.scale.x, 1 / reference.scale.y, 1 / reference.scale.z);
  }

  /* ------------------------------------------------------------ animation */

  has(name) {
    return this.clips.has(name);
  }

  play(name, { loop = true, fade = 0.22, timeScale = 1, clamp = false, reset = true } = {}) {
    const entry = this.clips.get(name) ?? this.clips.get('idle');
    if (!entry) return null;
    const { action } = entry;
    if (this.current === action && loop) {
      action.timeScale = timeScale;
      return action;
    }

    const previous = this.current;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = clamp || !loop;
    action.timeScale = timeScale;
    if (reset) action.reset();
    action.setEffectiveWeight(1);
    if (fade > 0) action.fadeIn(fade);
    else action.stopFading();
    action.play();
    if (previous && previous !== action) {
      if (fade > 0) previous.fadeOut(fade);
      else previous.stop();
    }
    this.current = action;
    this.currentName = name;
    return action;
  }

  duration(name) {
    return this.clips.get(name)?.clip.duration ?? 0.8;
  }

  #onFinished(event) {
    if (this.dead) return;
    if (event.action === this.oneShot) {
      this.oneShot = null;
      this.state = 'idle';
      this.#resumeLocomotion(0.18);
    }
  }

  #resumeLocomotion(fade = 0.2) {
    if (this.dead) return;
    if (this.blocking) {
      this.play('block', { loop: false, clamp: true, fade });
      this.state = 'block';
      return;
    }
    if (this.moveInput > 0) this.play('walk', { fade });
    else if (this.moveInput < 0) this.play(this.has('walkBack') ? 'walkBack' : 'walk', { fade, timeScale: this.has('walkBack') ? 1 : -1 });
    else this.play('idle', { fade });
    this.state = this.moveInput === 0 ? 'idle' : 'move';
  }

  /* --------------------------------------------------------------- combat */

  get busy() {
    return this.dead || this.state === 'attack' || this.state === 'hit' || this.state === 'cast' || this.state === 'dodge';
  }

  /** Evasive roll: plays the slide clip and glides the body along the floor. */
  dodge({ distance = 1.6, direction = -1, invulnerable = 0.5, clampX } = {}) {
    if (this.busy || this.blocking) return 0;
    const clip = this.has('dodge') ? 'dodge' : 'walkBack';
    const duration = this.oneShotClip(clip, { state: 'dodge', timeScale: 1.35 });
    this.invulnerableUntil = performance.now() / 1000 + invulnerable;
    this.slide = { from: this.x, to: clampX ? clampX(this.x + direction * this.facing * distance) : this.x + direction * this.facing * distance, t: 0, duration: duration * 0.7 };
    return duration;
  }

  get invulnerable() {
    return (this.invulnerableUntil ?? 0) > performance.now() / 1000;
  }

  after(seconds, fn) {
    this.timers.push({ t: seconds, fn });
  }

  /** Plays a one-shot clip and locks the state machine for its duration. */
  oneShotClip(name, { state = 'attack', timeScale = 1, onDone } = {}) {
    const action = this.play(name, { loop: false, clamp: true, fade: 0.12, timeScale });
    if (!action) return 0;
    this.oneShot = action;
    this.state = state;
    const duration = this.duration(name) / Math.abs(timeScale || 1);
    if (onDone) this.after(duration * 0.98, onDone);
    return duration;
  }

  attack(weapon, { onImpact } = {}) {
    if (this.busy || this.blocking) return 0;
    const clip = this.has(weapon.clip) ? weapon.clip : 'attack';
    const duration = this.oneShotClip(clip, { timeScale: weapon.speed ?? 1 });
    const action = this.oneShot;
    if (onImpact) this.after(duration * (weapon.impactAt ?? 0.45), () => {
      // A hit reaction/death cancels an unfinished swing, not just its animation.
      if (!this.dead && this.state === 'attack' && this.oneShot === action) onImpact();
    });
    return duration;
  }

  startBlock() {
    if (this.busy || this.blocking) return;
    this.blocking = true;
    this.blockStartedAt = performance.now() / 1000;
    this.state = 'block';
    if (this.weapon?.hand !== 'left') this.#setShield(true, 'left');
    this.play('block', { loop: false, clamp: true, fade: 0.14 });
  }

  stopBlock() {
    if (!this.blocking) return;
    this.blocking = false;
    this.#setShield(false);
    if (this.state === 'block') this.#resumeLocomotion(0.2);
  }

  reactToHit(stun = 0.42) {
    if (this.dead) return;
    this.oneShot = null;
    const clip = this.has('hit') ? 'hit' : 'idle';
    const action = this.play(clip, { loop: false, clamp: true, fade: 0.08, timeScale: Math.max(1, this.duration(clip) / stun) });
    this.oneShot = action;
    this.state = 'hit';
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.blocking = false;
    this.#setShield(false);
    this.oneShot = null;
    this.state = 'dead';
    this.slide = null;
    this.moveInput = 0;
    this.timers.length = 0;
    this.play('death', { loop: false, clamp: true, fade: 0.15 });
  }

  revive() {
    this.dead = false;
    this.hp = this.maxHp;
    this.blocking = false;
    this.state = 'idle';
    this.moveInput = 0;
    this.timers.length = 0;
    this.oneShot = null;
    this.slide = null;
    this.invulnerableUntil = 0;
    this.root.position.set(this.startX, 0, 0);
    for (const { action } of this.clips.values()) action.stop();
    this.current = null;
    this.play('idle', { fade: 0 });
    this.mixer.update(0);
  }

  /* -------------------------------------------------------------- weapons */

  equip(def) {
    // Note: prepared props share geometry/material with the cached source, so
    // detaching must never dispose them. Both hands are cleared first, otherwise
    // swapping away from the bow would leave it stuck in the off hand.
    for (const hand of ['right', 'left']) {
      const held = this.attached[hand];
      if (held) {
        this.sockets[hand].remove(held);
        this.attached[hand] = null;
      }
    }

    const model = this.rack.build(def);
    if (model) {
      this.#orientSocket(def.hand, def);
      this.sockets[def.hand].add(model);
      this.attached[def.hand] = model;
    }
    this.weapon = def;
    // The great-sword clip set keeps both fists on the hilt, so the shield only
    // appears for the block stance (which is a sword-and-shield animation).
    if (this.blocking && def.hand !== 'left') this.#setShield(true, 'left');
    return def;
  }

  #setShield(on, hand = 'left') {
    const existing = this.attached[hand];
    if (!on) {
      if (existing && existing.userData.isShield) {
        this.sockets[hand].remove(existing);
        this.attached[hand] = null;
      }
      return;
    }
    if (existing) return;
    const shieldDef = { ...SHIELD, hand };
    const shield = this.rack.build(shieldDef);
    if (!shield) return;
    shield.userData.isShield = true;
    this.#orientSocket(hand, shieldDef);
    this.sockets[hand].add(shield);
    this.attached[hand] = shield;
  }

  cycleWeapon() {
    this.weaponIndex = (this.weaponIndex + 1) % WEAPONS.length;
    return this.equip(WEAPONS[this.weaponIndex]);
  }

  setWeaponById(id) {
    const index = WEAPONS.findIndex((weapon) => weapon.id === id);
    if (index < 0) return this.weapon;
    this.weaponIndex = index;
    return this.equip(WEAPONS[index]);
  }

  /* ----------------------------------------------------------- transforms */

  get x() {
    return this.root.position.x;
  }

  worldPoint(target = new THREE.Vector3(), height = 1.2) {
    return target.set(this.root.position.x, height, this.root.position.z);
  }

  handPoint(hand = 'right', target = new THREE.Vector3()) {
    const socket = this.sockets[hand] ?? this.sockets.right;
    if (!socket) return this.worldPoint(target, 1.2);
    return socket.getWorldPosition(target);
  }

  chestPoint(target = new THREE.Vector3()) {
    if (this.headBone) {
      this.headBone.getWorldPosition(target);
      target.y -= 0.22;
      return target;
    }
    return this.worldPoint(target, 1.25);
  }

  setMove(direction) {
    if (this.moveInput === direction) return;
    this.moveInput = direction;
    if (!this.busy && !this.blocking) this.#resumeLocomotion();
  }

  update(dt) {
    if (this.slide) {
      this.slide.t += dt;
      const k = Math.min(1, this.slide.t / this.slide.duration);
      this.root.position.x = this.slide.from + (this.slide.to - this.slide.from) * (1 - Math.pow(1 - k, 3));
      if (k >= 1) this.slide = null;
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const timer = this.timers[i];
      timer.t -= dt;
      if (timer.t <= 0) {
        this.timers.splice(i, 1);
        timer.fn();
      }
    }
    this.mixer.update(dt);
  }
}
