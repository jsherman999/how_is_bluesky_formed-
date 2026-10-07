// Page wiring: the form, options, player controls, cast and running order.

import * as atp from './atp.js';
import {
  parseThreadLink, postUri, buildTree, orderPosts, makeBeats, makeCast,
  analyzePileOns, countPosts, cidFromCdnUrl, webUrlFor, threadCandidates, retitleLinkPosts,
} from './thread.js';
import { Stage } from './stage.js';
import { Narrator } from './voice.js';
import { AudioHub } from './audio.js';
import { Recorder } from './recorder.js';
import { Player } from './player.js';
import { makeLook, drawPortrait } from './caveman.js';
import { TTS_MODELS, listModelIds, pickChatModel, classifyStances, verifyKey } from './openai.js';
import { demoThread } from './demo.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'threadformed.prefs.v2'; // v2: defaults changed to fast + browser voices
const PUBLIC_BASE = 'https://jsherman999.github.io/how_is_bluesky_formed-/';
const REPLY_TEXT = 'how is thread formed?';
const GENERIC_PARAM = 'thread'; // ?thread = "work out which thread this link was posted in"
const CARD = { title: 'how is thread formed?', description: 'Watch this Bluesky thread acted out by cavemen.' };
const OPENAI_KEY = 'threadformed.openai';

/* ------------------------------------------------------------ storage */

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
}
function writePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
function readKey() {
  try { return sessionStorage.getItem(OPENAI_KEY) || localStorage.getItem(OPENAI_KEY) || ''; } catch { return ''; }
}
function writeKey(key, remember) {
  try {
    sessionStorage.removeItem(OPENAI_KEY);
    localStorage.removeItem(OPENAI_KEY);
    if (key) (remember ? localStorage : sessionStorage).setItem(OPENAI_KEY, key);
  } catch { /* storage blocked */ }
}
function keyRemembered() {
  try { return !!localStorage.getItem(OPENAI_KEY); } catch { return false; }
}

/* ------------------------------------------------------------ state */

const hub = new AudioHub();
const narrator = new Narrator(hub);
const recorder = new Recorder();
const canvas = $('stage');
const stage = new Stage(canvas, {
  onShove: () => { hub.thud(); hub.whoosh(); },
});

const avatars = new Map();
const images = new Map();
let current = { beats: [], cast: new Map(), episodes: [], link: '', demo: false, replyTo: null, replied: false };
let loadToken = 0;

const assets = {
  get(beat) {
    const p = beat.post;
    const avatar = avatars.get(p.did) || null;
    const img = p.images[0] ? images.get(p.uri) || null : null;
    return { avatar, image: img };
  },
  prefetch(beats, from) {
    for (let i = from; i < Math.min(beats.length, from + 4); i++) {
      const p = beats[i].post;
      if (p.images[0] && !images.has(p.uri)) {
        images.set(p.uri, null);
        atp.loadBlobImage(p.did, p.images[0].cid, 480).then((img) => {
          images.set(p.uri, img);
          if (img && stage.beat && stage.beat.post.uri === p.uri) {
            stage.card.setBeat(stage.beat, { index: player.index, total: player.beats.length, avatar: avatars.get(p.did), image: img, youDid: stage.youDid });
          }
        });
      }
    }
  },
};

const player = new Player({
  stage,
  narrator,
  assets,
  onBeat: (i) => highlightBeat(i),
  onState: (s) => syncControls(s),
  onEnd: () => finishRecording(),
});

/* ------------------------------------------------------------ prefs + options */

const prefs = Object.assign({ voice: 'browser', model: TTS_MODELS[0].id, speed: '1.5', from: 'post', max: '20', tags: true, stance: true }, readPrefs());

