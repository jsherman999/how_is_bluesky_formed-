// Narration. Two engines behind one interface:
//   - browser: the Web Speech API, free, with a different voice and pitch
//     per caveman. Can't be recorded.
//   - openai:  OpenAI text-to-speech clips played through the AudioHub,
//     so they can be recorded and drive the mouth from real loudness.
// speak(beat) returns a Line with progress(), level(), pause(), resume(),
// cancel() and a `done` promise.

import { speechText, estimateSpeechSeconds } from './thread.js';
import { hash32, noise1 } from './util.js';
import { synthesize, voicesFor } from './openai.js';

const NOVELTY = /^(Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;
const PITCHES = [0.85, 1.15, 0.7, 1.3, 1.0, 0.78, 1.22, 0.92, 1.08];

const PERSONAS = [
  'gruff and gravelly',
  'high-pitched and nasal',
  'booming and theatrical',
  'whiny and put-upon',
  'slow and a bit dim',
  'excitable and squeaky',
  'deadpan and flat',
  'wheezy old-timer',
  'mumbly and unsure',
  'over-enunciating like a bad actor',
];

const BASE_STYLE =
  'You are a caveman in a crude 2008 Flash cartoon, reading a social media post out loud for the first time. ' +
  'Read slowly and earnestly, word by word, pronouncing everything exactly as it is written (typos, slang, and all) ' +
  'with slightly awkward pauses, like the "How is babby formed" video.';

function moodFor(beat) {
  const p = beat.pile;
  if (!p) return '';
  if (p.role === 'target') return ' A whole mob is ganging up on you: flustered, defensive, a little panicked.';
  if (p.role === 'attacker') return ' You are piling on someone with a mob behind you: indignant and self-righteous.';
  return '';
}

function splitChunks(text, max = 170) {
  const out = [];
  const parts = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  let buf = '', start = 0, pos = 0;
  for (const part of parts) {
    if (buf && (buf + part).length > max) {
      out.push({ text: buf, start, end: pos });
      start = pos;
      buf = '';
    }
    buf += part;
    pos += part.length;
    while (buf.length > max) {
      const cut = buf.lastIndexOf(' ', max) > 40 ? buf.lastIndexOf(' ', max) : max;
      out.push({ text: buf.slice(0, cut), start, end: start + cut });
      start += cut;
      buf = buf.slice(cut);
    }
  }
  if (buf.trim()) out.push({ text: buf, start, end: pos });
  return out.length ? out : [{ text, start: 0, end: text.length }];
}

/* ------------------------------------------------------------ lines */

class SilentLine {
  constructor(text, rate) {
    this.text = text;
    this.dur = estimateSpeechSeconds(text, rate);
    this.elapsed = 0;
    this.last = performance.now();
    this.paused = false;
    this.done = new Promise((r) => (this._resolve = r));
    this.tick = setInterval(() => this.step(), 50);
  }
  step() {
    const now = performance.now();
    if (!this.paused) this.elapsed += (now - this.last) / 1000;
    this.last = now;
    if (this.elapsed >= this.dur) this.finish();
  }
  finish() { clearInterval(this.tick); this._resolve(); }
  progress() { return Math.min(1, this.elapsed / this.dur); }
  speaking() { return !this.paused && this.elapsed < this.dur; }
  level() {
    if (!this.speaking()) return 0;
    const t = performance.now() / 1000;
    return Math.max(0, 0.2 + 0.8 * Math.abs(Math.sin(t * 11)) * (0.65 + 0.35 * noise1(t * 3, 5)));
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.last = performance.now(); }
  cancel() { this.finish(); }
}

class BrowserLine {
  constructor(text, spec, rate, muted) {
    this.text = text;
    this.spec = spec;
    this.rate = rate * spec.rate;
    this.muted = muted;
    this.chunks = splitChunks(text);
    this.i = 0;
    this.token = 0;
    this.charIndex = 0;
    this.gotBoundary = false;
    this.est = estimateSpeechSeconds(text, this.rate * 1.1);
    this.elapsed = 0;
    this.last = performance.now();
    this.active = false;
    this.paused = false;
    this.finished = false;
    this.done = new Promise((r) => (this._resolve = r));
    this.shown = 0;
    // the clock only runs while the engine is actually talking, because
    // the first utterance can take a second or two to start
    this.clock = setInterval(() => {
      const now = performance.now();
      if (!this.paused && this.active) this.elapsed += (now - this.last) / 1000;
      this.last = now;
    }, 50);
    this.play();
  }

  play() {
    if (this.finished || this.paused) return;
    if (this.i >= this.chunks.length) return this.finish();
    const token = ++this.token;
    const chunk = this.chunks[this.i];
    const u = new SpeechSynthesisUtterance(chunk.text);
    if (this.spec.voice) { u.voice = this.spec.voice; u.lang = this.spec.voice.lang; }
    u.pitch = this.spec.pitch;
    u.rate = this.rate;
    u.volume = this.muted ? 0 : 1;
    const advance = () => {
      if (token !== this.token) return;
      this.token++;
      clearTimeout(this.watchdog);
      this.active = false;
      this.charIndex = chunk.end;
      this.i++;
      this.play();
    };
    u.onstart = () => { if (token === this.token) this.active = true; };
    u.onboundary = (e) => {
      if (token !== this.token || (e.name && e.name !== 'word')) return;
      this.active = true;
      this.gotBoundary = true;
      this.charIndex = chunk.start + e.charIndex;
      this.lastBoundary = performance.now();
    };
    u.onend = advance;
    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      advance();
    };
    const chunkSecs = estimateSpeechSeconds(chunk.text, this.rate);
    this.watchdog = setTimeout(() => {
      if (token !== this.token) return;
      speechSynthesis.cancel();
      advance();
    }, chunkSecs * 2500 + 5000);
    speechSynthesis.speak(u);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.active = false;
    this.token++;
    clearTimeout(this.watchdog);
    clearInterval(this.clock);
    this._resolve();
  }

  progress() {
    if (this.finished) return 1;
    let p;
    if (this.gotBoundary) {
      p = this.charIndex / Math.max(1, this.text.length);
    } else {
      const c = this.chunks[this.i];
      const lo = c ? c.start / this.text.length : 1;
      const hi = c ? c.end / this.text.length : 1;
      p = Math.min(hi * 0.98, Math.max(lo, this.elapsed / this.est));
    }
    this.shown = Math.max(this.shown, Math.min(1, p));
    return this.shown;
  }

  speaking() {
    return !this.finished && !this.paused;
  }

  level() {
    if (!this.speaking() || !this.active) return 0;
    const t = performance.now() / 1000;
    return Math.max(0, 0.15 + 0.85 * Math.abs(Math.sin(t * 10.5)) * (0.6 + 0.4 * noise1(t * 2.7, 9)));
  }

  pause() {
    if (this.finished) return;
    this.paused = true;
    this.token++;
    clearTimeout(this.watchdog);
    speechSynthesis.cancel();
  }

  resume() {
    if (this.finished || !this.paused) return;
    this.paused = false;
    this.last = performance.now();
    this.play();
  }

  cancel() {
    this.token++;
    speechSynthesis.cancel();
    this.finish();
  }
}

