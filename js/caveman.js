// Procedural Flash-style cavemen. makeLook(did) derives a stable look from
// an account DID; drawCaveman() paints one at the origin (feet on y = 0,
// facing +x, about 300 units tall). The caller handles position, scale,
// mirroring and rotation.

import { hash32, rng, pick, range, shade } from './util.js';

const OUTLINE = '#1c120c';
const OL = 3.6;

const SKINS = ['#f1c9a0', '#e8b48a', '#d99a6c', '#c68650', '#b0743f', '#94603a', '#7a4b2a', '#5e3a22'];
const HAIRS = ['#2a1a10', '#3b2412', '#5a3418', '#7a4a22', '#9c6b30', '#1b1b1b', '#a33b1f', '#c9c2b5', '#d8a24a'];
const PELTS = [
  { base: '#c58a3e', mark: '#6b3f16' },  // tan with dark spots
  { base: '#8a5a2b', mark: '#4d2f13' },  // brown
  { base: '#9a9590', mark: '#5c5853' },  // wolf grey
  { base: '#e0a33a', mark: '#3a230e' },  // leopard
  { base: '#ece3d0', mark: '#4a4038' },  // snow cat
  { base: '#d9772b', mark: '#2c1a0c' },  // tiger
  { base: '#6f7a3a', mark: '#3b4220' },  // mossy
];
const WEAPONS = ['club', 'club', 'bone', 'axe'];

export function makeLook(did) {
  const r = rng(hash32(String(did)));
  const pelt = pick(r, PELTS);
  const look = {
    seed: hash32(String(did)),
    skin: pick(r, SKINS),
    hair: pick(r, HAIRS),
    hairStyle: Math.floor(r() * 6),
    beard: Math.floor(r() * 4),
    pelt: pelt.base,
    peltMark: pelt.mark,
    pattern: Math.floor(r() * 3),
    build: range(r, 0.86, 1.22),
    height: range(r, 0.9, 1.08),
    head: range(r, 0.95, 1.15),
    nose: range(r, 0.85, 1.35),
    brow: range(r, 0.85, 1.3),
    jaw: range(r, 0.92, 1.18),
    weapon: pick(r, WEAPONS),
    necklace: r() < 0.3,
    spots: [],
    stubble: [],
  };
  for (let i = 0; i < 9; i++) look.spots.push([range(r, -1, 1), range(r, -1, 1), range(r, 0.5, 1.2), range(r, 0, Math.PI)]);
  for (let i = 0; i < 26; i++) look.stubble.push([range(r, -0.5, 0.9), range(r, 0.3, 1.0)]);
  return look;
}

export function defaultPose() {
  return {
    t: 0,
    mouth: 0,
    blink: 0,
    walk: null,          // walk phase in radians, or null when standing
    armF: [1.25, -0.35], // [shoulder angle, elbow bend] — 0 = forward, PI/2 = down
    armB: [1.45, -0.3],
    lean: 0.08,
    squash: 1,
    brow: 'neutral',     // neutral | angry | worried
    sweat: 0,
    anger: 0,
    weapon: false,       // draw the look's weapon in the front hand
    headTilt: 0,
  };
}

/* ------------------------------------------------------------ helpers */

