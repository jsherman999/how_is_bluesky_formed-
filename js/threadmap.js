// The thread map under the player: the reply tree drawn as an SVG, one
// node per post (its poster's caveman face), lines to the post it answers.
// The current post is ringed and the ring follows playback; clicking a
// face starts the cartoon there. Pile-on attacks are drawn in orange.

import { makeLook, drawPortrait } from './caveman.js?v=8';

const SVG = 'http://www.w3.org/2000/svg';
const R = 24;        // node radius
const SLOT = 74;     // horizontal space per leaf
const LEVEL = 86;    // vertical space per reply depth
const MAX_ZOOM = 1.5; // small trees get blown up to use the panel
const PAD = 34;

/**
 * Tidy-ish tree layout over the beats, in play order. Leaves take the
 * next free column; a parent sits centred over its first and last child.
 * Returns { pos: [{ col, depth }], kids, roots, cols, maxDepth }.
 */
export function layoutTree(beats) {
  const index = new Map(beats.map((b, i) => [b.post.uri, i]));
  const kids = beats.map(() => []);
  const roots = [];
  beats.forEach((b, i) => {
    const p = b.post.parentUri && index.has(b.post.parentUri) ? index.get(b.post.parentUri) : -1;
    if (p >= 0 && p < i) kids[p].push(i);
    else roots.push(i);
  });
  const pos = new Array(beats.length);
  let col = 0, maxDepth = 0;
  // iterative post-order so very deep arguments can't blow the stack
  for (const r of roots) {
    const stack = [[r, 0, false]];
    while (stack.length) {
      const [i, d, seen] = stack.pop();
      maxDepth = Math.max(maxDepth, d);
      if (!kids[i].length) { pos[i] = { col: col++, depth: d }; continue; }
      if (!seen) {
        stack.push([i, d, true]);
        for (let k = kids[i].length - 1; k >= 0; k--) stack.push([kids[i][k], d + 1, false]);
      } else {
        const first = pos[kids[i][0]].col, last = pos[kids[i][kids[i].length - 1]].col;
        pos[i] = { col: (first + last) / 2, depth: d };
      }
    }
  }
  return { pos, kids, roots, cols: col, maxDepth };
}

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

function shortHandle(h) {
  const first = String(h || '?').split('.')[0];
  return '@' + (first.length > 8 ? first.slice(0, 7) + '…' : first);
}

export class ThreadMap {
  constructor(box, { onPick }) {
    this.box = box;
    this.onPick = onPick;
    this.nodes = [];
    this.edges = [];
    this.current = -1;
    this.faces = new Map();
  }

  face(did) {
    let url = this.faces.get(did);
    if (!url) {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      drawPortrait(c, makeLook(did));
      url = c.toDataURL('image/png');
      this.faces.set(did, url);
    }
    return url;
  }

  render(beats) {
    this.box.textContent = '';
    this.nodes = [];
    this.edges = [];
    this.current = -1;
    if (!beats.length) return;
    const L = layoutTree(beats);
    this.layout = L;
    const W = Math.max(1, L.cols) * SLOT + PAD * 2 - (SLOT - 2 * R);
    const H = (L.maxDepth + 1) * LEVEL + PAD * 2 - (LEVEL - 2 * R) + 16;
    const xy = (i) => ({ x: PAD + R + L.pos[i].col * SLOT, y: PAD + R + L.pos[i].depth * LEVEL });
    this.xy = xy;

    // narrow trees are scaled up to fill the panel; wide ones scroll
    const avail = this.box.clientWidth || W;
    const zoom = Math.max(1, Math.min(MAX_ZOOM, avail / W, 540 / H));
    this.zoom = zoom;
    const svg = el('svg', { width: W * zoom, height: H * zoom, viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Thread map' });
    const defs = el('defs', {}, svg);
    el('circle', { cx: 0, cy: 0, r: R - 2 }, el('clipPath', { id: 'tm-face', clipPathUnits: 'userSpaceOnUse' }, defs));

    const edgeLayer = el('g', { class: 'tm-edges' }, svg);
    const nodeLayer = el('g', { class: 'tm-nodes' }, svg);

    beats.forEach((b, i) => {
      for (const k of L.kids[i]) {
        const a = xy(i), c = xy(k);
        const mid = (a.y + c.y) / 2;
        const kb = beats[k];
        const attack = !!(kb.pile && kb.pile.role === 'attacker' && kb.target === kb.pile.target);
        const path = el('path', {
          d: `M${a.x},${a.y + R} C${a.x},${mid} ${c.x},${mid} ${c.x},${c.y - R}`,
          class: 'tm-edge' + (attack ? ' attack' : ''),
        }, edgeLayer);
        this.edges[k] = path;
      }
    });

    beats.forEach((b, i) => {
      const { x, y } = xy(i);
      const attacked = L.kids[i].some((k) => {
        const kb = beats[k];
        return kb.pile && kb.pile.role === 'attacker' && kb.target === kb.pile.target;
      });
      const g = el('g', {
        class: 'tm-node' + (attacked ? ' attacked' : ''),
        transform: `translate(${x},${y})`,
        tabindex: '0',
        role: 'button',
        'aria-label': `Play from post ${i + 1}: @${b.post.handle}${b.targetHandle ? ' replying to @' + b.targetHandle : ''}`,
      }, nodeLayer);
      el('title', {}, g).textContent = `${i + 1}. @${b.post.handle}${b.targetHandle ? ' → @' + b.targetHandle : ''}\n${(b.post.text || '').slice(0, 160)}`;
      el('circle', { r: R + 5, class: 'tm-halo' }, g);
      el('image', { href: this.face(b.speaker), x: -R, y: -R, width: R * 2, height: R * 2, 'clip-path': 'url(#tm-face)', preserveAspectRatio: 'xMidYMid slice' }, g);
      el('circle', { r: R - 1, class: 'tm-ring' }, g);
      const label = el('text', { y: R + 19, class: 'tm-label' }, g);
      label.textContent = shortHandle(b.post.handle);
      const pick = () => this.onPick(i);
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      this.nodes[i] = g;
    });

    this.box.append(svg);
    this.setCurrent(0, true);
  }

  setCurrent(i, instant = false) {
    if (!this.nodes.length) return;
    this.nodes.forEach((g, k) => {
      g.classList.toggle('current', k === i);
      g.classList.toggle('upcoming', k > i);
    });
    this.edges.forEach((p, k) => {
      if (!p) return;
      p.classList.toggle('current', k === i);
      p.classList.toggle('upcoming', k > i);
    });
    this.current = i;
    // keep the ringed node comfortably in view
    const p = this.xy(i);
    const x = p.x * this.zoom, y = p.y * this.zoom;
    const box = this.box;
    const svg = box.firstElementChild;
    const offX = svg ? svg.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft : 0;
    const nx = x + offX, ny = y;
    const inX = nx > box.scrollLeft + box.clientWidth * 0.2 && nx < box.scrollLeft + box.clientWidth * 0.8;
    const inY = ny > box.scrollTop + box.clientHeight * 0.2 && ny < box.scrollTop + box.clientHeight * 0.8;
    if (inX && inY) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({
      left: Math.max(0, nx - box.clientWidth / 2),
      top: Math.max(0, ny - box.clientHeight / 2),
      behavior: instant || reduce ? 'auto' : 'smooth',
    });
  }
}
