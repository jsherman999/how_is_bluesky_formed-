// A made-up thread so the page can show what it does before anyone pastes
// a link. Handles use the reserved .example domain so they can't collide
// with real accounts.

const PEOPLE = {
  ug: ['did:example:ug', 'ug.example', 'Ug'],
  thog: ['did:example:thog', 'thog.example', 'Thog'],
  grok: ['did:example:grok', 'grok.example', 'Grok the Wise'],
  mag: ['did:example:mag', 'mag.example', 'Mag'],
  bonk: ['did:example:bonk', 'bonk.example', 'BONK'],
  lorp: ['did:example:lorp', 'lorp.example', 'lorp'],
};

let clock = Date.parse('2026-10-01T15:00:00Z');

function post(id, who, text, parent, root, likes = 0) {
  const [did, handle, displayName] = PEOPLE[who];
  clock += 97000;
  const uri = `at://${did}/app.bsky.feed.post/${id}`;
  const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date(clock).toISOString() };
  if (parent) record.reply = { parent: { uri: parent }, root: { uri: root } };
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post: { uri, cid: 'demo' + id, author: { did, handle, displayName }, record, likeCount: likes, replyCount: 0, repostCount: 0 },
    replies: [],
  };
}

export function demoThread() {
  clock = Date.parse('2026-10-01T15:00:00Z');
  const R = post('r', 'ug', 'how is fire formed? how rock get hot', null, null, 12);
  const root = R.post.uri;
  const T1 = post('t1', 'thog', 'fire come from sky when sky get angry. everybody know this', root, root, 8);
  const U1 = post('u1', 'ug', 'sky not angry. sky is nice. ug look at sky every day', T1.post.uri, root, 2);
  const G1 = post('g1', 'grok', 'ug you need to stop asking about fire. fire is not toy. fire is responsibility', U1.post.uri, root, 20);
  const U2 = post('u2', 'ug', 'WHY EVERYONE YELL AT UG. ug just asking question', G1.post.uri, root, 1);
  const M1 = post('m1', 'mag', 'ug this is why nobody invite you to cave party', U2.post.uri, root, 60);
  const B1 = post('b1', 'bonk', 'ratio + no fire + you live in small cave', U2.post.uri, root, 45);
  const T2 = post('t2', 'thog', 'fire made from rub two stick together. thog do it yesterday. thog burn hand', U2.post.uri, root, 0);
  const U3 = post('u3', 'ug', 'ok. ug go ask on different cave wall', T2.post.uri, root, 0);
  const L1 = post('l1', 'lorp', 'i love this question ug. thank you for asking it', root, root, 4);
  const G2 = post('g2', 'grok', 'lorp you are part of the problem', L1.post.uri, root, 9);

  R.replies = [T1, L1];
  T1.replies = [U1];
  U1.replies = [G1];
  G1.replies = [U2];
  U2.replies = [M1, B1, T2];
  T2.replies = [U3];
  L1.replies = [G2];
  return R;
}
