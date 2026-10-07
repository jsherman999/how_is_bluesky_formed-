// The lower half of the frame: the post being read, styled like a
// Bluesky post sitting where the Yahoo Answers page was in the original.
// Text scrolls along with the speech.

import { clamp, lerp } from './util.js?v=7';
import { SCENE_H } from './scene.js?v=7';

export const FRAME_W = 1280;
export const FRAME_H = 720;
const TOP = SCENE_H;
const HEADER_H = 40;
const PAD = 28;
const AVATAR = 64;
const TEXT_X = PAD + AVATAR + 22;
const FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
const BODY_SIZE = 34;
const LINE_H = 42;
const TEXT_TOP = TOP + HEADER_H + 84;
const TEXT_BOTTOM = FRAME_H - 14;
const BLUE = '#1185fe';

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
      if (cur) lines.push(cur);
      if (ctx.measureText(w).width <= maxW) { cur = w; continue; }
      // one very long token (usually a URL): hard-break it
      let chunk = '';
      for (const ch of w) {
        if (chunk && ctx.measureText(chunk + ch).width > maxW) { lines.push(chunk); chunk = ''; }
        chunk += ch;
      }
      cur = chunk;
    }
    lines.push(cur);
  }
  while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
  return lines;
}

function butterfly(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = BLUE;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.bezierCurveTo(side * 4, -8, side * 16, -14, side * 18, -8);
    ctx.bezierCurveTo(side * 20, -2, side * 12, 4, side * 6, 5);
    ctx.bezierCurveTo(side * 14, 8, side * 12, 16, side * 6, 14);
    ctx.bezierCurveTo(side * 2, 12, 0, 6, 0, 2);
    ctx.fill();
  }
  ctx.restore();
}

export class Card {
  constructor() {
    this.beat = null;
    this.lines = [];
    this.scroll = 0;
    this.measure = document.createElement('canvas').getContext('2d');
  }

  setBeat(beat, { index, total, avatar, image, youDid }) {
    this.beat = beat;
    this.index = index;
    this.total = total;
    this.avatar = avatar || null;
    this.image = image || null;
    this.youDid = youDid;
    this.scroll = 0;
    const m = this.measure;
    const textW = FRAME_W - TEXT_X - PAD - (this.image ? 230 : 0);
    m.font = `bold ${BODY_SIZE}px ${FONT}`;
    const text = beat.post.text || (beat.post.images.length ? '[picture]' : beat.post.hasVideo ? '[video]' : '');
    this.lines = wrap(m, text, textW);
    this.lineStarts = [];
    let pos = 0;
    for (const l of this.lines) { this.lineStarts.push(pos); pos += l.length + 1; }
    this.textLen = Math.max(1, pos);
    this.quoteLines = [];
    if (beat.post.quote) {
      m.font = `${20}px ${FONT}`;
      this.quoteLines = wrap(m, `@${beat.post.quote.handle}: ${beat.post.quote.text}`, textW - 30).slice(0, 4);
    } else if (beat.post.external && beat.post.external.title) {
      m.font = `${20}px ${FONT}`;
      this.quoteLines = wrap(m, '🔗 ' + beat.post.external.title, textW - 30).slice(0, 2);
    }
  }

