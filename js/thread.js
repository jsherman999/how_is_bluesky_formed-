// Thread logic with no DOM and no network: parse links, flatten the reply
// tree into a running order ("beats"), and find pile-ons. Everything here
// is pure so it runs under `node --test`.

/* ---------------------------------------------------------------- links */

const RKEY = /^[A-Za-z0-9._:~-]{1,512}$/;

/**
 * Accepts a bsky.app post URL (or any client that uses the same
 * /profile/<actor>/post/<rkey> path) or an at:// URI.
 * Returns { actor, rkey } where actor is a handle or DID, or null.
 */
export function parseThreadLink(input) {
  const s = String(input || '').trim();
  if (!s) return null;

  const at = /^at:\/\/([^/\s]+)\/app\.bsky\.feed\.post\/([^/?#\s]+)/.exec(s);
  if (at) return RKEY.test(at[2]) ? { actor: decodeURIComponent(at[1]), rkey: at[2] } : null;

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s);
  } catch {
    return null;
  }
  const m = /\/profile\/([^/]+)\/post\/([^/?#]+)/.exec(url.pathname);
  if (!m) return null;
  const actor = decodeURIComponent(m[1]).replace(/^@/, '');
  if (!actor || !RKEY.test(m[2])) return null;
  return { actor, rkey: m[2] };
}

export function postUri(did, rkey) {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

export function webUrlFor(post) {
  const rkey = post.uri.split('/').pop();
  return `https://bsky.app/profile/${post.handle || post.did}/post/${rkey}`;
}

/** The blob CID is the last path segment of a cdn.bsky.app image URL. */
export function cidFromCdnUrl(url) {
  const m = /\/([a-z0-9]{40,})(?:@[a-z]+)?$/i.exec(String(url || ''));
  return m ? m[1] : null;
}

/* ---------------------------------------------------------------- posts */

/** Every URL a post record links to: link facets plus a link-card embed. */
export function linksIn(record) {
  const out = [];
  for (const f of (record && record.facets) || []) {
    for (const ft of f.features || []) if (ft.uri) out.push(ft.uri);
  }
  const e = (record && record.embed) || {};
  const ext = (e.external || (e.media && e.media.external) || {}).uri;
  if (ext) out.push(ext);
  return out;
}

const ADULT_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore', 'nsfl']);

export function normalizePost(p) {
  const r = p.record || {};
  const rawEmbed = r.embed || {};
  const media = rawEmbed.$type === 'app.bsky.embed.recordWithMedia' ? rawEmbed.media || {} : rawEmbed;
  const labels = (p.labels || []).map((l) => l.val);
  const adult = labels.some((v) => ADULT_LABELS.has(v));

  const images = !adult && media.$type === 'app.bsky.embed.images'
    ? (media.images || []).map((im) => ({
        cid: (im.image && im.image.ref && im.image.ref.$link) || (im.image && im.image.cid) || null,
        alt: im.alt || '',
      })).filter((im) => im.cid)
    : [];

  const view = p.embed || {};
  const quoted = view.$type === 'app.bsky.embed.record#view'
    ? view.record
    : view.$type === 'app.bsky.embed.recordWithMedia#view'
      ? view.record && view.record.record
      : null;
  const quote = quoted && quoted.$type === 'app.bsky.embed.record#viewRecord'
    ? { handle: quoted.author && quoted.author.handle, text: (quoted.value && quoted.value.text) || '' }
    : null;

  const external = media.$type === 'app.bsky.embed.external' && media.external
    ? { title: media.external.title || '', uri: media.external.uri || '' }
    : null;

  const author = p.author || {};
  return {
    uri: p.uri,
    cid: p.cid,
    did: author.did,
    handle: author.handle || author.did,
    displayName: (author.displayName || '').trim(),
    avatar: author.avatar || null,
    text: r.text || '',
    createdAt: r.createdAt || p.indexedAt || '',
    likeCount: p.likeCount || 0,
    replyCount: p.replyCount || 0,
    repostCount: p.repostCount || 0,
    parentUri: (r.reply && r.reply.parent && r.reply.parent.uri) || null,
    rootUri: (r.reply && r.reply.root && r.reply.root.uri) || null,
    rootCid: (r.reply && r.reply.root && r.reply.root.cid) || null,
    replyDisabled: !!(p.viewer && p.viewer.replyDisabled),
    images,
    quote,
    external,
    hasVideo: media.$type === 'app.bsky.embed.video',
    links: linksIn(r),
    adult,
  };
}

/* ---------------------------------------------------------------- finding a thread from a link */

/**
 * Given search results (post views) for posts linking to this app, the
 * threads they sit in: one entry per thread, newest link first.
 * `hostPath` is the app's address without the scheme, e.g.
 * "someone.github.io/app"; links must contain it.
 */
export function threadCandidates(postViews, hostPath) {
  const byRoot = new Map();
  for (const p of postViews || []) {
    const r = p.record || {};
    if (!linksIn(r).some((u) => u.includes(hostPath))) continue;
    const rootUri = (r.reply && r.reply.root && r.reply.root.uri) || p.uri;
    const linkedAt = r.createdAt || p.indexedAt || '';
    const prev = byRoot.get(rootUri);
    if (!prev || linkedAt > prev.linkedAt) {
      byRoot.set(rootUri, { rootUri, linkUri: p.uri, linkedAt, by: (p.author && p.author.handle) || '' });
    }
  }
  return [...byRoot.values()].sort((a, b) => String(b.linkedAt).localeCompare(String(a.linkedAt)));
}

/**
 * Posts that are nothing but a link to this app get the line
 * "how is thread formed?" so their caveman has something to say.
 */
export function retitleLinkPosts(tree, hostPath, line = 'how is thread formed?') {
  const host = hostPath.split('/')[0].toLowerCase();
  const visit = (node) => {
    const p = node.post;
    if (p.links && p.links.some((u) => u.includes(hostPath))) {
      const rest = p.text
        .split(/\s+/)
        .filter((w) => !w.toLowerCase().includes(host))
        .join(' ')
        .replace(/how is thread formed\??/gi, '');
      if (!/[\p{L}\p{N}]/u.test(rest)) p.text = line;
    }
    node.children.forEach(visit);
  };
  tree.ancestors.forEach(visit);
  visit(tree.focus);
  return tree;
}

/* ---------------------------------------------------------------- tree */

const isPostNode = (n) => n && n.post && (!n.$type || n.$type === 'app.bsky.feed.defs#threadViewPost');

/**
 * Turns a getPostThread response into plain nodes { post, children }.
 * Returns { focus, ancestors } where ancestors run root-first and stop at
 * the focus post's parent. Blocked and deleted posts are dropped.
 */
export function buildTree(threadView) {
  if (!isPostNode(threadView)) {
    const t = threadView && threadView.$type;
    if (t === 'app.bsky.feed.defs#blockedPost') throw new Error('That post is blocked from your view.');
    throw new Error('That post was not found. It may have been deleted.');
  }

  const seen = new Set();
  function convert(n, depth) {
    const post = normalizePost(n.post);
    seen.add(post.uri);
    const node = { post, children: [], depth };
    for (const child of n.replies || []) {
      if (!isPostNode(child) || seen.has(child.post.uri)) continue;
      node.children.push(convert(child, depth + 1));
    }
    return node;
  }

  const focus = convert(threadView, 0);
  const ancestors = [];
  let p = threadView.parent;
  while (isPostNode(p)) {
    ancestors.unshift({ post: normalizePost(p.post), children: [], depth: 0 });
    p = p.parent;
  }
  return { focus, ancestors };
}

function subtreeStats(node, memo) {
  if (memo.has(node)) return memo.get(node);
  let size = 1;
  const authors = new Set([node.post.did]);
  for (const c of node.children) {
    const s = subtreeStats(c, memo);
    size += s.size;
    for (const a of s.authors) authors.add(a);
  }
  const out = { size, authors };
  memo.set(node, out);
  return out;
}

/**
 * Order the thread the way it should play: depth-first so every reply
 * plays right after what it answers. Among siblings, the author's own
 * thread continuation goes first, then the liveliest branches (most posts
 * and most distinct people), then oldest first.
 */
export function orderPosts(focus, ancestors = [], maxPosts = Infinity) {
  const memo = new Map();
  const score = (n) => {
    const s = subtreeStats(n, memo);
    return s.size + 2 * (s.authors.size - 1) + Math.log1p(n.post.likeCount);
  };

  const out = [];
  let anc = ancestors;
  const ancBudget = Math.max(1, Math.floor(maxPosts / 2));
  if (anc.length > ancBudget) anc = [anc[0], ...anc.slice(anc.length - (ancBudget - 1))].slice(0, ancBudget);
  for (const a of anc) {
    if (out.length >= maxPosts) break;
    out.push(a.post);
  }

  const stack = [focus];
  while (stack.length && out.length < maxPosts) {
    const node = stack.pop();
    out.push(node.post);
    const kids = node.children.slice().sort((a, b) => {
      const selfA = a.post.did === node.post.did ? 1 : 0;
      const selfB = b.post.did === node.post.did ? 1 : 0;
      if (selfA !== selfB) return selfB - selfA;
      const d = score(b) - score(a);
      if (Math.abs(d) > 1e-9) return d;
      return String(a.post.createdAt).localeCompare(String(b.post.createdAt));
    });
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

export function countPosts(focus, ancestors = []) {
  return subtreeStats(focus, new Map()).size + ancestors.length;
}

/* ---------------------------------------------------------------- beats */

/**
 * One beat per post. `target` is the DID being replied to (null for the
 * root, for self-replies, or when the parent isn't known).
 */
export function makeBeats(posts, allPosts = posts) {
  const byUri = new Map();
  for (const p of allPosts) byUri.set(p.uri, p);
  for (const p of posts) byUri.set(p.uri, p);

  return posts.map((post, index) => {
    const parent = post.parentUri ? byUri.get(post.parentUri) : null;
    const parentDid = parent ? parent.did : post.parentUri ? post.parentUri.split('/')[2] : null;
    const target = parentDid && parentDid !== post.did ? parentDid : null;
    return {
      index,
      post,
      speaker: post.did,
      target,
      targetHandle: target && parent ? parent.handle : null,
      parentText: parent ? parent.text : '',
      sameSpeakerAsPrev: index > 0 && posts[index - 1].did === post.did,
      stance: guessStance(post.text),
      pile: null,
    };
  });
}

export function makeCast(beats) {
  const cast = new Map();
  for (const b of beats) {
    const p = b.post;
    let c = cast.get(p.did);
    if (!c) {
      c = {
        did: p.did,
        handle: p.handle,
        displayName: p.displayName,
        avatar: p.avatar,
        posts: 0,
        firstIndex: b.index,
        order: cast.size,
        piledOn: 0,
        piledOnBy: 0,
      };
      cast.set(p.did, c);
    }
    c.posts++;
  }
  return cast;
}

/* ---------------------------------------------------------------- stance */

const SUPPORT = /\b(agree[ds]?|exactly|so true|this is (so )?(true|great|good|it)|thank(s| you)|ty|love (this|it|you)|congrat\w*|well said|great (point|post|thread)|yes+|same|amen|hell yes|facts|brilliant|lol yes)\b|[❤💙💜💚🙏👏💯🥰😍]/iu;
const PUSHBACK = /\b(but|no+|not|wrong|actually|disagree|nope|bad take|incorrect|false|lie[sd]?|stupid|idiot|ridiculous|nonsense|shut up|ratio|L\b|cope|lmao no|what\?|how dare|shame)\b/i;

/**
 * Without an LLM we can only spot obvious agreement. Anything else is
 * 'unknown', which still counts toward a pile-on if the structure fits.
 */
export function guessStance(text) {
  const t = String(text || '').trim();
  if (!t) return 'unknown';
  if (t.length <= 140 && SUPPORT.test(t) && !PUSHBACK.test(t)) return 'support';
  return 'unknown';
}

/* ---------------------------------------------------------------- pile-ons */

/**
 * Finds stretches where several different people go after one person.
 *
 * A beat is hot for X when, within the last `window` beats, at least
 * `threshold` distinct people replied to X in a way that isn't plain
 * agreement, and X is part of the current beat. Without LLM stances we
 * also require that X fought back at least once (or got hit on two
 * different posts); otherwise every popular post would look like a
 * pile-on on its author.
 *
 * Each episode starts at the first of those attacks so the mob visibly
 * grows, and short detours (`bridge` beats) don't break it up.
 *
 * Sets beat.pile = { target, mob, attackers, role, size } and returns
 * the list of episodes.
 */
export function analyzePileOns(beats, opts = {}) {
  const threshold = opts.threshold || 3;
  const window = opts.window || 8;
  const bridge = opts.bridge === undefined ? 2 : opts.bridge;
  const stanceKnown = !!opts.stanceKnown;
  const n = beats.length;

  const isAttack = (b) => !!b.target && (stanceKnown ? b.stance === 'attack' : b.stance !== 'support');

  const hot = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - window + 1);
    const stats = new Map();
    const get = (x) => {
      let s = stats.get(x);
      if (!s) stats.set(x, (s = { attackers: new Set(), posts: new Set(), spoke: false, first: Infinity }));
      return s;
    };
    for (let j = lo; j <= i; j++) {
      const b = beats[j];
      if (isAttack(b)) {
        const s = get(b.target);
        s.attackers.add(b.speaker);
        s.posts.add(b.post.parentUri);
        s.first = Math.min(s.first, j);
      }
    }
    for (let j = lo; j <= i; j++) {
      const s = stats.get(beats[j].speaker);
      if (s && j > s.first) s.spoke = true;
    }
    let best = null, bestSize = 0;
    const b = beats[i];
    for (const [x, s] of stats) {
      if (x !== b.speaker && x !== b.target) continue;
      if (s.attackers.size < threshold) continue;
      if (!stanceKnown && !s.spoke && s.posts.size < 2) continue;
      if (s.attackers.size > bestSize) {
        best = { target: x, first: s.first };
        bestSize = s.attackers.size;
      }
    }
    hot[i] = best;
  }

  // Merge hot beats into episodes.
  const episodes = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const h = hot[i];
    if (h && cur && cur.target === h.target && i - cur.end - 1 <= bridge) {
      cur.end = i;
    } else if (h) {
      const prevEnd = episodes.length ? episodes[episodes.length - 1].end : -1;
      cur = { target: h.target, start: Math.max(h.first, prevEnd + 1), end: i };
      episodes.push(cur);
    }
  }

  for (const b of beats) b.pile = null;
  for (const ep of episodes) {
    const attackers = [];
    for (let i = ep.start; i <= ep.end; i++) {
      const b = beats[i];
      if (b.target === ep.target && isAttack(b) && !attackers.includes(b.speaker)) attackers.push(b.speaker);
      const role = b.speaker === ep.target ? 'target' : attackers.includes(b.speaker) ? 'attacker' : 'other';
      b.pile = {
        target: ep.target,
        attackers: attackers.slice(),
        mob: attackers.filter((a) => a !== b.speaker),
        role,
        size: attackers.length,
        episode: episodes.indexOf(ep),
      };
    }
    ep.attackers = attackers;
  }
  return episodes;
}

/* ---------------------------------------------------------------- text */

/** What the caveman actually says out loud. */
export function speechText(post) {
  let t = String(post.text || '');
  t = t.replace(/https?:\/\/\S+/gi, ' link ');
  t = t.replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*/gi, ' link ');
  t = t.replace(/@([a-z0-9-]+)(\.[a-z0-9-]+)+/gi, (_, first) => ' at ' + first + ' ');
  t = t.replace(/#([\p{L}\p{N}_]+)/gu, ' hashtag $1 ');
  t = t.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t) return t;
  if (post.images && post.images.length) {
    const alt = post.images[0].alt.trim();
    return alt ? 'Look. Picture of ' + alt.slice(0, 200) : 'Look at this picture.';
  }
  if (post.hasVideo) return 'Watch this video.';
  if (post.quote) return 'Look at this.';
  if (post.external) return 'Look at this link.';
  return 'Hmm.';
}

/** Rough seconds to read `text` aloud at normal speed. */
export function estimateSpeechSeconds(text, rate = 1) {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  return (0.5 + words / 2.5) / rate;
}
