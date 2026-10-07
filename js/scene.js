// The prehistoric backdrop, painted once into an offscreen canvas and
// then drawn through the camera each frame, plus a few live touches
// (volcano smoke, a passing pterodactyl).

import { rng, shade } from './util.js?v=8';

export const SCENE_W = 1280;
export const SCENE_H = 420;
export const GROUND_Y = 400;

const OUT = '#2a1d14';
const PAINT_SCALE = 2;

function line(ctx, w = 2.5) {
  ctx.strokeStyle = OUT;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function blob(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.closePath();
}

function paintBackdrop(ctx) {
  const r = rng(1979);
  const W = SCENE_W, H = SCENE_H;

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, '#bcd9e8');
  sky.addColorStop(1, '#eef1e2');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // far ridge
  ctx.fillStyle = '#a9bccb';
  ctx.beginPath();
  ctx.moveTo(0, 270);
  for (let x = 0; x <= W; x += 80) ctx.lineTo(x, 230 + Math.sin(x * 0.011) * 22 + r() * 12);
  ctx.lineTo(W, 330); ctx.lineTo(0, 330); ctx.closePath();
  ctx.fill();

  // volcano
  ctx.beginPath();
  ctx.moveTo(40, 330);
  ctx.lineTo(210, 92);
  ctx.quadraticCurveTo(245, 80, 285, 90);
  ctx.lineTo(470, 330);
  ctx.closePath();
  ctx.fillStyle = '#8f6f74';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#76585e';
  ctx.beginPath();
  ctx.moveTo(250, 85); ctx.lineTo(480, 340); ctx.lineTo(300, 340); ctx.lineTo(240, 120); ctx.closePath();
  ctx.fill();
  // lava drips
  ctx.fillStyle = '#e8622c';
  for (const [x, len] of [[222, 60], [246, 95], [268, 48]]) {
    ctx.beginPath();
    ctx.moveTo(x - 9, 86);
    ctx.lineTo(x + 9, 86);
    ctx.quadraticCurveTo(x + 6, 86 + len, x, 92 + len);
    ctx.quadraticCurveTo(x - 6, 86 + len, x - 9, 86);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(40, 330); ctx.lineTo(210, 92); ctx.quadraticCurveTo(245, 80, 285, 90); ctx.lineTo(470, 330);
  line(ctx, 3);
  ctx.beginPath();
  ctx.ellipse(247, 89, 38, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffb347';
  ctx.fill();
  line(ctx, 2.5);

  // blue-grey rock formations on the right, like the original
  const rocks = [
    { c: '#8fa3b6', pts: [[760, 330], [770, 210], [820, 160], [905, 150], [950, 190], [965, 330]] },
    { c: '#7d93a8', pts: [[930, 330], [940, 175], [1010, 120], [1110, 118], [1170, 170], [1185, 330]] },
    { c: '#94a9bb', pts: [[1120, 330], [1135, 220], [1200, 190], [1290, 200], [1290, 330]] },
  ];
  for (const rock of rocks) {
    blob(ctx, rock.pts);
    ctx.fillStyle = rock.c;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = shade(rock.c, -0.14);
    ctx.fillRect(rock.pts[0][0] + (rock.pts[rock.pts.length - 1][0] - rock.pts[0][0]) * 0.62, 0, 400, 400);
    ctx.strokeStyle = shade(rock.c, -0.3);
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const x = rock.pts[1][0] + r() * 160, y = 190 + r() * 110;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 18 + r() * 20, y + 8); ctx.stroke();
    }
    ctx.restore();
    blob(ctx, rock.pts);
    line(ctx, 3);
  }

  // cave mouth
  ctx.beginPath();
  ctx.moveTo(1010, 330);
  ctx.quadraticCurveTo(1012, 238, 1065, 236);
  ctx.quadraticCurveTo(1118, 238, 1120, 330);
  ctx.closePath();
  ctx.fillStyle = '#2b2a33';
  ctx.fill();
  line(ctx, 3);

  // ground
  const g = ctx.createLinearGradient(0, 320, 0, H);
  g.addColorStop(0, '#c9b998');
  g.addColorStop(1, '#a8957a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 330);
  for (let x = 0; x <= W; x += 64) ctx.lineTo(x, 326 + Math.sin(x * 0.02) * 4);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 330);
  for (let x = 0; x <= W; x += 64) ctx.lineTo(x, 326 + Math.sin(x * 0.02) * 4);
  line(ctx, 3);

  // pebbles and cracks
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = 340 + r() * 75, s = 3 + r() * 8;
    ctx.beginPath();
    ctx.ellipse(x, y, s * 1.4, s, 0, 0, Math.PI * 2);
    ctx.fillStyle = r() < 0.5 ? '#9b8a70' : '#b7a889';
    ctx.fill();
    line(ctx, 1.6);
  }
  ctx.strokeStyle = '#8a7a62';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const x = r() * W, y = 350 + r() * 60;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20, y + 6); ctx.lineTo(x + 34, y + 2); ctx.stroke();
  }

  // a cycad on the left edge
  ctx.save();
  ctx.translate(48, 345);
  ctx.beginPath();
  ctx.moveTo(-14, 0); ctx.lineTo(-8, -120); ctx.lineTo(8, -120); ctx.lineTo(14, 0); ctx.closePath();
  ctx.fillStyle = '#8a6a3c';
  ctx.fill();
  line(ctx, 2.5);
  ctx.strokeStyle = '#6b512d'; ctx.lineWidth = 2;
  for (let y = -110; y < 0; y += 14) { ctx.beginPath(); ctx.moveTo(-11, y); ctx.lineTo(11, y + 6); ctx.stroke(); }
  for (const a of [-2.7, -2.2, -1.75, -1.35, -0.9, -0.45]) {
    ctx.save();
    ctx.translate(0, -118);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(50, -26, 104, 8);
    ctx.quadraticCurveTo(52, 2, 0, 0);
    ctx.fillStyle = '#4f8a3a';
    ctx.fill();
    line(ctx, 2);
    ctx.restore();
  }
  ctx.restore();
}

