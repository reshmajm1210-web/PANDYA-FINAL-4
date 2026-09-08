/**
 * Central tuning table. Everything a designer would want to touch lives here so
 * the systems modules stay about behaviour, not numbers.
 *
 * Distances are expressed in metres of the *arena* (a fighter is ~1.85 m tall).
 * Weapon `length` / `grip` are in weapon-model space and get normalised on load.
 */

export const ARENA = {
  playerStart: -2.55,
  enemyStart: 2.55,
  bounds: { min: -5.2, max: 5.2 },
  contactGap: 1.35, // fighters never walk closer than this
  fighterHeight: 1.85,
};

export const CAMERA = {
  fov: 40,
  position: [0.6, 2.55, 8.6],
  target: [0, 1.25, 0],
  swayAmplitude: 0.09,
  swaySpeed: 0.18,
};

export const COMBAT = {
  maxHp: 100,
  lives: 3,
  moveSpeed: 2.0,
  backSpeed: 1.5,
  blockReduction: 0.25, // damage multiplier while blocking
  perfectBlockWindow: 0.32, // seconds after pressing defend
  perfectBlockReduction: 0.06,
  critChance: 0.18,
  critMultiplier: 1.7,
  heal: { amount: 32, cooldown: 13, charges: 3 },
  bowCooldown: 3.4,
  hitStun: 0.42,
  coinsPerHit: [3, 7],
  coinsPerKill: 45,
  gemsPerPerfectBlock: 1,
  gemsPerCrit: 1,
  gemsPerKill: 5,
};

/**
 * Weapon rack — cycled by the WEAPON button in this order.
 *
 * `align` picks how the prop is fitted to the hand:
 *   'grip'    → long axis follows the rig's own two-fist hilt axis
 *   'upright' → long axis stands vertical (bows, shields)
 * `grip` is where along the model the hand holds it (0 = butt, 1 = tip).
 */
export const WEAPONS = [
  {
    id: 'sword',
    name: 'Vaal',
    label: 'Sword',
    file: 'weapons/sword.glb',
    hand: 'right',
    align: 'grip',
    twoHanded: true,
    length: 1.15,
    grip: 0.14,
    rotation: [0, 0, 0],
    offset: [0, 0, 0],
    damage: 13,
    range: 2.45,
    speed: 1,
    clip: 'attack',
    impactAt: 0.42,
    trail: '#ffe9b0',
  },
  {
    id: 'valari',
    name: 'Valari',
    label: 'Valari',
    file: 'weapons/valari.glb',
    hand: 'right',
    align: 'grip',
    twoHanded: false,
    length: 0.66,
    grip: 0.5,
    rotation: [0, 0, 0],
    offset: [0, 0, 0],
    damage: 10,
    range: 2.25,
    speed: 1.32,
    clip: 'attackSpin',
    impactAt: 0.38,
    trail: '#ffd07a',
  },
  {
    id: 'vel',
    name: 'Vel',
    label: 'Spear',
    file: 'weapons/vel.glb',
    hand: 'right',
    align: 'grip',
    twoHanded: true,
    length: 2.1,
    grip: 0.3,
    rotation: [0, 0, 0],
    offset: [0, 0, 0],
    damage: 16,
    range: 3.05,
    speed: 0.82,
    clip: 'attack',
    impactAt: 0.46,
    trail: '#cfe9ff',
  },
  {
    id: 'bow',
    name: 'Vil',
    label: 'Bow',
    file: 'weapons/bow.glb',
    hand: 'left',
    align: 'upright',
    length: 1.3,
    grip: 0.5,
    rotation: [0, 90, 0],
    offset: [0, 0, 0],
    damage: 11,
    range: 9,
    speed: 1,
    clip: 'bow',
    impactAt: 0.55,
    ranged: true,
    trail: '#bfe6ff',
  },
];

export const SHIELD = {
  id: 'shield',
  file: 'weapons/shield.glb',
  hand: 'left',
  align: 'upright',
  length: 0.8,
  grip: 0.5,
  rotation: [0, 0, 0],
  offset: [0, 0, 0.06],
};

/** Enemy behaviour. Gets slightly sharper every time the player loses a life. */
export const AI = {
  base: {
    reaction: 0.55,
    aggression: 0.62,
    blockChance: 0.34,
    retreatChance: 0.16,
    damage: 11,
    range: 2.5,
    attackCooldown: [1.5, 2.6],
  },
  perRoundRamp: {
    reaction: -0.08,
    aggression: 0.1,
    blockChance: 0.06,
    damage: 1.8,
    attackCooldown: [-0.2, -0.35],
  },
};

export const ASSETS = {
  hero: 'characters/hero.glb',
  villain: 'characters/villain.glb',
  scenery: {
    palace: 'scenery/palace.glb',
    tower: 'scenery/tower.glb',
    temple: 'scenery/temple.glb',
  },
};

export const BASE_URL = 'assets/';
