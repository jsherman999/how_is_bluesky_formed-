import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseThreadLink, buildTree, orderPosts, makeBeats, makeCast, analyzePileOns,
  speechText, guessStance, cidFromCdnUrl, normalizePost, threadCandidates, retitleLinkPosts,
} from '../js/thread.js';
import { demoThread } from '../js/demo.js';
import { layoutFor, mobSlot } from '../js/stage.js';

test('parses bsky.app links, other clients and at:// URIs', () => {
  assert.deepEqual(parseThreadLink('https://bsky.app/profile/alice.bsky.social/post/3mtcnex43tk24'),
    { actor: 'alice.bsky.social', rkey: '3mtcnex43tk24' });
  assert.deepEqual(parseThreadLink('bsky.app/profile/did:plc:abc123/post/3abc?ref=x'),
    { actor: 'did:plc:abc123', rkey: '3abc' });
  assert.deepEqual(parseThreadLink('https://deer.social/profile/bob.com/post/3xyz/'),
    { actor: 'bob.com', rkey: '3xyz' });
  assert.deepEqual(parseThreadLink('at://did:plc:z72/app.bsky.feed.post/3mtc'),
    { actor: 'did:plc:z72', rkey: '3mtc' });
  assert.equal(parseThreadLink('https://bsky.app/profile/alice.bsky.social'), null);
  assert.equal(parseThreadLink(''), null);
  assert.equal(parseThreadLink('not a link'), null);
});

test('pulls the blob CID out of a CDN avatar URL', () => {
  assert.equal(
    cidFromCdnUrl('https://cdn.bsky.app/img/avatar/plain/did:plc:z72/bafkreihwihm6kpd6zuwhhlro75p5qks5qtrcu55jp3gddbfjsieiv7wuka@jpeg'),
    'bafkreihwihm6kpd6zuwhhlro75p5qks5qtrcu55jp3gddbfjsieiv7wuka');
  assert.equal(cidFromCdnUrl(null), null);
});

function demoBeats(max = Infinity) {
  const { focus, ancestors } = buildTree(demoThread());
  const posts = orderPosts(focus, ancestors, max);
  return makeBeats(posts);
}

test('plays replies depth-first, liveliest branches first', () => {
  const order = demoBeats().map((b) => b.post.uri.split('/').pop());
  assert.deepEqual(order, ['r', 't1', 'u1', 'g1', 'u2', 'm1', 'b1', 't2', 'u3', 'l1', 'g2']);
});

test('respects the post cap', () => {
  assert.equal(demoBeats(4).length, 4);
});

test('targets are the author being replied to', () => {
  const beats = demoBeats();
  const byId = Object.fromEntries(beats.map((b) => [b.post.uri.split('/').pop(), b]));
  assert.equal(byId.r.target, null);
  assert.equal(byId.t1.target, 'did:example:ug');
  assert.equal(byId.u1.target, 'did:example:thog');
  assert.equal(byId.l1.stance, 'support');
});

test('finds the pile-on on Ug and grows the mob', () => {
  const beats = demoBeats();
  const eps = analyzePileOns(beats);
  assert.equal(eps.length, 1);
  const ep = eps[0];
  assert.equal(ep.target, 'did:example:ug');
  assert.deepEqual(ep.attackers, ['did:example:thog', 'did:example:grok', 'did:example:mag', 'did:example:bonk']);
  assert.equal(beats[0].pile, null, 'the opening question is not part of it');
  assert.equal(beats[1].pile.size, 1);
  assert.equal(beats[2].pile.role, 'target');
  assert.deepEqual(beats[2].pile.mob, ['did:example:thog']);
  assert.equal(beats[6].pile.size, 4);
  assert.equal(beats[9].pile.role, 'other', 'lorp defends ug inside the pile-on');
  assert.equal(beats[10].pile, null, 'grok vs lorp is a new scene');
});

test('a silent author with lots of replies is not a pile-on without stances', () => {
  const root = { $type: 'app.bsky.feed.defs#threadViewPost', post: mk('r', 'op', null), replies: [] };
  for (let i = 0; i < 6; i++) root.replies.push({ $type: 'app.bsky.feed.defs#threadViewPost', post: mk('c' + i, 'p' + i, root.post.uri), replies: [] });
  const { focus } = buildTree(root);
  const beats = makeBeats(orderPosts(focus));
  assert.equal(analyzePileOns(beats).length, 0);
  // ...but it is when an LLM says they're attacks
  for (const b of beats) if (b.target) b.stance = 'attack';
  assert.equal(analyzePileOns(beats, { stanceKnown: true }).length, 1);
});

function mk(id, who, parent) {
  const did = 'did:example:' + who;
  const uri = `at://${did}/app.bsky.feed.post/${id}`;
  const record = { text: 'you are wrong about ' + id, createdAt: '2026-01-01T00:00:0' + id.length + 'Z' };
  if (parent) record.reply = { parent: { uri: parent }, root: { uri: parent } };
  return { uri, author: { did, handle: who + '.example' }, record };
}