class ClipLine {
  constructor(hub, blobPromise, rate, onError) {
    this.hub = hub;
    this.finished = false;
    this.paused = false;
    this.started = false;
    this.done = new Promise((r) => (this._resolve = r));
    blobPromise.then((blob) => {
      if (this.finished) return;
      const el = hub.el;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(blob);
      el.src = this.url;
      el.playbackRate = rate;
      el.preservesPitch = true;
      el.onended = () => this.finish();
      el.onerror = () => this.finish();
      this.started = true;
      if (!this.paused) el.play().catch(() => this.finish());
    }, (err) => {
      if (onError) onError(err);
      this.fallback = true;
      this.finish();
    });
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    const el = this.hub.el;
    if (el) { el.onended = null; el.onerror = null; }
    setTimeout(() => { if (this.url) URL.revokeObjectURL(this.url); }, 1000);
    this._resolve();
  }
  progress() {
    const el = this.hub.el;
    if (this.finished) return 1;
    if (!this.started || !el.duration || !isFinite(el.duration)) return 0;
    return Math.min(1, el.currentTime / el.duration);
  }
  speaking() { return this.started && !this.finished && !this.paused; }
  level() { return this.speaking() ? this.hub.level() : 0; }
  pause() { this.paused = true; if (this.started) this.hub.el.pause(); }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.started && !this.finished) this.hub.el.play().catch(() => this.finish());
  }
  cancel() { if (this.hub.el) this.hub.el.pause(); this.finish(); }
}

