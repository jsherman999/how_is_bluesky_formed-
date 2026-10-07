// The director: decides who stands where for each beat, animates the
// shoves and the mob, runs the slow zoom, and paints each frame.

import { makeLook, drawCaveman, defaultPose, faceOffset, headTop } from './caveman.js?v=8';
import { SCENE_W, SCENE_H, GROUND_Y, getBackdrop, drawAmbient } from './scene.js?v=8';
import { Card, FRAME_W, FRAME_H } from './card.js?v=8';
import { clamp, lerp, ease, seg, noise1, hash32 } from './util.js?v=8';

/* ------------------------------------------------------------ layout */

const MOB_ROWS = [
  { n: 4, x0: 0.66, dx: 0.086, depth: 0, scale: 0.9 },
  { n: 4, x0: 0.705, dx: 0.086, depth: 1, scale: 0.8 },
  { n: 5, x0: 0.64, dx: 0.076, depth: 2, scale: 0.7 },
];

export function mobSlot(k) {
  let i = k;
  for (const r of MOB_ROWS) {
    if (i < r.n) return { x: r.x0 + r.dx * i, depth: r.depth, scale: r.scale };
    i -= r.n;
  }
  return { x: 0.62 + ((i * 0.137) % 0.36), depth: 3, scale: 0.6 };
}

/**
 * Who is on stage for a beat. x is a fraction of the scene width, depth 0
 * is the front row, facing -1 looks left.
 */
export function layoutFor(beat) {
  const p = beat.pile;
  if (!p) {
    return {
      mode: 'solo',
      slots: [{ did: beat.speaker, role: 'speaker', x: 0.5, depth: 0, scale: 1, facing: -1, enter: 'right' }],
    };
  }
  const slots = [];
  const targetSpeaking = beat.speaker === p.target;
  const shrink = clamp(0.94 - 0.04 * p.size, 0.72, 0.92);
  slots.push({
    did: p.target,
    role: 'target',
    x: targetSpeaking ? 0.24 : 0.15,
    depth: 0,
    scale: targetSpeaking ? Math.min(0.96, shrink + 0.1) : shrink,
    facing: 1,
    enter: 'left',
  });
  if (!targetSpeaking) {
    slots.push({ did: beat.speaker, role: 'speaker', x: 0.47, depth: 0, scale: 1, facing: -1, enter: 'right' });
  }
  p.mob.forEach((did, k) => {
    slots.push({ did, role: 'mob', ...mobSlot(k), facing: -1, enter: 'right', k });
  });
  return { mode: 'pile', slots };
}

/* ------------------------------------------------------------ stage */

const DEPTH_RISE = 26;

