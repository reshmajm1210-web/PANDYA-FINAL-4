/**
 * Tiny procedural sound kit — no audio files to download. Everything is
 * synthesised with oscillators and noise buffers on first user interaction.
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
    this.noise = this.#noiseBuffer();
  }

  #noiseBuffer() {
    const length = this.ctx.sampleRate * 0.6;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    return buffer;
  }

  #env(node, { attack = 0.005, decay = 0.25, peak = 1 } = {}) {
    const now = this.ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(0.0001, now);
    node.gain.linearRampToValueAtTime(peak, now + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  }

  #tone({ type = 'sine', frequency = 220, to, decay = 0.25, peak = 0.6, detune = 0 }) {
    if (!this.ctx || this.muted) return;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.detune.value = detune;
    oscillator.frequency.setValueAtTime(frequency, this.ctx.currentTime);
    if (to) oscillator.frequency.exponentialRampToValueAtTime(to, this.ctx.currentTime + decay);
    this.#env(gain, { decay, peak });
    oscillator.connect(gain).connect(this.master);
    oscillator.start();
    oscillator.stop(this.ctx.currentTime + decay + 0.05);
  }

  #noiseHit({ decay = 0.2, peak = 0.5, frequency = 1800, q = 1.2 }) {
    if (!this.ctx || this.muted) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    this.#env(gain, { decay, peak });
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    source.stop(this.ctx.currentTime + decay + 0.05);
  }

  swing() {
    this.#noiseHit({ decay: 0.16, peak: 0.22, frequency: 900, q: 0.7 });
  }

  hit(crit = false) {
    this.#noiseHit({ decay: crit ? 0.32 : 0.2, peak: crit ? 0.8 : 0.55, frequency: crit ? 2600 : 1700, q: 1.6 });
    this.#tone({ type: 'triangle', frequency: crit ? 180 : 130, to: 55, decay: 0.28, peak: 0.35 });
  }

  parry() {
    this.#tone({ type: 'square', frequency: 1400, to: 700, decay: 0.22, peak: 0.16 });
    this.#noiseHit({ decay: 0.25, peak: 0.4, frequency: 3400, q: 3 });
  }

  heal() {
    [523, 659, 784].forEach((frequency, index) => {
      setTimeout(() => this.#tone({ type: 'sine', frequency, decay: 0.5, peak: 0.24 }), index * 90);
    });
  }

  swap() {
    this.#tone({ type: 'square', frequency: 880, to: 1320, decay: 0.12, peak: 0.12 });
  }

  bow() {
    this.#tone({ type: 'sawtooth', frequency: 260, to: 90, decay: 0.22, peak: 0.18 });
    this.#noiseHit({ decay: 0.18, peak: 0.3, frequency: 2200, q: 2 });
  }

  win() {
    [523, 659, 784, 1046].forEach((frequency, index) => {
      setTimeout(() => this.#tone({ type: 'triangle', frequency, decay: 0.5, peak: 0.3 }), index * 130);
    });
  }

  lose() {
    [392, 330, 262, 196].forEach((frequency, index) => {
      setTimeout(() => this.#tone({ type: 'sawtooth', frequency, decay: 0.6, peak: 0.22 }), index * 160);
    });
  }
}
