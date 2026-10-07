// Every Bluesky / AT Protocol request lives here (adapted from Bluesky95).
//
// SECURITY MODEL
// This page is static. Requests go from the visitor's browser straight to
// Bluesky's servers or to the PDS that hosts their account; there is no
// backend of ours to send anything to.
//   - The app password is used for one createSession call to the user's
//     own PDS, then dropped. It is never stored or logged.
//   - Session tokens live in memory, or in sessionStorage (gone when the
//     tab closes) only if the user ticks "keep me signed in".
//   - Signed out, threads are read from the public AppView anonymously.

const PUBLIC_HOSTS = ['https://public.api.bsky.app', 'https://api.bsky.app'];
const DEFAULT_PDS = 'https://bsky.social';
const PLC = 'https://plc.directory';
const STORE_KEY = 'threadformed.session';

let publicHost = PUBLIC_HOSTS[0];

export class XrpcError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'XrpcError';
    this.status = status;
    this.code = code;
  }
}

export const session = {
  current: null, // { did, handle, accessJwt, refreshJwt, pds }
  persist: false,
  onchange: () => {},
};

function qs(params) {
  const out = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    for (const item of Array.isArray(v) ? v : [v]) out.push(encodeURIComponent(k) + '=' + encodeURIComponent(item));
  }
  return out.length ? '?' + out.join('&') : '';
}

async function request(base, nsid, { method = 'GET', params, body, token } = {}) {
  const url = base + '/xrpc/' + nsid + (method === 'GET' ? qs(params) : '');
  const init = { method, headers: {} };
  if (token) init.headers.Authorization = 'Bearer ' + token;
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new XrpcError(`Could not reach ${base}. Check your connection.`, 0, 'NetworkError');
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { /* non-JSON */ } }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || 'HTTP ' + res.status;
    throw new XrpcError(msg, res.status, data && data.error);
  }
  return data;
}

async function publicQuery(nsid, params) {
  const order = [publicHost, ...PUBLIC_HOSTS.filter((h) => h !== publicHost)];
  let lastErr;
  for (const host of order) {
    try {
      const r = await request(host, nsid, { params });
      publicHost = host;
      return r;
    } catch (err) {
      lastErr = err;
      if (err.status !== 0) throw err;
    }
  }
  throw lastErr;
}

async function withFreshToken(fn) {
  try {
    return await fn(session.current.accessJwt);
  } catch (err) {
    const expired = err.status === 401 || (err.code && /ExpiredToken|InvalidToken/i.test(err.code));
    if (!expired) throw err;
    await refresh();
    return fn(session.current.accessJwt);
  }
}

/** Reads go through the signed-in user's PDS when there is one. */
export function query(nsid, params) {
  if (session.current) {
    const pds = session.current.pds;
    return withFreshToken((token) => request(pds, nsid, { params, token }));
  }
  return publicQuery(nsid, params);
}

/* ------------------------------------------------------------ identity */

export function normalizeHandle(input) {
  let h = String(input || '').trim().replace(/^@+/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!h) return '';
  if (h.startsWith('did:')) return h;
  if (!h.includes('.')) h += '.bsky.social';
  return h.toLowerCase();
}

const didCache = new Map();
export async function resolveHandle(handle) {
  if (handle.startsWith('did:')) return handle;
  const h = handle.toLowerCase();
  if (!didCache.has(h)) {
    didCache.set(h, publicQuery('com.atproto.identity.resolveHandle', { handle: h }).then((r) => r.did));
    didCache.get(h).catch(() => didCache.delete(h));
  }
  return didCache.get(h);
}

const pdsCache = new Map();
/** Which server hosts this account (so app passwords and blob reads go to the right place). */
export function resolvePds(did) {
  if (pdsCache.has(did)) return pdsCache.get(did);
  let docUrl;
  if (did.startsWith('did:plc:')) docUrl = PLC + '/' + encodeURIComponent(did);
  else if (did.startsWith('did:web:')) docUrl = 'https://' + decodeURIComponent(did.slice(8)).split(':')[0] + '/.well-known/did.json';
  const p = !docUrl
    ? Promise.resolve(null)
    : fetch(docUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((doc) => {
        const svc = doc && (doc.service || []).find((s) => s.id === '#atproto_pds' || /#atproto_pds$/.test(s.id || ''));
        return (svc && svc.serviceEndpoint) || null;
      })
      .catch(() => null);
  pdsCache.set(did, p);
  return p;
}

/* ------------------------------------------------------------ session */

export async function login(identifier, appPassword, persist) {
  const raw = String(identifier || '').trim();
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw);
  const handle = normalizeHandle(raw);
  const pds = isEmail ? DEFAULT_PDS : (await resolvePds(await resolveHandle(handle))) || DEFAULT_PDS;
  const r = await request(pds, 'com.atproto.server.createSession', {
    method: 'POST',
    body: { identifier: isEmail ? raw : handle, password: appPassword },
  });
  // appPassword goes out of scope here and is never stored.
  session.current = { did: r.did, handle: r.handle, accessJwt: r.accessJwt, refreshJwt: r.refreshJwt, pds };
  session.persist = !!persist;
  save();
  session.onchange(session.current);
  return session.current;
}

export async function refresh() {
  const s = session.current;
  if (!s || !s.refreshJwt) throw new XrpcError('Session expired. Please sign in again.', 401, 'AuthRequired');
  try {
    const r = await request(s.pds, 'com.atproto.server.refreshSession', { method: 'POST', token: s.refreshJwt });
    s.accessJwt = r.accessJwt;
    s.refreshJwt = r.refreshJwt;
    s.handle = r.handle || s.handle;
    save();
    return s;
  } catch {
    logout();
    throw new XrpcError('Session expired. Please sign in again.', 401, 'AuthRequired');
  }
}

export function logout() {
  const s = session.current;
  session.current = null;
  try { sessionStorage.removeItem(STORE_KEY); } catch { /* storage blocked */ }
  session.onchange(null);
  if (s && s.refreshJwt) {
    request(s.pds, 'com.atproto.server.deleteSession', { method: 'POST', token: s.refreshJwt }).catch(() => {});
  }
}

function save() {
  if (!session.persist) return;
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(session.current)); } catch { /* storage blocked */ }
}

export function restore() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (s && s.accessJwt && s.did && s.pds) {
      session.current = s;
      session.persist = true;
      return s;
    }
  } catch { /* storage blocked or junk */ }
  return null;
}

/* ------------------------------------------------------------ reads */

export function getPostThread(uri) {
  return query('app.bsky.feed.getPostThread', { uri, depth: 1000, parentHeight: 1000 });
}

/**
 * Loads an image blob straight from the author's PDS. Bluesky's CDN
 * doesn't send CORS headers, and a canvas with a non-CORS image in it
 * can't be recorded, so we take the long way round.
 * Returns an HTMLImageElement (from a same-origin blob: URL) or null.
 */
const blobCache = new Map();
export function loadBlobImage(did, cid, maxSize = 512) {
  if (!did || !cid) return Promise.resolve(null);
  const key = did + '/' + cid;
  if (blobCache.has(key)) return blobCache.get(key);
  const p = (async () => {
    const pds = await resolvePds(did);
    if (!pds) return null;
    const res = await fetch(pds + '/xrpc/com.atproto.sync.getBlob' + qs({ did, cid }));
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/^image\//.test(blob.type) && blob.type !== 'application/octet-stream') return null;
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      // shrink big uploads once so drawing stays cheap
      const s = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  })().catch(() => null);
  blobCache.set(key, p);
  return p;
}