export class Stage {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.card = new Card();
    this.looks = new Map();
    this.actors = new Map();
    this.flying = [];
    this.particles = [];
    this.time = 0;
    this.cam = { zoom: 1, cx: SCENE_W / 2, cy: SCENE_H / 2 };
    this.trans = null;
    this.layout = null;
    this.beat = null;
    this.speech = { speaking: false, progress: 0, level: 0 };
    this.names = new Map();
    this.youDid = null;
    this.ended = false;
    this.showTags = true;
    this.titleCard = null; // { title, sub } shown on an empty stage before playback
  }

  setCast(cast) {
    this.names.clear();
    for (const c of cast.values()) this.names.set(c.did, c.handle);
  }

  lookFor(did) {
    let l = this.looks.get(did);
    if (!l) this.looks.set(did, (l = makeLook(did)));
    return l;
  }

  /** Empty the stage but keep the card, for the "press play" state. */
  emptyStage(titleCard) {
    this.actors.clear();
    this.flying = [];
    this.trans = null;
    this.titleCard = titleCard || null;
  }

  clear() {
    this.titleCard = null;
    this.actors.clear();
    this.flying = [];
    this.particles = [];
    this.trans = null;
    this.beat = null;
    this.layout = null;
    this.ended = false;
    this.cam = { zoom: 1, cx: SCENE_W / 2, cy: SCENE_H / 2 };
  }

  get transitioning() {
    return !!this.trans;
  }

  newActor(did) {
    return {
      did,
      look: this.lookFor(did),
      x: 0, depth: 0, scale: 1, facing: -1,
      fromX: 0, toX: 0, fromScale: 1, toScale: 1, fromDepth: 0, toDepth: 0,
      moveStart: 0, moveDur: 0,
      role: 'speaker', slotFacing: -1, exiting: null,
      walking: false, walkPhase: 0,
      seedT: (hash32(did) % 1000) / 37,
      hop: 0,
      pose: defaultPose(),
      fly: null, flyY: 0, rot: 0,
      k: 0,
    };
  }

  /**
   * Sets up the transition into `beat`. With instant=true everyone snaps
   * into place (used for the first paint and for jumps while paused).
   */
  setBeat(beat, { index, total, avatar, image, instant = false } = {}) {
    const prevBeat = this.beat;
    this.beat = beat;
    this.ended = false;
    this.speech = { speaking: false, progress: 0, level: 0 };
    this.card.setBeat(beat, { index, total, avatar, image, youDid: this.youDid });
    const layout = layoutFor(beat);
    this.layout = layout;

    const T = { t: 0, dur: 0.35, pusher: null, shoved: [], contactAt: null };
    const keep = new Set(layout.slots.map((s) => s.did));
    let moved = false;

    for (const slot of layout.slots) {
      let a = this.actors.get(slot.did);
      const tx = slot.x * SCENE_W;
      if (!a || a.exiting) {
        const fresh = !a;
        if (!a) a = this.newActor(slot.did);
        if (fresh || a.fly) {
          a.fly = null; a.rot = 0; a.flyY = 0;
          a.x = slot.enter === 'left' ? -170 : SCENE_W + 170 + (slot.role === 'mob' ? slot.k * 60 : 0);
          a.scale = slot.scale;
          a.depth = slot.depth;
        }
        a.exiting = null;
        this.flying = this.flying.filter((f) => f.did !== slot.did);
        this.actors.set(slot.did, a);
        a.moveStart = slot.role === 'mob' ? 0.08 + (slot.k || 0) * 0.05 : 0;
        a.moveDur = slot.role === 'speaker' ? 0.62 : 0.8;
      } else {
        a.moveStart = 0;
        a.moveDur = Math.abs(tx - a.x) > 4 || Math.abs(a.scale - slot.scale) > 0.01 ? 0.65 : 0;
      }
      if (a.moveDur) moved = true;
      a.fromX = a.x; a.toX = tx;
      a.fromScale = a.scale; a.toScale = slot.scale;
      a.fromDepth = a.depth; a.toDepth = slot.depth;
      a.role = slot.role;
      a.k = slot.k || 0;
      a.slotFacing = slot.facing;
      if (beat.speaker === slot.did) T.pusher = a;
    }

    for (const [did, a] of this.actors) {
      if (keep.has(did)) continue;
      if (a.role === 'mob') {
        a.exiting = 'walk';
        a.fromX = a.x; a.toX = SCENE_W + 220;
        a.fromScale = a.toScale = a.scale;
        a.fromDepth = a.toDepth = a.depth;
        a.moveStart = 0.05; a.moveDur = 0.9;
        a.slotFacing = 1;
        moved = true;
      } else {
        a.exiting = 'shove';
        T.shoved.push(a);
      }
    }

    if (T.shoved.length) T.dur = 1.05;
    else if (moved) T.dur = 0.95;
    if (prevBeat && !moved && !T.shoved.length && T.pusher) T.pusher.hop = 0.001;

    if (instant) {
      for (const a of T.shoved) this.actors.delete(a.did);
      for (const [did, a] of this.actors) {
        if (a.exiting) { this.actors.delete(did); continue; }
        a.x = a.toX; a.scale = a.toScale; a.depth = a.toDepth; a.facing = a.slotFacing;
        a.walking = false; a.moveDur = 0;
      }
      this.trans = null;
      this.cam = { zoom: 1, cx: SCENE_W / 2, cy: SCENE_H / 2 };
      return;
    }
    this.trans = T;
  }

  setSpeech(s) {
    this.speech = s;
  }

  finish() {
    this.ended = true;
    this.speech = { speaking: false, progress: 1, level: 0 };
  }

  shove(a, pusher) {
    if (a.fly) return;
    const dir = pusher ? (a.x < pusher.x ? -1 : 1) : -1;
    a.fly = { vx: dir * (1500 + Math.random() * 400), vy: -650 - Math.random() * 200, spin: dir * -1 * (7 + Math.random() * 4) };
    a.exiting = 'fly';
    this.actors.delete(a.did);
    this.flying.push(a);
    const hx = a.x + (pusher ? (pusher.x - a.x) / 2 : 0);
    const hy = GROUND_Y - 180 * a.scale;
    this.burst(hx, hy);
    if (this.hooks.onShove) this.hooks.onShove();
  }

  burst(x, y) {
    this.particles.push({ kind: 'star', x, y, t: 0, life: 0.35 });
    for (let i = 0; i < 7; i++) {
      this.particles.push({
        kind: 'dust', x: x + (Math.random() - 0.5) * 60, y: GROUND_Y - 10 - Math.random() * 20,
        vx: (Math.random() - 0.5) * 260, vy: -40 - Math.random() * 80, t: 0, life: 0.6 + Math.random() * 0.3,
        r: 10 + Math.random() * 14,
      });
    }
  }

  /* -------------------------------------------------------- update */

  update(dt) {
    this.time += dt;
    const T = this.trans;

    if (T) {
      T.t += dt;
      for (const a of this.actors.values()) this.moveActor(a, T.t, dt);
      for (const a of this.actors.values()) if (a.exiting === 'walk' && a.moveDur && T.t >= a.moveStart + a.moveDur) this.actors.delete(a.did);

      // contact check: the speaker barges into whoever is leaving
      for (const s of T.shoved) {
        if (s.fly) continue;
        const p = T.pusher;
        const near = p && Math.abs(p.x - s.x) < 125 * Math.max(p.scale, s.scale);
        if (near || T.t > (p && p.moveDur ? 0.62 : 0.28)) {
          this.shove(s, p);
          if (T.contactAt == null) T.contactAt = T.t;
        }
      }
      if (T.t >= T.dur) {
        for (const a of this.actors.values()) {
          if (a.exiting === 'walk') { this.actors.delete(a.did); continue; }
          a.x = a.toX; a.scale = a.toScale; a.depth = a.toDepth; a.walking = false; a.facing = a.slotFacing; a.moveDur = 0;
        }
        this.trans = null;
      }
    } else {
      for (const a of this.actors.values()) {
        a.walking = false;
        a.facing = a.slotFacing;
      }
    }

    for (const a of this.actors.values()) {
      if (a.walking) a.walkPhase += dt * 12;
      if (a.hop > 0) { a.hop += dt; if (a.hop > 0.4) a.hop = 0; }
    }

    for (const a of this.flying) {
      a.x += a.fly.vx * dt;
      a.fly.vy += 2600 * dt;
      a.flyY += a.fly.vy * dt;
      a.rot += a.fly.spin * dt;
    }
    this.flying = this.flying.filter((a) => a.x > -400 && a.x < SCENE_W + 400 && a.flyY < 500);

    for (const p of this.particles) {
      p.t += dt;
      if (p.kind === 'dust') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; }
    }
    this.particles = this.particles.filter((p) => p.t < p.life);

    this.updateCamera(dt);
  }

  moveActor(a, t, dt) {
    if (!a.moveDur) { a.walking = false; a.facing = a.slotFacing; return; }
    const k = seg(t, a.moveStart, a.moveStart + a.moveDur);
    const e = a.role === 'speaker' && !a.exiting ? ease.out(k) : ease.inOut(k);
    a.x = lerp(a.fromX, a.toX, e);
    a.scale = lerp(a.fromScale, a.toScale, e);
    a.depth = lerp(a.fromDepth, a.toDepth, e);
    a.walking = k > 0 && k < 1 && Math.abs(a.toX - a.fromX) > 4;
    if (a.walking) a.facing = a.toX < a.fromX ? -1 : 1;
    else a.facing = a.slotFacing;
  }

  focusOf(a) {
    const f = faceOffset(a.look);
    return { x: a.x + f.x * a.facing * a.scale, y: GROUND_Y - a.depth * DEPTH_RISE + f.y * a.scale };
  }

  updateCamera(dt) {
    let zoom = 1, fx = SCENE_W / 2, fy = SCENE_H / 2;
    const b = this.beat;
    if (b && !this.trans) {
      const speaker = this.actors.get(b.speaker);
      const prog = this.ended ? 0 : ease.inOut(clamp(this.speech.progress, 0, 1));
      if (speaker && this.layout && this.layout.mode === 'solo') {
        const f = this.focusOf(speaker);
        fx = f.x; fy = f.y;
        zoom = 1 + 0.4 * prog;
      } else if (speaker && b.pile) {
        const target = this.actors.get(b.pile.target);
        const f1 = this.focusOf(speaker), f2 = target ? this.focusOf(target) : f1;
        fx = (f1.x + f2.x) / 2; fy = Math.min(f1.y, f2.y) + 40;
        zoom = 1 + 0.1 * prog;
      }
    }
    const rate = 1 - Math.exp(-dt * (this.trans ? 9 : 3.5));
    this.cam.zoom = lerp(this.cam.zoom, zoom, rate);
    this.cam.cx = lerp(this.cam.cx, fx, rate);
    this.cam.cy = lerp(this.cam.cy, fy, rate);
  }

  /* -------------------------------------------------------- poses */

  poseFor(a) {
    const p = a.pose;
    const t = this.time + a.seedT;
    const b = this.beat;
    const pile = b && b.pile;
    Object.assign(p, defaultPose());
    p.t = t;
    p.blink = ((t * 1.3) % 4.1) < 0.13 ? 1 : 0;
    a.bounce = 0;
    a.tremble = 0;

    if (a.fly) {
      p.armF = [-2.2 + Math.sin(t * 22) * 0.6, -0.4];
      p.armB = [-1.0 + Math.cos(t * 22) * 0.6, -0.4];
      p.mouth = 1;
      p.brow = 'worried';
      p.lean = -0.2;
      p.walk = t * 30;
      return p;
    }

    const T = this.trans;
    const isPusher = T && T.pusher === a && T.shoved.length &&
      (T.contactAt == null ? T.shoved.some((s) => !s.fly && Math.abs(s.x - a.x) < 230) : T.t - T.contactAt < 0.3);
    if (isPusher) {
      p.lean = 0.38;
      p.armF = [-0.12, 0.05];
      p.armB = [-0.02, 0.05];
      p.brow = 'angry';
      p.mouth = 0.55;
      if (a.walking) p.walk = a.walkPhase;
      return p;
    }

    if (a.walking) {
      p.walk = a.walkPhase;
      p.armF = [1.25 + Math.sin(a.walkPhase) * 0.55, -0.35];
      p.armB = [1.4 - Math.sin(a.walkPhase) * 0.55, -0.3];
      p.lean = 0.16;
      if (a.role === 'mob') { p.brow = 'angry'; p.weapon = true; p.armF = [-1.7, -0.5]; }
      return p;
    }

    const isSpeaker = b && b.speaker === a.did;
    const speaking = isSpeaker && !this.trans && this.speech.speaking;

    if (a.role === 'mob') {
      const i = a.k * 1.7;
      p.weapon = true;
      p.armF = [-1.95 + 0.32 * Math.sin(t * 5 + i), -0.5];
      p.armB = [-0.7 + 0.35 * Math.sin(t * 5.5 + i + 1), -1.7];
      p.brow = 'angry';
      p.anger = 0.8 + 0.2 * Math.sin(t * 8);
      p.mouth = Math.max(0, Math.sin(t * 4 + i)) * 0.75;
      p.lean = 0.05;
      a.bounce = Math.abs(Math.sin(t * 5 + i)) * 9;
      return p;
    }

    if (a.role === 'target' && !isSpeaker) {
      const size = pile ? pile.size : 1;
      p.brow = 'worried';
      p.armF = [-0.55, -2.35];
      p.armB = [-0.4, -2.1];
      p.lean = -0.1;
      p.squash = 0.93;
      p.sweat = clamp((size - 1) / 3, 0.35, 1);
      p.mouth = 0.15;
      p.still = true; // cornered, frozen in place
      return p;
    }

    if (speaking) {
      p.mouth = this.speech.level;
      p.armF = [0.55 + 0.55 * noise1(t * 0.9, 3), -1.15 + 0.6 * noise1(t * 1.3, 7)];
      p.armB = [1.35 + 0.15 * noise1(t * 0.7, 11), -0.3];
      p.headTilt = 0.05 * noise1(t * 0.8, 13);
      p.lean = 0.1 + 0.04 * noise1(t * 0.5, 17);
    }
    if (pile) {
      if (a.role === 'target') { p.brow = 'worried'; p.sweat = 0.6; }
      else if (pile.role === 'attacker' && isSpeaker) p.brow = 'angry';
    }
    if (a.hop > 0) a.bounce = Math.sin((a.hop / 0.4) * Math.PI) * 16;
    return p;
  }

  /* -------------------------------------------------------- render */

  render(dt = 0.016) {
    const ctx = this.ctx;
    ctx.setTransform(this.canvas.width / FRAME_W, 0, 0, this.canvas.height / FRAME_H, 0, 0);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SCENE_W, SCENE_H);
    ctx.clip();
    const z = this.cam.zoom;
    const halfW = SCENE_W / 2 / z, halfH = SCENE_H / 2 / z;
    const cx = clamp(this.cam.cx, halfW, SCENE_W - halfW);
    const cy = clamp(this.cam.cy, halfH, SCENE_H - halfH);
    ctx.translate(SCENE_W / 2, SCENE_H / 2);
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);

    ctx.drawImage(getBackdrop(), 0, 0, SCENE_W, SCENE_H);
    drawAmbient(ctx, this.time);

    const order = [...this.actors.values()].sort((a, b) => {
      if (Math.abs(b.depth - a.depth) > 0.01) return b.depth - a.depth;
      return rank(a, this.beat) - rank(b, this.beat);
    });
    if (this.titleCard && !this.actors.size) this.drawSign(ctx, this.titleCard);
    for (const a of order) this.drawActor(ctx, a);
    for (const a of this.flying) this.drawActor(ctx, a);

    if (this.beat && this.beat.pile && !this.trans && this.showTags) {
      for (const a of order) {
        if (a.role === 'mob' || a.role === 'target') this.drawTag(ctx, a, shortName(this.names.get(a.did)), a.role === 'target');
      }
    }
    if (this.youDid) {
      const you = this.actors.get(this.youDid);
      if (you && !this.trans) this.drawYou(ctx, you);
    }
    this.drawParticles(ctx);
    ctx.restore();

    const b = this.beat;
    let pileLabel = '';
    if (b && b.pile && b.pile.size >= 2) {
      const who = this.names.get(b.pile.target) || 'someone';
      pileLabel = `${b.pile.size} people piling on @${who}`;
    }
    this.card.draw(ctx, { progress: this.speech.progress, ended: this.ended, dt, pileLabel });
  }

  drawActor(ctx, a) {
    const pose = this.poseFor(a);
    const y = GROUND_Y - a.depth * DEPTH_RISE - (a.bounce || 0) + a.flyY;
    ctx.save();
    ctx.translate(a.x + (a.tremble || 0), y);
    if (a.rot) {
      ctx.translate(0, -150 * a.scale);
      ctx.rotate(a.rot);
      ctx.translate(0, 150 * a.scale);
    }
    ctx.scale(a.scale * a.facing, a.scale);
    drawCaveman(ctx, a.look, pose);
    ctx.restore();
  }

  drawSign(ctx, { title, sub }) {
    const cx = SCENE_W / 2, top = 46, w = 640, h = 150;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const px of [cx - w * 0.32, cx + w * 0.32]) {
      ctx.beginPath();
      ctx.rect(px - 11, top + h - 10, 22, GROUND_Y - top - h + 6);
      ctx.fillStyle = '#7a4f27';
      ctx.fill();
      ctx.strokeStyle = '#2a1d14';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + 8, top + 6);
    ctx.lineTo(cx + w / 2 - 4, top);
    ctx.lineTo(cx + w / 2 + 4, top + h - 6);
    ctx.lineTo(cx - w / 2 - 2, top + h);
    ctx.closePath();
    ctx.fillStyle = '#b07a42';
    ctx.fill();
    ctx.strokeStyle = '#2a1d14';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#8c5d2f';
    ctx.lineWidth = 2.5;
    for (const y of [top + 40, top + 82, top + 118]) {
      ctx.beginPath(); ctx.moveTo(cx - w / 2 + 20, y); ctx.quadraticCurveTo(cx, y + 6, cx + w / 2 - 20, y - 3); ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a1d14';
    ctx.font = '900 52px "Arial Black", Impact, Arial, sans-serif';
    ctx.fillText(title, cx, top + 58, w - 50);
    ctx.font = 'bold 24px Arial, Helvetica, sans-serif';
    ctx.fillText(sub, cx, top + 112, w - 60);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  drawTag(ctx, a, text, hot) {
    const top = GROUND_Y - a.depth * DEPTH_RISE - headTop(a.look) * a.scale - 14 - (a.bounce || 0);
    ctx.font = `bold ${hot ? 16 : 14}px Arial, Helvetica, sans-serif`;
    const label = text;
    const w = ctx.measureText(label).width + 14;
    ctx.fillStyle = hot ? 'rgba(194, 65, 12, 0.92)' : 'rgba(255, 255, 255, 0.88)';
    ctx.strokeStyle = 'rgba(28, 18, 12, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(a.x - w / 2, top - 20, w, 22, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hot ? '#fff' : '#1c120c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, a.x, top - 8.5);
    ctx.textAlign = 'left';
  }

  drawYou(ctx, a) {
    const top = GROUND_Y - a.depth * DEPTH_RISE - headTop(a.look) * a.scale - (a.bounce || 0) - (this.beat.pile ? 44 : 14);
    const x = a.x;
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#1c120c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x - 28, top - 34, 56, 26, 6);
    ctx.moveTo(x - 8, top - 8); ctx.lineTo(x, top + 2); ctx.lineTo(x + 8, top - 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1c120c';
    ctx.font = 'bold 17px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('YOU', x, top - 20);
    ctx.textAlign = 'left';
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const k = p.t / p.life;
      if (p.kind === 'dust') {
        ctx.globalAlpha = 0.6 * (1 - k);
        ctx.fillStyle = '#d9cdb4';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 + k), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = 1 - k;
        const s = 30 + k * 70;
        ctx.fillStyle = '#fff6a8';
        ctx.strokeStyle = '#e8862c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const r = i % 2 ? s * 0.45 : s;
          const a = (i / 16) * Math.PI * 2;
          ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** "@alice" from alice.bsky.social; long names get trimmed to fit over a head. */
function shortName(handle) {
  const first = String(handle || '?').split('.')[0];
  return '@' + (first.length > 12 ? first.slice(0, 11) + '…' : first);
}

function rank(a, beat) {
  if (a.role === 'mob') return 0;
  if (a.role === 'target') return 1;
  if (beat && beat.speaker === a.did) return 3;
  return 2;
}