/* ------------------------------------------------------------ narrator */

export class Narrator {
  constructor(hub) {
    this.hub = hub;
    this.mode = 'browser';
    this.key = '';
    this.model = 'gpt-4o-mini-tts';
    this.rate = 1;
    this.muted = false;
    this.voices = [];
    this.specs = new Map();
    this.clips = new Map();
    this.onError = null;
  }

  configure({ mode, key, model, rate, muted }) {
    if (mode !== undefined) this.mode = mode;
    if (key !== undefined) this.key = key;
    if (model !== undefined && model !== this.model) { this.model = model; this.clips.clear(); }
    if (rate !== undefined) this.rate = rate;
    if (muted !== undefined) this.muted = muted;
  }

  get recordable() {
    return this.mode === 'openai' && !!this.key;
  }

  static loadBrowserVoices(timeoutMs = 1500) {
    if (!('speechSynthesis' in window)) return Promise.resolve([]);
    const now = speechSynthesis.getVoices();
    if (now.length) return Promise.resolve(now);
    return new Promise((resolve) => {
      const done = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, timeoutMs);
    });
  }

  async assignVoices(cast) {
    const all = await Narrator.loadBrowserVoices();
    let pool = all.filter((v) => /^en/i.test(v.lang) && !NOVELTY.test(v.name));
    // local voices first: they report word boundaries and never time out
    pool.sort((a, b) => (b.localService - a.localService) || a.name.localeCompare(b.name));
    const seen = new Set();
    pool = pool.filter((v) => (seen.has(v.name) ? false : seen.add(v.name)));
    this.voices = pool;
    this.specs.clear();
    const ordered = [...cast.values()].sort((a, b) => a.order - b.order);
    ordered.forEach((c, i) => {
      const h = hash32(c.did);
      this.specs.set(c.did, {
        voice: pool.length ? pool[(i + (h % 3)) % pool.length] : null,
        pitch: PITCHES[(i + (h % PITCHES.length)) % PITCHES.length],
        rate: 0.88 + (h % 5) * 0.03,
        aiSlot: i + (h % 13),
        persona: PERSONAS[h % PERSONAS.length],
      });
    });
  }

  specFor(did) {
    const spec = this.specs.get(did) || { voice: null, pitch: 1, rate: 1, aiSlot: 0, persona: PERSONAS[0] };
    // older TTS models know fewer voices, so pick from whatever the current model has
    const ai = voicesFor(this.model);
    return { ...spec, ai: ai[spec.aiSlot % ai.length] };
  }

  clipFor(beat) {
    const spec = this.specFor(beat.speaker);
    const id = `${beat.post.uri}|${spec.ai}|${beat.pile ? beat.pile.role : ''}`;
    let p = this.clips.get(id);
    if (!p) {
      p = synthesize({
        key: this.key,
        model: this.model,
        voice: spec.ai,
        text: speechText(beat.post),
        instructions: `${BASE_STYLE} Your voice: ${spec.persona}.${moodFor(beat)}`,
      });
      p.catch(() => this.clips.delete(id));
      this.clips.set(id, p);
    }
    return p;
  }

  prefetch(beats, from, count = 3) {
    if (this.mode !== 'openai' || !this.key) return;
    for (let i = from; i < Math.min(beats.length, from + count); i++) this.clipFor(beats[i]);
  }

  speak(beat, { browserOnly = false } = {}) {
    const text = speechText(beat.post);
    if (this.mode === 'off') return new SilentLine(text, this.rate);
    if (this.mode === 'openai' && this.key && !browserOnly) {
      return new ClipLine(this.hub, this.clipFor(beat), this.rate, (err) => this.onError && this.onError(err));
    }
    if (!('speechSynthesis' in window)) return new SilentLine(text, this.rate);
    return new BrowserLine(text, this.specFor(beat.speaker), this.rate, this.muted);
  }

  stopAll() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.hub.el) this.hub.el.pause();
  }
}
