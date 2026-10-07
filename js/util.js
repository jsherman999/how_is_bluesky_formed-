// Small shared helpers: hashing, seeded randomness, easing, colour math.

/** 32-bit FNV-1a hash of a string. Stable across browsers and Node. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: tiny seeded PRNG returning floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rand, list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

export function range(rand, lo, hi) {
  return lo + rand() * (hi - lo);
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  backOut: (t) => {
    const c1 = 1.4, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/** Normalised progress of `t` through the window [a, b], clamped. */
export function seg(t, a, b) {
  if (b <= a) return t >= b ? 1 : 0;
  return clamp((t - a) / (b - a), 0, 1);
}

/** Darken (amt < 0) or lighten (amt > 0) a #rrggbb colour. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  } else {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  }
  const to = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

/** Cheap smooth 1-D value noise in [-1, 1], deterministic per seed. */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const r = (k) => {
    let h = Math.imul(k ^ Math.imul(seed, 0x27d4eb2d), 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return lerp(r(i), r(i + 1), u);
}