let backdrop = null;

export function getBackdrop() {
  if (backdrop) return backdrop;
  const c = document.createElement('canvas');
  c.width = SCENE_W * PAINT_SCALE;
  c.height = SCENE_H * PAINT_SCALE;
  const ctx = c.getContext('2d');
  ctx.scale(PAINT_SCALE, PAINT_SCALE);
  paintBackdrop(ctx);
  backdrop = c;
  return c;
}

/** Things that move in the background: smoke and a pterodactyl. */
export function drawAmbient(ctx, t) {
  // smoke puffs rising from the crater
  for (let i = 0; i < 5; i++) {
    const k = ((t * 0.08 + i / 5) % 1);
    const x = 247 + Math.sin(k * 5 + i) * 14 + k * 60;
    const y = 80 - k * 90;
    const s = 12 + k * 26;
    ctx.globalAlpha = 0.75 * (1 - k);
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fillStyle = '#d8d3d0';
    ctx.fill();
    ctx.strokeStyle = '#9e9592';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // pterodactyl crossing every ~40 s
  const cycle = (t % 40) / 40;
  if (cycle < 0.35) {
    const k = cycle / 0.35;
    const x = 1350 - k * 1500;
    const y = 70 + Math.sin(k * 9) * 12;
    const flap = Math.sin(t * 7) * 0.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#5b4a52';
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * 22, -18 - flap * 20 * side * side, side * 46, -6 - flap * 22);
      ctx.quadraticCurveTo(side * 22, 0, 0, 4);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-8, 0); ctx.lineTo(-24, -6); ctx.lineTo(-30, -2); ctx.lineTo(-10, 4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
