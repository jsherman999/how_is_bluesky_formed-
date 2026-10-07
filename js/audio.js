// One Web Audio graph for everything we can actually route: OpenAI voice
// clips and the shove sound effects. It feeds both the speakers and a
// MediaStream the recorder can capture. (Browser speech synthesis can't be
// routed here; the browser plays it directly.)

export class AudioHub {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.levelBuf = null;
  }

  /** Must be called from a user gesture the first time. */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.recordDest = ctx.createMediaStreamDestination();
      this.master.connect(this.recordDest);

      this.el = new Audio();
      this.el.preload = 'auto';
      const src = ctx.createMediaElementSource(this.el);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.levelBuf = new Float32Array(this.analyser.fftSize);
      src.connect(this.analyser);
      this.analyser.connect(this.master);
      this.setMuted(this.muted);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this;
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
  }

  /** Loudness of the voice clip right now, 0..1, for the mouth. */
  level() {
    if (!this.analyser || this.el.paused) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) sum += this.levelBuf[i] * this.levelBuf[i];
    const rms = Math.sqrt(sum / this.levelBuf.length);
    return Math.min(1, Math.max(0, (rms - 0.012) * 7));
  }

  noise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** Cartoon body-slam: a low thump plus a puff of noise. */
  thud() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.32);

    const n = this.noise(0.25);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t);
  }

  /** Rising whistle as someone sails off screen. */
  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }
}
