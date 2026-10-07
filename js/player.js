// Runs the show: walks through the beats, waits for each shove to land,
// has the narrator read the post, holds a moment, moves on.

const HOLD = 0.5;

export class Player {
  constructor({ stage, narrator, assets, onBeat, onState, onEnd }) {
    this.stage = stage;
    this.narrator = narrator;
    this.assets = assets;
    this.onBeat = onBeat || (() => {});
    this.onState = onState || (() => {});
    this.onEnd = onEnd || (() => {});
    this.beats = [];
    this.index = 0;
    this.phase = 'empty'; // empty | ready | enter | speak | hold | ended
    this.playing = false;
    this.line = null;
    this.lineDone = false;
    this.holdT = 0;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  load(beats, cast, titleCard) {
    this.cancelLine();
    this.beats = beats;
    this.stage.clear();
    this.stage.setCast(cast);
    this.index = 0;
    this.playing = false;
    this.titleCard = titleCard;
    if (beats.length) {
      this.showBeat(0, true);
      this.stage.emptyStage(titleCard);
      this.phase = 'ready';
    } else {
      this.phase = 'empty';
    }
    this.onState(this.state());
  }

  state() {
    return { playing: this.playing, index: this.index, total: this.beats.length, phase: this.phase };
  }

  showBeat(i, instant) {
    this.index = i;
    const beat = this.beats[i];
    const { avatar, image } = this.assets.get(beat);
    this.stage.setBeat(beat, { index: i, total: this.beats.length, avatar, image, instant });
    this.assets.prefetch(this.beats, i);
    this.narrator.prefetch(this.beats, i);
    this.onBeat(i);
  }

  cancelLine() {
    if (this.line) this.line.cancel();
    this.line = null;
    this.lineDone = false;
  }

  play() {
    if (!this.beats.length) return;
    if (this.phase === 'ended') return this.restart();
    this.playing = true;
    if (this.phase === 'ready') {
      // first press: walk the first caveman in from scratch
      this.stage.clear();
      this.showBeat(this.index, false);
      this.phase = 'enter';
    } else if (this.line) {
      this.line.resume();
    }
    this.onState(this.state());
  }

  pause() {
    this.playing = false;
    if (this.line) this.line.pause();
    this.onState(this.state());
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  restart() {
    this.cancelLine();
    this.stage.clear();
    this.playing = true;
    this.showBeat(0, false);
    this.phase = 'enter';
    this.onState(this.state());
  }

  jump(i) {
    if (!this.beats.length) return;
    i = Math.max(0, Math.min(this.beats.length - 1, i));
    this.cancelLine();
    this.showBeat(i, !this.playing);
    this.phase = 'enter';
    this.onState(this.state());
  }

  /** Start playing at beat i: a shove if we're mid-show, a fresh entrance if not. */
  playFrom(i) {
    if (!this.beats.length) return;
    i = Math.max(0, Math.min(this.beats.length - 1, i));
    this.cancelLine();
    if (!this.playing || this.phase === 'ready' || this.phase === 'ended') this.stage.clear();
    this.playing = true;
    this.showBeat(i, false);
    this.phase = 'enter';
    this.onState(this.state());
  }

  next() { this.jump(this.index + 1); }
  prev() { this.jump(this.index - 1); }

  startLine() {
    const beat = this.beats[this.index];
    this.lineDone = false;
    const line = this.narrator.speak(beat);
    this.line = line;
    line.done.then(() => {
      if (this.line !== line) return;
      if (line.fallback) {
        // OpenAI failed for this one: say it with the browser voice instead
        const again = this.narrator.speak(beat, { browserOnly: true });
        this.line = again;
        if (!this.playing) again.pause();
        again.done.then(() => { if (this.line === again) this.lineDone = true; });
        return;
      }
      this.lineDone = true;
    });
    if (!this.playing) line.pause();
  }

  frame(ts) {
    const dt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    if (this.phase !== 'empty') {
      if (this.playing) {
        this.stage.update(dt);
        this.advance(dt);
      } else if (this.phase === 'ready' || this.phase === 'ended') {
        this.stage.update(dt * 0.5);
      }
      this.stage.render(dt);
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  advance(dt) {
    switch (this.phase) {
      case 'enter':
        if (!this.stage.transitioning) {
          this.phase = 'speak';
          this.startLine();
        }
        break;
      case 'speak': {
        const l = this.line;
        if (l) this.stage.setSpeech({ speaking: l.speaking(), progress: l.progress(), level: l.level() });
        if (this.lineDone) {
          this.line = null;
          this.stage.setSpeech({ speaking: false, progress: 1, level: 0 });
          this.phase = 'hold';
          this.holdT = 0;
        }
        break;
      }
      case 'hold':
        this.holdT += dt;
        if (this.holdT >= HOLD) {
          if (this.index + 1 < this.beats.length) {
            this.showBeat(this.index + 1, false);
            this.phase = 'enter';
          } else {
            this.phase = 'ended';
            this.playing = false;
            this.stage.finish();
            this.onState(this.state());
            this.onEnd();
          }
        }
        break;
      default:
        break;
    }
  }
}
