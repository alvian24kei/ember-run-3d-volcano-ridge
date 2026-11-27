// Ember Run 3D — keyboard input.
// Arrows steer (Up = climb, Down = descend, Left/Right = bank), W/S throttle,
// P pause, M mute, Enter start/restart.
export class Input {
  constructor() {
    this.keys = new Set();
    this.onEnter = null;
    this.onPause = null;
    this.onMute = null;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Enter' && this.onEnter) this.onEnter();
      if ((e.key === 'p' || e.key === 'P') && this.onPause) this.onPause();
      if ((e.key === 'm' || e.key === 'M') && this.onMute) this.onMute();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** { pitch, bank, throttle } for this frame; throttle persists. */
  read(throttle) {
    const k = this.keys;
    const pitch = (k.has('arrowup') ? 1 : 0) + (k.has('arrowdown') ? -1 : 0);
    const bank = (k.has('arrowleft') || k.has('a') ? -1 : 0) + (k.has('arrowright') || k.has('d') ? 1 : 0);
    let t = throttle;
    if (k.has('w')) t = Math.min(1, t + 0.012);
    if (k.has('s')) t = Math.max(0.25, t - 0.012);
    return { pitch, bank, throttle: t };
  }
}