function setupOptions() {
  const sel = $('tts-model');
  for (const m of TTS_MODELS) sel.add(new Option(m.name, m.id));
  sel.value = TTS_MODELS.some((m) => m.id === prefs.model) ? prefs.model : TTS_MODELS[0].id;
  document.querySelector(`input[name=voice][value="${prefs.voice}"]`)?.click();
  document.querySelector(`input[name=from][value="${prefs.from}"]`)?.click();
  $('speed').value = prefs.speed;
  $('max-posts').value = prefs.max;
  $('tags').checked = !!prefs.tags;
  $('use-stance').checked = !!prefs.stance;
  $('openai-key').value = readKey();
  $('openai-remember').checked = keyRemembered();

  const onChange = () => {
    prefs.voice = document.querySelector('input[name=voice]:checked').value;
    prefs.from = document.querySelector('input[name=from]:checked').value;
    prefs.model = sel.value;
    prefs.speed = $('speed').value;
    prefs.max = $('max-posts').value;
    prefs.tags = $('tags').checked;
    prefs.stance = $('use-stance').checked;
    writePrefs(prefs);
    writeKey($('openai-key').value.trim(), $('openai-remember').checked);
    applyVoice();
  };
  for (const el of document.querySelectorAll('#options input, #options select')) {
    if (el.id === 'bsky-handle' || el.id === 'bsky-pass' || el.id === 'bsky-keep') continue;
    el.addEventListener('change', onChange);
  }
  $('openai-key').addEventListener('input', () => { $('key-status').textContent = ''; });
  $('check-key').addEventListener('click', async () => {
    onChange();
    const key = $('openai-key').value.trim();
    if (!key) { $('key-status').textContent = 'Paste a key first.'; return; }
    $('key-status').textContent = 'Checking…';
    const r = await verifyKey(key);
    $('key-status').textContent = r.message;
  });
  applyVoice();
}

function applyVoice() {
  const key = $('openai-key').value.trim();
  $('model-row').hidden = prefs.voice !== 'openai';
  narrator.configure({ mode: prefs.voice, key, model: prefs.model, rate: parseFloat(prefs.speed) || 1 });
  stage.showTags = !!prefs.tags;
}

/* ------------------------------------------------------------ sign-in */

function syncSession(s) {
  $('signed-out').hidden = !!s;
  $('signed-in').hidden = !s;
  $('me').textContent = s ? '@' + s.handle : '';
  stage.youDid = s ? s.did : null;
  if (stage.beat) stage.card.youDid = stage.youDid;
  renderCast();
}

function setupSignIn() {
  atp.session.onchange = syncSession;
  syncSession(atp.restore());
  $('sign-in').addEventListener('click', async () => {
    const handle = $('bsky-handle').value.trim();
    const pass = $('bsky-pass');
    if (!handle || !pass.value) { setStatus('Enter your handle and an app password to sign in.', true); return; }
    $('sign-in').disabled = true;
    setStatus('Signing in…');
    try {
      await atp.login(handle, pass.value, $('bsky-keep').checked);
      setStatus('Signed in. Threads now load through your account.');
    } catch (err) {
      setStatus('Sign-in failed: ' + err.message, true);
    } finally {
      pass.value = '';
      $('sign-in').disabled = false;
    }
  });
  $('sign-out').addEventListener('click', () => { atp.logout(); setStatus('Signed out.'); });
}

/* ------------------------------------------------------------ loading */

function setStatus(msg, isError = false, link = null) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  if (link) {
    const a = document.createElement('a');
    a.textContent = link.text;
    if (link.onClick) {
      a.href = '#';
      a.addEventListener('click', (e) => { e.preventDefault(); link.onClick(); });
    } else {
      a.href = link.href;
      a.target = '_blank';
      a.rel = 'noopener';
    }
    el.append(' ', a);
  }
}

