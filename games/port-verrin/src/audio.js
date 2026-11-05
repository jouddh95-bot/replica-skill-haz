// Tiny synthesized sound: engine hum, siren, UI blips. No audio files.
export class Audio {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      const ctx = this.ctx;
      this.master = ctx.createGain(); this.master.gain.value = 0.35; this.master.connect(ctx.destination);
      // engine
      this.eng = ctx.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 50;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      this.eng.connect(lp).connect(this.engGain).connect(this.master); this.eng.start();
      // siren
      this.sir = ctx.createOscillator(); this.sir.type = 'triangle'; this.sir.frequency.value = 700;
      this.sirGain = ctx.createGain(); this.sirGain.gain.value = 0;
      this.sir.connect(this.sirGain).connect(this.master); this.sir.start();
    } catch { this.ctx = null; }
  }
  update(t, engineOn, speed, siren, sirenDist) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.eng.frequency.setTargetAtTime(45 + Math.abs(speed) * 4.2, now, 0.08);
    this.engGain.gain.setTargetAtTime(engineOn ? 0.12 + Math.min(Math.abs(speed), 30) / 200 : 0, now, 0.1);
    const ph = (t * 0.9) % 1;
    this.sir.frequency.setTargetAtTime(ph < 0.5 ? 640 : 860, now, 0.05);
    const v = siren ? Math.max(0, 0.11 * (1 - sirenDist / 140)) : 0;
    this.sirGain.gain.setTargetAtTime(v, now, 0.15);
  }
  tone(freq, dur, type = 'square', vol = 0.12, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + when;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  blip(f = 600) { this.tone(f, 0.09, 'square', 0.08); }
  cash() { this.tone(988, 0.08, 'square', 0.1); this.tone(1319, 0.22, 'square', 0.1, 0.08); }
  phone() { this.tone(1200, 0.07, 'sine', 0.15); this.tone(1500, 0.07, 'sine', 0.15, 0.1); this.tone(1200, 0.07, 'sine', 0.15, 0.2); }
  horn() { this.tone(330, 0.3, 'sawtooth', 0.12); this.tone(415, 0.3, 'sawtooth', 0.08); }
  crash(v) { this.tone(80, 0.25, 'sawtooth', Math.min(0.25, v / 80)); }
  _noise() {
    if (!this._nb) {
      const ctx = this.ctx, n = ctx.sampleRate * 1.2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._nb = b;
    }
    return this._nb;
  }
  burst(dur, freq, vol, q = 0.8) {
    if (!this.ctx) return;
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t0 = ctx.currentTime;
    src.buffer = this._noise(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.master); src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }
  gun(kind = 1, k = 1) { this.burst(0.18 * kind, 1400, 0.55 * k, 0.6); this.burst(0.25 * kind, 180, 0.6 * k, 0.9); }
  punch() { this.burst(0.08, 300, 0.4, 1.2); }
  explode() { this.burst(1.4, 90, 1.0, 0.5); this.burst(0.6, 600, 0.5, 0.5); }
  bad() { this.tone(220, 0.3, 'sawtooth', 0.15); this.tone(165, 0.5, 'sawtooth', 0.15, 0.25); }
}