  /**
   * progress: 0..1 through the speech. Scrolls so the current line stays
   * on the second visible row, like someone following along.
   */
  draw(ctx, { progress = 0, ended = false, dt = 0.016, pileLabel = '' } = {}) {
    // page
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, TOP, FRAME_W, FRAME_H - TOP);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, TOP, FRAME_W, HEADER_H);
    ctx.fillStyle = '#d7dfe8';
    ctx.fillRect(0, TOP + HEADER_H - 1, FRAME_W, 1);
    ctx.fillStyle = '#2a1d14';
    ctx.fillRect(0, TOP - 3, FRAME_W, 4);

    butterfly(ctx, PAD + 10, TOP + 21, 0.9);
    ctx.textBaseline = 'middle';
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillStyle = '#334155';
    ctx.textAlign = 'left';
    const b = this.beat;
    ctx.fillText(b ? `Thread · post ${this.index + 1} of ${this.total}` : 'Thread', PAD + 36, TOP + 21);
    ctx.textAlign = 'right';
    if (ended) {
      ctx.fillStyle = '#3f8f1f';
      ctx.fillText('closed to new replies', FRAME_W - PAD, TOP + 21);
    } else if (pileLabel) {
      ctx.fillStyle = '#c2410c';
      ctx.fillText(pileLabel, FRAME_W - PAD, TOP + 21);
    }
    ctx.textAlign = 'left';
    if (!b) return;
    const post = b.post;

    // avatar
    const ax = PAD, ay = TOP + HEADER_H + 16;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + AVATAR / 2, ay + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
    ctx.clip();
    if (this.avatar) {
      ctx.drawImage(this.avatar, ax, ay, AVATAR, AVATAR);
    } else {
      ctx.fillStyle = BLUE;
      ctx.fillRect(ax, ay, AVATAR, AVATAR);
      ctx.fillStyle = '#fff';
      ctx.font = `bold 30px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText((post.displayName || post.handle || '?').slice(0, 1).toUpperCase(), ax + AVATAR / 2, ay + AVATAR / 2 + 2);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // name line
    const ny = TOP + HEADER_H + 30;
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillStyle = '#0f172a';
    const name = post.displayName || post.handle;
    ctx.fillText(name, TEXT_X, ny);
    let x = TEXT_X + ctx.measureText(name).width + 10;
    ctx.font = `19px ${FONT}`;
    ctx.fillStyle = '#64748b';
    const handle = '@' + post.handle;
    ctx.fillText(handle, x, ny);
    x += ctx.measureText(handle).width + 12;
    if (this.youDid && post.did === this.youDid) {
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x, ny - 12, 44, 24);
      ctx.fillStyle = '#1c1917';
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillText('YOU', x + 7, ny + 1);
      x += 56;
    }
    ctx.font = `17px ${FONT}`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(fmtDate(post.createdAt), x, ny + 1);

    ctx.font = `17px ${FONT}`;
    ctx.fillStyle = '#64748b';
    const sub = b.targetHandle ? `Replying to @${b.targetHandle}` : post.parentUri ? 'Replying to an earlier post' : 'Started the thread';
    ctx.fillText(sub, TEXT_X, ny + 28);

    // body text with scrolling
    const visible = Math.floor((TEXT_BOTTOM - TEXT_TOP) / LINE_H);
    const charPos = clamp(progress, 0, 1) * this.textLen;
    let curLine = 0;
    for (let i = 0; i < this.lineStarts.length; i++) if (this.lineStarts[i] <= charPos) curLine = i;
    const totalLines = this.lines.length + (this.quoteLines.length ? this.quoteLines.length + 1 : 0);
    const maxScroll = Math.max(0, totalLines - visible);
    const want = clamp(curLine - 1, 0, maxScroll);
    this.scroll = lerp(this.scroll, want, clamp(dt * 5, 0, 1));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TEXT_TOP - 8, FRAME_W, TEXT_BOTTOM - TEXT_TOP + 8);
    ctx.clip();
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold ${BODY_SIZE}px ${FONT}`;
    const y0 = TEXT_TOP + BODY_SIZE - this.scroll * LINE_H;
    for (let i = 0; i < this.lines.length; i++) {
      const y = y0 + i * LINE_H;
      if (y < TEXT_TOP - LINE_H || y > TEXT_BOTTOM + LINE_H) continue;
      const line = this.lines[i];
      // highlight the word being read
      if (!ended && progress > 0 && progress < 1 && i === curLine) {
        const off = Math.floor(charPos - this.lineStarts[i]);
        const before = line.slice(0, off);
        const ws = before.search(/\S+$/);
        const start = ws === -1 ? off : ws;
        const m = /^\S*/.exec(line.slice(start));
        const word = m ? m[0] : '';
        if (word) {
          const wx = TEXT_X + ctx.measureText(line.slice(0, start)).width;
          ctx.fillStyle = '#fde68a';
          ctx.fillRect(wx - 3, y - BODY_SIZE + 3, ctx.measureText(word).width + 6, LINE_H - 2);
        }
      }
      ctx.fillStyle = '#0f172a';
      ctx.fillText(line, TEXT_X, y);
    }
    if (this.quoteLines.length) {
      const qy = y0 + this.lines.length * LINE_H + 8;
      const qh = this.quoteLines.length * 26 + 16;
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(TEXT_X, qy - 4, FRAME_W - TEXT_X - PAD - (this.image ? 230 : 0), qh, 10);
      ctx.fill();
      ctx.stroke();
      ctx.font = `20px ${FONT}`;
      ctx.fillStyle = '#475569';
      this.quoteLines.forEach((l, i) => ctx.fillText(l, TEXT_X + 14, qy + 20 + i * 26));
    }
    ctx.restore();

    // attached picture
    if (this.image) {
      const iw = 200, ih = 150;
      const ix = FRAME_W - PAD - iw, iy = TOP + HEADER_H + 70;
      const s = Math.max(iw / this.image.width, ih / this.image.height);
      const sw = iw / s, sh = ih / s;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(ix, iy, iw, ih, 12);
      ctx.clip();
      ctx.drawImage(this.image, (this.image.width - sw) / 2, (this.image.height - sh) / 2, sw, sh, ix, iy, iw, ih);
      ctx.restore();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(ix, iy, iw, ih, 12);
      ctx.stroke();
    }

    // stats row hint when the text is short enough to leave room
    if (totalLines <= visible - 1) {
      ctx.font = `17px ${FONT}`;
      ctx.fillStyle = '#94a3b8';
      const sy = TEXT_BOTTOM - 6;
      ctx.fillText(`💬 ${post.replyCount}   🔁 ${post.repostCount}   ♡ ${post.likeCount}`, TEXT_X, sy);
    }
  }
}