/** Where this app lives publicly (the Pages site when running locally). */
function appBase() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  return local ? PUBLIC_BASE : location.origin + location.pathname;
}
const hostPath = () => appBase().replace(/^https?:\/\//, '').replace(/\/$/, '');
const genericLink = () => appBase() + '?' + GENERIC_PARAM;

/**
 * The public link for a thread. Built from the canonical bsky.app URL of
 * the linked post, and always pointing at the Pages site when running
 * locally so posted links work for everyone.
 */
function shareUrl() {
  const u = new URL(appBase());
  u.searchParams.set('t', current.link);
  if (current.from === 'root') u.searchParams.set('from', 'root');
  return u.toString();
}

async function stanceUp(beats, token) {
  const key = $('openai-key').value.trim();
  if (!key || !prefs.stance) return false;
  const items = beats.filter((b) => b.target).map((b) => ({
    id: String(b.index),
    from: '@' + b.post.handle,
    to: '@' + (b.targetHandle || 'someone'),
    parent: b.parentText,
    text: b.post.text,
  }));
  if (items.length < 3) return false;
  setStatus('Asking OpenAI who is attacking whom…');
  try {
    const model = pickChatModel(await listModelIds(key));
    if (!model) return false;
    const map = await classifyStances({ key, model, items });
    if (token !== loadToken) return false;
    if (map.size < items.length / 2) return false;
    for (const b of beats) {
      if (!b.target) continue;
      b.stance = map.get(String(b.index)) || 'neutral';
    }
    return true;
  } catch (err) {
    console.warn('stance check failed', err);
    return false;
  }
}

async function loadThread(input, { autoplay = false } = {}) {
  const token = ++loadToken;
  finder.close();
  const link = parseThreadLink(input);
  if (!link) {
    setStatus("That doesn't look like a Bluesky post link. Copy it from the post's Share menu.", true);
    return;
  }
  $('go').disabled = true;
  setStatus('Finding the thread…');
  try {
    const did = await atp.resolveHandle(link.actor);
    let res = await atp.getPostThread(postUri(did, link.rkey));
    let tree = buildTree(res.thread);
    const linked = tree.focus.post;
    const root = linked.rootUri;
    if (prefs.from === 'root' && root && root !== tree.focus.post.uri) {
      setStatus('Climbing to the top of the thread…');
      res = await atp.getPostThread(root);
      tree = buildTree(res.thread);
    }
    if (token !== loadToken) return;
    await present(tree, { link: webUrlFor(linked), replyTo: linked, demo: false, token, autoplay });
  } catch (err) {
    if (token !== loadToken) return;
    const msg = err.status === 400 && /not found/i.test(err.message) ? 'That post was not found. It may have been deleted.' : err.message;
    setStatus("Couldn't load that thread: " + msg, true);
  } finally {
    if (token === loadToken) $('go').disabled = false;
  }
}

async function present(tree, { link, replyTo = null, demo, token, autoplay, from = prefs.from, note = '' }) {
  const max = parseInt(prefs.max, 10) || Infinity;
  const posts = orderPosts(tree.focus, tree.ancestors, max);
  const total = countPosts(tree.focus, tree.ancestors);
  const beats = makeBeats(posts);
  const stanceKnown = demo ? false : await stanceUp(beats, token);
  if (token !== loadToken) return;
  const episodes = analyzePileOns(beats, { stanceKnown });
  const cast = makeCast(beats);
  for (const ep of episodes) {
    const t = cast.get(ep.target);
    if (t) t.piledOn++;
    for (const a of ep.attackers) { const c = cast.get(a); if (c) c.piledOnBy++; }
  }
  current = { beats, cast, episodes, link, demo, replyTo, replied: false, from };
  await narrator.assignVoices(cast);
  if (token !== loadToken) return;

  player.pause();
  const opener = beats[0].post;
  player.load(beats, cast, {
    title: 'HOW IS THREAD FORMED?',
    sub: `starring @${opener.handle}${cast.size > 1 ? ` and ${cast.size - 1} other${cast.size > 2 ? 's' : ''}` : ''}`,
  });
  $('player').hidden = false;
  $('below').hidden = false;
  $('big-play').hidden = false;
  $('scrub').max = String(Math.max(0, beats.length - 1));
  syncReplyButton();
  renderCast();
  renderOrder();
  highlightBeat(0);

  const parts = [`${beats.length} post${beats.length === 1 ? '' : 's'}`, `${cast.size} cavem${cast.size === 1 ? 'an' : 'en'}`];
  if (episodes.length) parts.push(`${episodes.length} pile-on${episodes.length === 1 ? '' : 's'}`);
  let msg = parts.join(' · ');
  if (total > beats.length) msg += ` (the ${beats.length} liveliest of ${total}; raise the limit in Options)`;
  if (stanceKnown) msg += ' · pile-ons checked by OpenAI';
  if (demo) msg = 'Demo thread (made up). ' + msg;
  if (note) msg = note + ' ' + msg;
  setStatus(msg, false, note && lastFind && lastFind.cands.length > 1 ? { text: 'Wrong thread?', onClick: showPicker } : null);

  if (!demo && link) {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('t', link);
    if (from === 'root') url.searchParams.set('from', 'root');
    history.replaceState(null, '', url);
  }
  loadAvatars(cast, token);
  if (autoplay) startPlayback();
}

async function loadAvatars(cast, token) {
  const list = [...cast.values()].filter((c) => c.avatar && !avatars.has(c.did));
  let i = 0;
  const worker = async () => {
    while (i < list.length && token === loadToken) {
      const c = list[i++];
      const img = await atp.loadBlobImage(c.did, cidFromCdnUrl(c.avatar), 128);
      if (!img) continue;
      avatars.set(c.did, img);
      if (stage.beat && stage.beat.speaker === c.did) stage.card.avatar = img;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/* ------------------------------------------------------------ finding the thread a link came from */

// Browsers don't tell a page which post a link was clicked in, so for the
// generic ?thread link we ask Bluesky's search which threads contain it.

let lastFind = null; // { cands, roots, token }

const finder = {
  open() {
    $('finder').hidden = false;
    $('generic').hidden = true;
    $('finder-steps').textContent = '';
    $('finder-picker').hidden = true;
    $('finder-cancel').textContent = 'Cancel';
  },
  close() {
    $('finder').hidden = true;
    $('generic').hidden = false;
  },
  step(text, state = 'doing') {
    const li = document.createElement('li');
    li.className = state;
    li.textContent = text;
    $('finder-steps').append(li);
    return { set(t, st) { if (t) li.textContent = t; if (st) li.className = st; } };
  },
  giveUp(text) {
    finder.step(text, 'fail');
    $('finder-cancel').textContent = 'Close';
    $('thread-url').focus();
  },
};

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function countdown(seconds, token, onTick) {
  return new Promise((resolve) => {
    let left = seconds;
    onTick(left);
    const iv = setInterval(() => {
      if (token !== loadToken) { clearInterval(iv); resolve(false); return; }
      if (--left <= 0) { clearInterval(iv); resolve(true); } else onTick(left);
    }, 1000);
  });
}

async function findThreadFromLink() {
  const token = ++loadToken;
  finder.open();
  setStatus('');
  const search = finder.step('Asking Bluesky’s search which threads contain this link…');
  const t0 = performance.now();
  const retries = [5, 10, 15];
  let cands = [];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await atp.searchPostsLinking(genericLink());
      if (token !== loadToken) return;
      cands = threadCandidates(res.posts, hostPath());
    } catch (err) {
      if (token !== loadToken) return;
      search.set(`Bluesky’s search didn’t answer (${err.message}).`, 'fail');
      return finder.giveUp('Paste the thread’s link in the box above instead.');
    }
    if (cands.length || attempt >= retries.length) break;
    const ok = await countdown(retries[attempt], token, (n) =>
      search.set(`Bluesky’s search doesn’t list the post yet. New posts can take up to a minute to show up. Checking again in ${n}s…`, 'wait'));
    if (!ok) return;
    search.set('Asking Bluesky’s search again…', 'doing');
  }
  if (!cands.length) {
    search.set('Couldn’t find a Bluesky post containing this link.', 'fail');
    return finder.giveUp('If it was posted a moment ago, reload this page in a minute, or paste the thread’s link in the box above.');
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  lastFind = { cands, roots: new Map(), token };
  if (cands.length === 1) {
    search.set(`Found the thread (${secs}s).`, 'done');
    return openCandidate(cands[0], token);
  }
  search.set(`This link is in ${cands.length} threads (${secs}s).`, 'done');
  const roots = finder.step('Getting the first post of each thread…');
  try {
    const res = await atp.getPosts(cands.slice(0, 25).map((c) => c.rootUri));
    for (const p of res.posts || []) lastFind.roots.set(p.uri, p);
  } catch { /* the list still works with less detail */ }
  if (token !== loadToken) return;
  roots.set('Pick your thread below.', 'done');
  showPicker();
}

function showPicker() {
  if (!lastFind) return;
  if ($('finder').hidden) {
    finder.open();
    finder.step(`This link is in ${lastFind.cands.length} threads.`, 'done');
  }
  const ul = $('finder-list');
  ul.textContent = '';
  for (const c of lastFind.cands) {
    const root = lastFind.roots.get(c.rootUri);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const snip = document.createElement('span');
    snip.className = 'snip';
    const who = document.createElement('b');
    who.textContent = root ? '@' + root.author.handle : 'A thread';
    snip.append(who, ': ' + (root ? (root.record && root.record.text) || '[no text]' : '(first post unavailable)'));
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `link posted by @${c.by} · ${ago(c.linkedAt)}`;
    b.append(snip, meta);
    b.addEventListener('click', () => {
      $('finder-picker').hidden = true;
      openCandidate(c, ++loadToken);
    });
    li.append(b);
    ul.append(li);
  }
  $('finder-picker').hidden = false;
}

async function openCandidate(c, token) {
  const step = finder.step('Loading the whole thread…');
  let tree;
  try {
    tree = buildTree((await atp.getPostThread(c.rootUri)).thread);
  } catch {
    // the first post may be deleted or hidden; fall back to the link's own branch
    try {
      tree = buildTree((await atp.getPostThread(c.linkUri)).thread);
    } catch (err) {
      if (token !== loadToken) return;
      step.set(`Couldn’t load that thread: ${err.message}`, 'fail');
      return finder.giveUp('Paste the thread’s link in the box above instead.');
    }
  }
  if (token !== loadToken) return;
  retitleLinkPosts(tree, hostPath());
  const start = tree.ancestors[0] ? tree.ancestors[0].post : tree.focus.post;
  step.set(`Loaded the thread @${start.handle} started.`, 'done');
  await present(tree, {
    link: webUrlFor(tree.focus.post),
    replyTo: tree.focus.post,
    demo: false,
    token,
    from: 'root',
    note: `Found it: the thread where @${c.by} posted this link ${ago(c.linkedAt)}.`,
  });
  if (token === loadToken) finder.close();
}

/* ------------------------------------------------------------ cast + order */

function renderCast() {
  const ul = $('cast');
  if (!ul) return;
  ul.textContent = '';
  const cast = [...current.cast.values()].sort((a, b) => b.posts - a.posts || a.order - b.order);
  $('cast-count').textContent = cast.length ? `(${cast.length})` : '';
  for (const c of cast) {
    const li = document.createElement('li');
    const cv = document.createElement('canvas');
    cv.width = 112; cv.height = 112;
    drawPortrait(cv, makeLook(c.did));
    const who = document.createElement('div');
    who.className = 'who';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.displayName || c.handle;
    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.textContent = '@' + c.handle;
    const badges = document.createElement('div');
    badges.className = 'badges';
    const badge = (text, cls = '') => {
      const b = document.createElement('span');
      b.className = 'badge ' + cls;
      b.textContent = text;
      badges.append(b);
    };
    badge(`${c.posts} post${c.posts === 1 ? '' : 's'}`);
    if (c.piledOn) badge(c.piledOn > 1 ? `piled on ×${c.piledOn}` : 'piled on', 'hot');
    if (c.piledOnBy) badge(c.piledOnBy > 1 ? `in ${c.piledOnBy} mobs` : 'in the mob', 'mob');
    if (stage.youDid === c.did) badge('YOU', 'you');
    who.append(name, handle, badges);
    li.append(cv, who);
    li.title = 'Jump to their first post';
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => player.jump(c.firstIndex));
    ul.append(li);
  }
}

function renderOrder() {
  const ol = $('order');
  ol.textContent = '';
  const name = (did) => (current.cast.get(did) || {}).handle || 'someone';
  let lastEp = -1;
  current.beats.forEach((b, i) => {
    const li = document.createElement('li');
    li.dataset.i = String(i);
    const body = document.createElement('div');
    const line1 = document.createElement('div');
    line1.className = 'line1';
    const who = document.createElement('b');
    who.textContent = '@' + b.post.handle;
    line1.append(who);
    if (b.targetHandle) line1.append(` → @${b.targetHandle}`);
    const snip = document.createElement('div');
    snip.className = 'snippet';
    snip.textContent = b.post.text || (b.post.images.length ? '[picture]' : '[no text]');
    body.append(line1, snip);
    li.append(body);
    if (b.pile) {
      li.classList.add('pile');
      if (b.pile.episode !== lastEp) {
        const note = document.createElement('div');
        note.className = 'pile-note';
        const ep = current.episodes[b.pile.episode];
        note.textContent = `Pile-on: ${ep.attackers.length} vs @${name(ep.target)}`;
        li.append(note);
        lastEp = b.pile.episode;
      }
    }
    li.addEventListener('click', () => player.jump(i));
    ol.append(li);
  });
}

function highlightBeat(i) {
  for (const li of $('order').querySelectorAll('li.current')) li.classList.remove('current');
  const li = $('order').querySelector(`li[data-i="${i}"]`);
  if (li) {
    li.classList.add('current');
    const box = $('order');
    const r = li.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (r.top < br.top || r.bottom > br.bottom) box.scrollTop += r.top - br.top - 40;
  }
  $('scrub').value = String(i);
  $('counter').textContent = `${i + 1} / ${current.beats.length}`;
}

/* ------------------------------------------------------------ controls */

function syncControls(s) {
  $('play').classList.toggle('is-playing', s.playing);
  $('play').setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
  $('big-play').hidden = s.playing || s.phase === 'empty' || (s.phase !== 'ready' && s.phase !== 'ended');
}

function startPlayback() {
  hub.ensure();
  player.play();
}

function setupControls() {
  $('big-play').addEventListener('click', startPlayback);
  $('play').addEventListener('click', () => { hub.ensure(); player.toggle(); });
  $('prev').addEventListener('click', () => player.prev());
  $('next').addEventListener('click', () => player.next());
  $('scrub').addEventListener('input', (e) => player.jump(parseInt(e.target.value, 10)));
  canvas.addEventListener('click', () => { hub.ensure(); player.toggle(); });
  $('mute').addEventListener('click', () => {
    const m = !$('mute').classList.contains('is-muted');
    $('mute').classList.toggle('is-muted', m);
    hub.setMuted(m);
    narrator.configure({ muted: m });
  });
  $('share').addEventListener('click', async () => {
    if (current.demo || !current.link) { setStatus('Load a real thread to get a share link.'); return; }
    try {
      await navigator.clipboard.writeText(shareUrl());
      setStatus('Link copied. Anyone who opens it gets the same cartoon.');
    } catch {
      setStatus('Copy this link: ' + shareUrl());
    }
  });
  $('reply-link').addEventListener('click', replyWithLink);
  $('record').addEventListener('click', async () => {
    if (recorder.active) { finishRecording(true); return; }
    if (!narrator.recordable) {
      const d = $('rec-dialog');
      d.returnValue = '';
      d.showModal();
      const ok = await new Promise((r) => d.addEventListener('close', () => r(d.returnValue === 'go'), { once: true }));
      if (!ok) return;
    }
    startRecording();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, button, summary, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('player').hidden) return;
    if (e.key === ' ') { e.preventDefault(); hub.ensure(); player.toggle(); }
    else if (e.key === 'ArrowRight') player.next();
    else if (e.key === 'ArrowLeft') player.prev();
  });
}

function syncReplyButton() {
  const btn = $('reply-link');
  btn.hidden = current.demo || !current.replyTo;
  btn.disabled = current.replied;
  btn.textContent = current.replied ? 'Posted in thread ✓' : 'Post link in thread';
}

async function replyWithLink() {
  const target = current.replyTo;
  if (!target || current.replied) return;
  if (!atp.session.current) {
    $('options').open = true;
    $('bsky-handle').focus();
    setStatus('Sign in with your handle and an app password (in Options) to post the link in the thread.');
    return;
  }
  if (target.replyDisabled) {
    setStatus('Replies to that post are limited, so Bluesky won\'t accept one from you.', true);
    return;
  }
  const d = $('reply-dialog');
  $('reply-to').textContent = '@' + target.handle;
  $('reply-as').textContent = '@' + atp.session.current.handle;
  $('reply-host').textContent = new URL(shareUrl()).host;
  d.returnValue = '';
  d.showModal();
  const ok = await new Promise((r) => d.addEventListener('close', () => r(d.returnValue === 'post'), { once: true }));
  if (!ok) return;

  const btn = $('reply-link');
  btn.disabled = true;
  setStatus('Posting…');
  try {
    const res = await atp.postLinkReply({
      parent: target,
      text: REPLY_TEXT,
      url: shareUrl(),
      card: { ...CARD, image: new URL('og.jpg', location.href).toString() },
    });
    current.replied = true;
    const rkey = res.uri.split('/').pop();
    setStatus('Posted.', false, { href: `https://bsky.app/profile/${atp.session.current.handle}/post/${rkey}`, text: 'See it on Bluesky' });
  } catch (err) {
    setStatus('Could not post the reply: ' + err.message, true);
  } finally {
    syncReplyButton();
  }
}

function startRecording() {
  hub.ensure();
  try {
    recorder.start(canvas, hub.recordDest.stream);
  } catch (err) {
    setStatus('Recording failed: ' + err.message, true);
    return;
  }
  $('record').textContent = 'Stop recording';
  $('record').classList.add('is-on');
  $('rec-badge').hidden = false;
  setStatus('Recording… it stops by itself at the end.');
  player.restart();
}

async function finishRecording(early = false) {
  if (!recorder.active) return;
  if (!early) await new Promise((r) => setTimeout(r, 1500));
  const blob = await recorder.stop();
  $('record').textContent = 'Record video';
  $('record').classList.remove('is-on');
  $('rec-badge').hidden = true;
  if (early) player.pause();
  if (!blob || !blob.size) { setStatus('Nothing was recorded.', true); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `how-is-thread-formed.${recorder.extension}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  setStatus(`Saved ${(blob.size / 1048576).toFixed(1)} MB video.`);
}

/* ------------------------------------------------------------ boot */

function drawLogo() {
  const c = $('logo');
  drawPortrait(c, makeLook('did:example:ug'), { mouth: 0.6, bg: '#cfe3ee' });
}

function boot() {
  drawLogo();
  setupOptions();
  setupSignIn();
  setupControls();
  $('thread-form').addEventListener('submit', (e) => {
    e.preventDefault();
    loadThread($('thread-url').value);
  });
  $('demo').addEventListener('click', async () => {
    const token = ++loadToken;
    finder.close();
    $('thread-url').value = '';
    history.replaceState(null, '', location.pathname);
    await present(buildTree(demoThread()), { link: '', demo: true, token, autoplay: false });
  });
  $('generic-link').textContent = genericLink();
  $('copy-generic').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(genericLink());
      setStatus('Copied. Paste it into any Bluesky thread.');
    } catch {
      setStatus('Copy this link: ' + genericLink());
    }
  });
  $('finder-cancel').addEventListener('click', () => {
    ++loadToken;
    finder.close();
    if ($('player').hidden) setStatus('Stopped. Paste a thread’s link above to make a cartoon.');
  });

  const params = new URLSearchParams(location.search);
  const t = params.get('t');
  if (params.get('from') === 'root') document.querySelector('input[name=from][value="root"]').click();
  if (t) {
    $('thread-url').value = t;
    loadThread(t);
  } else if (params.has(GENERIC_PARAM)) {
    findThreadFromLink();
  }
}

boot();

// for poking at from the console
window.threadformed = { player, stage, narrator, current: () => current, webUrlFor, findThreadFromLink };
