import { AI } from '../config.js';

const rand = (min, max) => min + Math.random() * (max - min);

/**
 * Enemy king brain. Fully autonomous: it closes distance, swings, parries the
 * player's attacks, backs off to reset spacing and rages when wounded.
 * Difficulty ramps a little each time the player loses a life.
 */
export class EnemyBrain {
  constructor({ self, target, actions }) {
    this.self = self;
    this.target = target;
    this.actions = actions;
    this.reset(0);
  }

  reset(round = 0) {
    const ramp = AI.perRoundRamp;
    const base = AI.base;
    this.traits = {
      reaction: Math.max(0.18, base.reaction + ramp.reaction * round),
      aggression: Math.min(0.95, base.aggression + ramp.aggression * round),
      blockChance: Math.min(0.8, base.blockChance + ramp.blockChance * round),
      retreatChance: base.retreatChance,
      damage: base.damage + ramp.damage * round,
      range: base.range,
      attackCooldown: [
        Math.max(0.7, base.attackCooldown[0] + ramp.attackCooldown[0] * round),
        Math.max(1.1, base.attackCooldown[1] + ramp.attackCooldown[1] * round),
      ],
    };
    this.thinkIn = 0.6;
    this.attackIn = rand(1.1, 1.8);
    this.blockFor = 0;
    this.retreatFor = 0;
    this.raged = false;
    this.enabled = true;
  }

  get damage() {
    return this.traits.damage * (this.raged ? 1.3 : 1);
  }

  /** Called by the game when the player starts a swing — lets the AI parry. */
  onPlayerAttack() {
    if (!this.enabled || this.self.dead || this.self.busy) return;
    const distance = Math.abs(this.self.x - this.target.x);
    if (distance > this.traits.range + 1.1) return;
    if (Math.random() > this.traits.blockChance) return;
    // Sometimes roll out of the way instead of parrying (villain pack slide clip).
    if (this.actions.dodge && Math.random() < 0.35) {
      this.actions.dodge();
      return;
    }
    this.blockFor = rand(0.5, 0.95);
    this.actions.block(true);
  }

  update(dt) {
    const self = this.self;
    if (!this.enabled || self.dead || this.target.dead) return;

    if (this.blockFor > 0) {
      this.blockFor -= dt;
      if (this.blockFor <= 0) this.actions.block(false);
    }

    this.attackIn -= dt;
    this.thinkIn -= dt;
    if (this.retreatFor > 0) this.retreatFor -= dt;

    // Enrage once, below a third of health.
    if (!this.raged && self.hp <= self.maxHp * 0.34 && !self.busy && !self.blocking) {
      this.raged = true;
      this.actions.rage();
      this.thinkIn = 1.4;
      return;
    }

    if (this.thinkIn > 0) return;
    this.thinkIn = rand(this.traits.reaction * 0.5, this.traits.reaction);

    if (self.busy || self.blocking) return;

    const distance = Math.abs(self.x - this.target.x);
    const inRange = distance <= this.traits.range;

    if (this.retreatFor > 0) {
      this.actions.move(-1);
      return;
    }

    if (inRange && this.attackIn <= 0) {
      this.actions.move(0);
      this.actions.attack();
      this.attackIn = rand(this.traits.attackCooldown[0], this.traits.attackCooldown[1]);
      if (Math.random() < this.traits.retreatChance) this.retreatFor = rand(0.4, 0.9);
      return;
    }

    if (!inRange) {
      // Hold a beat sometimes so it reads as a duel, not a bulldozer.
      this.actions.move(Math.random() < this.traits.aggression ? 1 : 0);
      return;
    }

    // In range but on cooldown: bob in and out of measure.
    if (Math.random() < 0.35) this.actions.move(-1);
    else this.actions.move(0);
  }
}
