// Ember Run 3D — tiny WebAudio sounds, no files, no network.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engine = null;
    this.engineGain = null;
  }

  ensure() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.engine = this.ctx.createOscillator();
      this.engine.type = 'sawtooth';
      this.engine.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engine.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);
      this.engine.start();
    } catch {
      this.ctx = null;
    }
  }

  setThrottle(t) {
    if (!this.ctx || this.muted) return;
    this.engine.frequency.value = 45 + t * 70;
    this.engineGain.gain.value = 0.015 + t * 0.02;
  }

  blip(freq, dur = 0.12, type = 'sine', vol = 0.12) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + dur);
  }

  ring() { this.blip(880, 0.15); setTimeout(() => this.blip(1320, 0.18), 70); }
  rescue() { this.blip(523, 0.15); setTimeout(() => this.blip(659, 0.15), 90); setTimeout(() => this.blip(784, 0.25), 180); }
  hit() { this.blip(110, 0.25, 'square', 0.15); }
  land() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.2), i * 110)); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.engineGain) this.engineGain.gain.value = 0;
    return this.muted;
  }
}