test('speech text swaps links, handles and tags for sayable words', () => {
  const t = speechText({ text: 'hey @alice.bsky.social look https://x.com/a and example.com/b #Cavemen', images: [] });
  assert.equal(t, 'hey at alice look link and link hashtag Cavemen');
  assert.equal(speechText({ text: '', images: [{ alt: 'a rock' }] }), 'Look. Picture of a rock');
});

test('only obvious agreement is guessed as support', () => {
  assert.equal(guessStance('so true, thank you'), 'support');
  assert.equal(guessStance('thanks but you are wrong'), 'unknown');
  assert.equal(guessStance('this is a terrible take'), 'unknown');
});

test('layouts: solo speaker, and pinned target with mob', () => {
  const beats = demoBeats();
  analyzePileOns(beats);
  assert.equal(layoutFor(beats[0]).mode, 'solo');
  const l = layoutFor(beats[6]);
  assert.equal(l.mode, 'pile');
  const target = l.slots.find((s) => s.role === 'target');
  assert.equal(target.did, 'did:example:ug');
  assert.ok(target.x < 0.3);
  assert.equal(l.slots.filter((s) => s.role === 'mob').length, 3);
  assert.ok(mobSlot(5).depth >= 1);
});

test('cast keeps first-appearance order', () => {
  const cast = makeCast(demoBeats());
  assert.deepEqual([...cast.values()].map((c) => c.handle).slice(0, 3), ['ug.example', 'thog.example', 'grok.example']);
  assert.equal(cast.get('did:example:ug').posts, 4);
});

test('keeps the root reference a reply needs', () => {
  const p = normalizePost({
    uri: 'at://did:example:b/app.bsky.feed.post/2', cid: 'cidB',
    author: { did: 'did:example:b', handle: 'b.example' },
    record: { text: 'hi', reply: { root: { uri: 'at://did:example:a/app.bsky.feed.post/1', cid: 'cidA' }, parent: { uri: 'at://x', cid: 'cidX' } } },
    viewer: { replyDisabled: true },
  });
  assert.equal(p.rootUri, 'at://did:example:a/app.bsky.feed.post/1');
  assert.equal(p.rootCid, 'cidA');
  assert.equal(p.replyDisabled, true);
});

test('finds the threads a link was posted in, newest first, one per thread', () => {
  const HP = 'someone.github.io/app';
  const view = (uri, handle, at, link, root) => ({
    uri, author: { handle },
    record: {
      text: 'look', createdAt: at,
      facets: link ? [{ index: { byteStart: 0, byteEnd: 4 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: link }] }] : [],
      ...(root ? { reply: { root: { uri: root }, parent: { uri: root } } } : {}),
    },
  });
  const posts = [
    view('at://a/p/1', 'a.example', '2026-10-07T10:00:00Z', 'https://someone.github.io/app/?thread', 'at://r/p/1'),
    view('at://b/p/2', 'b.example', '2026-10-07T12:00:00Z', 'https://someone.github.io/app/?thread', 'at://r/p/2'),
    view('at://c/p/3', 'c.example', '2026-10-07T11:00:00Z', 'https://someone.github.io/app/?thread', 'at://r/p/1'),
    view('at://d/p/4', 'd.example', '2026-10-07T13:00:00Z', 'https://elsewhere.example/', 'at://r/p/9'),
    view('at://e/p/5', 'e.example', '2026-10-07T09:00:00Z', 'https://someone.github.io/app/?thread', null),
  ];
  const c = threadCandidates(posts, HP);
  assert.deepEqual(c.map((x) => x.rootUri), ['at://r/p/2', 'at://r/p/1', 'at://e/p/5']);
  assert.equal(c[1].by, 'c.example', 'keeps the newest link in a thread');
});

test('link-only posts get a line to say', () => {
  const mk = (text, links) => ({ post: { text, links }, children: [] });
  const a = mk('jsherman999.github.io/how_is_blu...', ['https://jsherman999.github.io/how_is_bluesky_formed-/?thread']);
  const b = mk('lol watch this jsherman999.github.io/how_is_blu...', ['https://jsherman999.github.io/how_is_bluesky_formed-/?thread']);
  const root = { post: { text: 'root', links: [] }, children: [a, b] };
  retitleLinkPosts({ focus: root, ancestors: [] }, 'jsherman999.github.io/how_is_bluesky_formed-');
  assert.equal(a.post.text, 'how is thread formed?');
  assert.equal(b.post.text, 'lol watch this jsherman999.github.io/how_is_blu...');
});

test('thread map layout: parents centred over their replies, depth by reply level', async () => {
  const { layoutTree } = await import('../js/threadmap.js');
  const beats = demoBeats();
  const L = layoutTree(beats);
  const id = (k) => beats.findIndex((b) => b.post.uri.endsWith('/' + k));
  assert.deepEqual(L.roots, [0]);
  assert.equal(L.pos[id('r')].depth, 0);
  assert.equal(L.pos[id('u3')].depth, 6);
  assert.equal(L.maxDepth, 6);
  // u2 has three replies (m1, b1, t2): it sits over the middle one
  assert.equal(L.pos[id('u2')].col, L.pos[id('b1')].col);
  // every column is used once by a leaf
  assert.equal(L.cols, beats.filter((_, i) => !L.kids[i].length).length);
});