function outlineStroke(ctx, width, color) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + OL * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function fillOutline(ctx, color, lw = OL) {
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function polar(cx, cy, r, a) {
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

/** Arm from shoulder: returns [elbow, hand, foreAngle]. */
function armPoints(sx, sy, sh, el, L1, L2) {
  const ex = sx + Math.cos(sh) * L1, ey = sy + Math.sin(sh) * L1;
  const fa = sh + el;
  return [[ex, ey], [ex + Math.cos(fa) * L2, ey + Math.sin(fa) * L2], fa];
}

/* ------------------------------------------------------------ parts */

function drawLimbArm(ctx, look, sx, sy, angles, skin, H, withHair) {
  const [sh, el] = angles;
  const [e, h, fa] = armPoints(sx, sy, sh, el, 64 * H, 62 * H);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(e[0], e[1]);
  ctx.lineTo(h[0], h[1]);
  outlineStroke(ctx, 25 * look.build, skin);
  if (withHair) {
    ctx.strokeStyle = shade(look.hair, 0.1);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.2;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const px = sx + (e[0] - sx) * t, py = sy + (e[1] - sy) * t;
      ctx.beginPath();
      ctx.moveTo(px - 4, py - 3);
      ctx.lineTo(px + 3, py + 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // fist
  ctx.beginPath();
  ctx.arc(h[0], h[1], 15 * look.build, 0, Math.PI * 2);
  fillOutline(ctx, skin);
  ctx.beginPath();
  const tx = h[0] + Math.cos(fa - 1.2) * 12, ty = h[1] + Math.sin(fa - 1.2) * 12;
  ctx.arc(tx, ty, 6.5, 0, Math.PI * 2);
  fillOutline(ctx, skin, 2.6);
  return { hand: h, angle: fa };
}

function drawLeg(ctx, look, hx, hy, fx, fy, skin) {
  const kx = (hx + fx) / 2 + 9, ky = (hy + fy) / 2;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.quadraticCurveTo(kx, ky, fx, fy - 8);
  outlineStroke(ctx, 31 * look.build, skin);
  // big flat foot with toes
  ctx.beginPath();
  ctx.ellipse(fx + 10, fy - 7, 26 * look.build, 11, 0, 0, Math.PI * 2);
  fillOutline(ctx, skin);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const x = fx + 18 * look.build + i * 5;
    ctx.beginPath();
    ctx.moveTo(x, fy - 12);
    ctx.lineTo(x + 2, fy - 3);
    ctx.stroke();
  }
}

function drawWeapon(ctx, look, hand, angle) {
  ctx.save();
  ctx.translate(hand[0], hand[1]);
  ctx.rotate(angle);
  if (look.weapon === 'bone') {
    ctx.beginPath();
    ctx.moveTo(-18, -6); ctx.lineTo(96, -6); ctx.lineTo(96, 6); ctx.lineTo(-18, 6); ctx.closePath();
    fillOutline(ctx, '#efe6cf');
    for (const [x, y] of [[-22, -9], [-22, 9], [100, -9], [100, 9]]) {
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); fillOutline(ctx, '#efe6cf');
    }
  } else if (look.weapon === 'axe') {
    ctx.beginPath();
    ctx.moveTo(-16, -5); ctx.lineTo(92, -5); ctx.lineTo(92, 5); ctx.lineTo(-16, 5); ctx.closePath();
    fillOutline(ctx, '#8b5a2b');
    ctx.beginPath();
    ctx.moveTo(70, -6); ctx.lineTo(62, -34); ctx.quadraticCurveTo(84, -40, 96, -26); ctx.lineTo(90, -6); ctx.closePath();
    fillOutline(ctx, '#8d8f93');
    ctx.strokeStyle = '#c9b48a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(72, -8); ctx.lineTo(88, 8); ctx.moveTo(88, -8); ctx.lineTo(72, 8); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-16, -6);
    ctx.lineTo(70, -15);
    ctx.quadraticCurveTo(112, -26, 116, 0);
    ctx.quadraticCurveTo(112, 26, 70, 15);
    ctx.lineTo(-16, 6);
    ctx.closePath();
    fillOutline(ctx, '#9a6431');
    ctx.strokeStyle = '#5e3a1a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(84, -4, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(100, 7, 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function spikyHair(ctx, look, R, style) {
  const r = rng(look.seed ^ 0x5bd1e995);
  const hair = look.hair;
  const pts = [];
  let a0 = Math.PI * 0.95, a1 = Math.PI * 2.08, n = 11, rin = 1.02, rout = 1.28;
  if (style === 1) { rout = 1.55; n = 9; }
  if (style === 5) { a0 = Math.PI * 1.25; a1 = Math.PI * 1.8; n = 7; rout = 1.7; rin = 0.95; }
  for (let i = 0; i <= n * 2; i++) {
    const t = i / (n * 2);
    const a = a0 + (a1 - a0) * t;
    const rr = (i % 2 ? rout + range(r, -0.08, 0.1) : rin) * R;
    pts.push(polar(0, 0, rr, a));
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  // hairline back along the skull
  if (style === 5) {
    ctx.quadraticCurveTo(0.2 * R, -0.75 * R, -0.3 * R, -0.95 * R);
  } else {
    ctx.lineTo(0.78 * R, -0.5 * R);
    ctx.quadraticCurveTo(0.25 * R, -0.62 * R, -0.35 * R, -0.42 * R);
    ctx.quadraticCurveTo(-0.62 * R, -0.2 * R, -0.62 * R, 0.25 * R);
  }
  ctx.closePath();
  fillOutline(ctx, hair);
  // a few strands for texture
  ctx.strokeStyle = shade(hair, -0.35);
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = a0 + (a1 - a0) * (0.2 + i * 0.18);
    const [x1, y1] = polar(0, 0, R * 0.92, a);
    const [x2, y2] = polar(0, 0, R * 1.12, a + 0.05);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
}

function backHair(ctx, look, R) {
  if (look.hairStyle !== 3) return;
  ctx.beginPath();
  ctx.moveTo(0.2 * R, -0.9 * R);
  ctx.quadraticCurveTo(-1.4 * R, -0.9 * R, -1.25 * R, 0.6 * R);
  for (let i = 0; i < 5; i++) ctx.lineTo(-1.2 * R + i * 0.25 * R, (i % 2 ? 1.25 : 1.55) * R);
  ctx.lineTo(-0.1 * R, 0.6 * R);
  ctx.closePath();
  fillOutline(ctx, shade(look.hair, -0.12));
}

function drawBeard(ctx, look, R, J) {
  const hair = look.hair;
  if (look.beard === 0) {
    ctx.fillStyle = shade(hair, 0.05);
    ctx.globalAlpha = 0.45;
    for (const [x, y] of look.stubble) {
      ctx.beginPath(); ctx.arc(x * R, y * R, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  if (look.beard === 3) {
    // mutton chops
    ctx.beginPath();
    ctx.moveTo(-0.45 * R, -0.05 * R);
    ctx.lineTo(-0.1 * R, 0.05 * R);
    ctx.quadraticCurveTo(0.3 * R, 0.55 * R, 0.25 * R, 0.85 * R);
    ctx.lineTo(0.1 * R, 0.78 * R);
    ctx.lineTo(-0.05 * R, 0.92 * R);
    ctx.lineTo(-0.2 * R, 0.8 * R);
    ctx.lineTo(-0.5 * R, 0.7 * R);
    ctx.closePath();
    fillOutline(ctx, hair);
    return;
  }
  const long = look.beard === 2;
  const bottom = long ? 1.7 : 1.28;
  ctx.beginPath();
  ctx.moveTo(-0.48 * R, -0.05 * R);
  ctx.quadraticCurveTo(0.0 * R, 0.5 * R, 0.4 * R, 0.32 * R);
  ctx.quadraticCurveTo(0.7 * R, 0.18 * R, 0.95 * R * J, 0.28 * R);
  ctx.lineTo(1.02 * R * J, 0.7 * R);
  const steps = long ? 6 : 7;
  const fx = 0.95 * R * J, bx = -0.55 * R;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = fx + (bx - fx) * t;
    const curve = Math.sin(Math.PI * Math.min(1, t * 1.3));
    const y = (0.75 + (bottom - 0.75) * curve) * R + (i % 2 ? -0.12 * R : 0.06 * R);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(-0.62 * R, 0.4 * R);
  ctx.closePath();
  fillOutline(ctx, hair);
  ctx.strokeStyle = shade(hair, -0.35);
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const x = (0.75 - i * 0.32) * R;
    ctx.beginPath(); ctx.moveTo(x, 0.75 * R); ctx.lineTo(x - 0.05 * R, (bottom - 0.25) * R); ctx.stroke();
  }
}

function drawEye(ctx, cx, cy, rx, ry, lid, look) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fbf7ee';
  ctx.fill();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cx + rx * 0.3, cy + ry * 0.15, Math.min(rx, ry) * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#16100b';
  ctx.fill();
  // heavy lid
  const lidY = cy - ry + ry * 2 * lid;
  ctx.fillStyle = shade(look.skin, -0.08);
  ctx.fillRect(cx - rx - 2, cy - ry - 2, rx * 2 + 4, lidY - (cy - ry) + 2);
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - rx - 1, lidY);
  ctx.lineTo(cx + rx + 1, lidY);
  ctx.lineWidth = 3;
  ctx.stroke();
}

function headPath(ctx, R, J) {
  ctx.beginPath();
  ctx.moveTo(-0.86 * R, -0.2 * R);
  ctx.bezierCurveTo(-0.92 * R, -1.08 * R, 0.62 * R, -1.18 * R, 0.86 * R, -0.52 * R);
  ctx.quadraticCurveTo(1.04 * R, -0.42 * R, 0.98 * R, -0.28 * R);
  ctx.quadraticCurveTo(0.9 * R, 0.02 * R, 0.86 * R, 0.2 * R);
  ctx.bezierCurveTo(1.06 * R * J, 0.42 * R, 1.04 * R * J, 0.98 * R, 0.58 * R, 1.06 * R);
  ctx.bezierCurveTo(0.1 * R, 1.16 * R, -0.46 * R, 0.96 * R, -0.6 * R, 0.56 * R);
  ctx.bezierCurveTo(-0.76 * R, 0.3 * R, -0.96 * R, 0.14 * R, -0.86 * R, -0.2 * R);
  ctx.closePath();
}

function drawHead(ctx, look, pose, R) {
  const J = look.jaw;
  const skin = look.skin;
  backHair(ctx, look, R);

  // skull + giant jaw
  headPath(ctx, R, J);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shade(skin, -0.16);
  ctx.beginPath();
  ctx.ellipse(-0.75 * R, 0.25 * R, 0.55 * R, 1.2 * R, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  headPath(ctx, R, J);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OL;
  ctx.stroke();

  // ear
  ctx.beginPath();
  ctx.ellipse(-0.42 * R, 0.08 * R, 0.16 * R, 0.24 * R, -0.2, 0, Math.PI * 2);
  fillOutline(ctx, shade(skin, -0.05), 3);
  ctx.beginPath();
  ctx.arc(-0.42 * R, 0.08 * R, 0.08 * R, -1.2, 1.6);
  ctx.lineWidth = 2;
  ctx.stroke();

  drawBeard(ctx, look, R, J);

  // eyes under the brow
  const lid = 0.38 + 0.62 * pose.blink;
  drawEye(ctx, 0.14 * R, -0.18 * R, 0.11 * R, 0.13 * R, pose.brow === 'worried' ? lid * 0.6 : lid, look);
  drawEye(ctx, 0.56 * R, -0.16 * R, 0.15 * R, 0.15 * R, pose.brow === 'worried' ? lid * 0.6 : lid, look);

  // unibrow
  const b = look.brow;
  let mid = -0.42, ends = -0.4;
  if (pose.brow === 'angry') { mid = -0.28; ends = -0.5; }
  if (pose.brow === 'worried') { mid = -0.54; ends = -0.36; }
  ctx.beginPath();
  ctx.moveTo(-0.08 * R, ends * R);
  ctx.quadraticCurveTo(0.36 * R, (mid - 0.06) * R, 0.82 * R, (ends + 0.03) * R);
  outlineStroke(ctx, 0.15 * R * b, look.hair);

  // mouth
  const mx = 0.58 * R, my = 0.58 * R;
  const open = pose.mouth;
  if (open > 0.06) {
    const ry = 0.05 * R + open * 0.27 * R;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(mx, my, 0.3 * R, ry, -0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#4a120c';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#fbf3df';
    ctx.fillRect(mx - 0.3 * R, my - ry, 0.6 * R, Math.max(4, ry * 0.42));
    ctx.fillStyle = '#c4464a';
    ctx.beginPath();
    ctx.ellipse(mx + 0.02 * R, my + ry * 0.9, 0.2 * R, ry * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(mx, my, 0.3 * R, ry, -0.08, 0, Math.PI * 2);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.beginPath();
    const frown = pose.brow === 'worried' ? 0.08 : pose.brow === 'angry' ? 0.05 : -0.02;
    ctx.moveTo(mx - 0.26 * R, my + frown * R);
    ctx.quadraticCurveTo(mx, my - frown * R * 1.4, mx + 0.28 * R, my + frown * R);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3.4;
    ctx.stroke();
  }

  // nose last so it sits over the brow and mouth
  const N = look.nose;
  ctx.beginPath();
  ctx.ellipse(0.98 * R, 0.05 * R, 0.24 * R * N, 0.19 * R * N, -0.25, 0, Math.PI * 2);
  fillOutline(ctx, shade(skin, 0.05));
  ctx.beginPath();
  ctx.ellipse(0.96 * R, 0.13 * R, 0.06 * R, 0.035 * R, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = OUTLINE;
  ctx.fill();

  // hair on top
  if (look.hairStyle === 2) {
    // bald with a tuft by the ear and a comb-over strand
    ctx.beginPath();
    ctx.moveTo(-0.92 * R, 0.25 * R);
    ctx.lineTo(-1.08 * R, -0.05 * R);
    ctx.lineTo(-0.85 * R, -0.12 * R);
    ctx.lineTo(-0.98 * R, -0.38 * R);
    ctx.lineTo(-0.66 * R, -0.3 * R);
    ctx.lineTo(-0.62 * R, 0.2 * R);
    ctx.closePath();
    fillOutline(ctx, look.hair);
    ctx.beginPath();
    ctx.moveTo(-0.2 * R, -0.98 * R);
    ctx.quadraticCurveTo(0.1 * R, -1.35 * R, 0.4 * R, -1.1 * R);
    outlineStroke(ctx, 4, look.hair);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-0.1 * R, -0.78 * R, 0.25 * R, 0.08 * R, -0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    spikyHair(ctx, look, R, look.hairStyle);
    if (look.hairStyle === 4) {
      ctx.beginPath();
      ctx.arc(-0.2 * R, -1.25 * R, 0.28 * R, 0, Math.PI * 2);
      fillOutline(ctx, look.hair);
      ctx.save();
      ctx.translate(-0.2 * R, -1.25 * R);
      ctx.rotate(-0.4);
      ctx.beginPath();
      ctx.rect(-0.55 * R, -0.06 * R, 1.1 * R, 0.12 * R);
      fillOutline(ctx, '#efe6cf', 2.6);
      for (const s of [-1, 1]) {
        for (const t of [-1, 1]) {
          ctx.beginPath(); ctx.arc(s * 0.58 * R, t * 0.08 * R, 0.09 * R, 0, Math.PI * 2); fillOutline(ctx, '#efe6cf', 2.4);
        }
      }
      ctx.restore();
    }
  }

  // anger vein
  if (pose.anger > 0) {
    ctx.save();
    ctx.translate(0.2 * R, -1.05 * R);
    ctx.scale(pose.anger, pose.anger);
    ctx.strokeStyle = '#d4212a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(4, -10); ctx.quadraticCurveTo(4, -4, 10, -4);
      ctx.stroke();
    }
    ctx.restore();
  }

  // sweat
  if (pose.sweat > 0) {
    for (let i = 0; i < 3; i++) {
      const k = (pose.t * 0.9 + i / 3) % 1;
      const a = -2.4 + i * 0.55;
      const [x, y] = polar(0, -0.2 * R, R * (1.05 + k * 0.5), a);
      ctx.save();
      ctx.globalAlpha = pose.sweat * (1 - k);
      ctx.translate(x, y + k * 18);
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.quadraticCurveTo(7, 0, 0, 6);
      ctx.quadraticCurveTo(-7, 0, 0, -11);
      ctx.fillStyle = '#7fc7f0';
      ctx.fill();
      ctx.strokeStyle = '#1e5b84';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawPeltPattern(ctx, look, cx, cy, rx, ry) {
  if (look.pattern === 0) return;
  ctx.fillStyle = look.peltMark;
  ctx.strokeStyle = look.peltMark;
  for (const [u, v, s, a] of look.spots) {
    const x = cx + u * rx * 0.9, y = cy + v * ry * 0.9;
    ctx.beginPath();
    if (look.pattern === 1) {
      ctx.ellipse(x, y, 7 * s, 5 * s, a, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = 5 * s;
      ctx.lineCap = 'round';
      ctx.moveTo(x - 10, y - 4);
      ctx.quadraticCurveTo(x, y + 4, x + 12, y - 2);
      ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------ public */

export function drawCaveman(ctx, look, pose) {
  const B = look.build, H = look.height;
  const skin = look.skin, skinBack = shade(skin, -0.18);
  const hipY = -92 * H;
  const bob = pose.walk != null ? -Math.abs(Math.sin(pose.walk)) * 7 : Math.sin(pose.t * 2.2) * 1.5;

  ctx.save();
  // soft ground shadow
  ctx.fillStyle = 'rgba(30, 20, 10, 0.22)';
  ctx.beginPath();
  ctx.ellipse(4, 0, 64 * B, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs
  let fB = -24 * B, fF = 24 * B, liftB = 0, liftF = 0;
  if (pose.walk != null) {
    const s = Math.sin(pose.walk);
    fF += s * 24; fB -= s * 24;
    liftF = Math.max(0, Math.cos(pose.walk)) * 10;
    liftB = Math.max(0, -Math.cos(pose.walk)) * 10;
  }
  ctx.translate(0, bob);
  drawLeg(ctx, look, -16 * B, hipY, fB, -liftB - bob, skinBack);

  // upper body pivots at the hip for leaning and cowering
  ctx.save();
  ctx.translate(0, hipY);
  ctx.rotate(pose.lean);
  ctx.scale(1, pose.squash);
  ctx.translate(0, -hipY);

  const shB = [-30 * B, -208 * H], shF = [24 * B, -204 * H];
  drawLimbArm(ctx, look, shB[0], shB[1], pose.armB, skinBack, H, false);

  // the front leg overlaps the back arm but not the torso
  ctx.restore();
  drawLeg(ctx, look, 14 * B, hipY, fF, -liftF - bob, skin);
  ctx.save();
  ctx.translate(0, hipY);
  ctx.rotate(pose.lean);
  ctx.scale(1, pose.squash);
  ctx.translate(0, -hipY);

  // skirt with a ragged hem
  const tcx = 2, tcy = -158 * H, trx = 60 * B, try_ = 74 * H;
  ctx.beginPath();
  ctx.moveTo(-58 * B, -132 * H);
  ctx.lineTo(58 * B, -132 * H);
  ctx.lineTo(62 * B, -84 * H);
  const teeth = 7;
  for (let i = 0; i <= teeth * 2; i++) {
    const x = 62 * B - (124 * B * i) / (teeth * 2);
    ctx.lineTo(x, (i % 2 ? -66 : -80) * H);
  }
  ctx.lineTo(-58 * B, -132 * H);
  ctx.closePath();
  fillOutline(ctx, look.pelt);
  ctx.save();
  ctx.clip();
  drawPeltPattern(ctx, look, 0, -100 * H, 60 * B, 30 * H);
  ctx.restore();

  // torso: all pelt, then a bare-shoulder patch
  ctx.beginPath();
  ctx.ellipse(tcx, tcy, trx, try_, 0.18, 0, Math.PI * 2);
  ctx.fillStyle = look.pelt;
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawPeltPattern(ctx, look, tcx, tcy, trx, try_);
  ctx.beginPath();
  ctx.moveTo(-28 * B, -270 * H);
  ctx.lineTo(160, -270 * H);
  ctx.lineTo(160, -160 * H);
  ctx.lineTo(56 * B, -158 * H);
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const x = 56 * B + (-28 * B - 56 * B) * t;
    const y = -158 * H + (-226 * H + 158 * H) * t + (i % 2 ? 6 : -4);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(-28 * B, -226 * H);
  ctx.closePath();
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  // chest shading and a belly button for that Flash charm
  ctx.fillStyle = shade(skin, -0.12);
  ctx.beginPath();
  ctx.ellipse(-20 * B, -170 * H, 26 * B, 40 * H, 0.2, 0, Math.PI * 2);
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(tcx, tcy, trx, try_, 0.18, 0, Math.PI * 2);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OL;
  ctx.stroke();

  // necklace of teeth
  if (look.necklace) {
    for (let i = 0; i < 6; i++) {
      const a = 0.3 + i * 0.32;
      const [x, y] = polar(30 * B, -238 * H, 40 * B, a);
      ctx.beginPath();
      ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 11); ctx.closePath();
      fillOutline(ctx, '#f4ecd6', 2);
    }
  }

  // head, tilting a little with the jaw
  const R = 52 * look.head;
  ctx.save();
  ctx.translate(48 * B, -248 * H);
  ctx.rotate(pose.headTilt - pose.mouth * 0.06);
  drawHead(ctx, look, pose, R);
  ctx.restore();

  // front arm (and weapon) over everything
  const arm = drawLimbArm(ctx, look, shF[0], shF[1], pose.armF, skin, H, true);
  if (pose.weapon) {
    ctx.save();
    drawWeapon(ctx, look, arm.hand, arm.angle);
    ctx.restore();
    // redraw the fist over the handle
    ctx.beginPath();
    ctx.arc(arm.hand[0], arm.hand[1], 15 * look.build, 0, Math.PI * 2);
    fillOutline(ctx, skin);
  }

  ctx.restore();
  ctx.restore();
}

/** Height of the top of the head above the feet, for labels and camera. */
export function headTop(look) {
  return 248 * look.height + 52 * look.head * 1.3;
}

/** Where the face is, relative to the feet, facing right. */
export function faceOffset(look) {
  return { x: 48 * look.build + 30, y: -248 * look.height + 10 };
}

/** Small head-and-shoulders portrait for the cast list. */
export function drawPortrait(canvas, look, opts = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = opts.bg || '#cfe3ee';
  ctx.fillRect(0, 0, w, h);
  const s = (h / 150) * (opts.zoom || 1);
  ctx.save();
  // centre the head
  ctx.translate(w / 2 - 48 * look.build * s, h * 0.54 + 248 * look.height * s);
  ctx.scale(s, s);
  const pose = defaultPose();
  pose.mouth = opts.mouth || 0;
  pose.brow = opts.brow || 'neutral';
  pose.armF = [1.35, -0.2];
  drawCaveman(ctx, look, pose);
  ctx.restore();
}
