// Every OpenAI request lives here. The key arrives as an argument, goes
// out only in the Authorization header to api.openai.com, and is never
// logged.

const BASE = 'https://api.openai.com/v1';
const TTS_LIMIT = 4096;

export const TTS_MODELS = [
  { id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS (acts the part)' },
  { id: 'tts-1', name: 'TTS-1 (fast, plain)' },
  { id: 'tts-1-hd', name: 'TTS-1 HD' },
];

const ALL_VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
const CLASSIC_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

export function voicesFor(model) {
  return String(model).startsWith('gpt-') ? ALL_VOICES : CLASSIC_VOICES;
}

export class OpenAIError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'OpenAIError';
    this.status = status;
    this.code = code;
  }
}

async function call(path, { key, method = 'GET', body, blob = false, timeoutMs = 45000, signal } = {}) {
  if (!key) throw new OpenAIError('Add an OpenAI API key in Options first.', 401, 'no_key');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new OpenAIError('OpenAI took too long to answer.', 0, 'timeout');
    // OpenAI's edge rejects bad keys on POST without CORS headers, so the
    // browser only sees a network error. Ask /models for the real reason.
    if (method !== 'GET') {
      const check = await verifyKey(key);
      if (!check.ok) throw new OpenAIError(check.message, check.status || 401, 'bad_key');
    }
    throw new OpenAIError('Could not reach OpenAI. Check your connection.', 0, 'network');
  }
  clearTimeout(timer);
  if (!res.ok) {
    let msg = 'OpenAI error ' + res.status;
    try {
      const j = await res.json();
      if (j && j.error && j.error.message) msg = j.error.message;
    } catch { /* not JSON */ }
    throw new OpenAIError(msg, res.status);
  }
  return blob ? res.blob() : res.json();
}

export async function verifyKey(key) {
  try {
    await call('/models', { key, timeoutMs: 15000 });
    return { ok: true, message: 'OpenAI accepted the key.' };
  } catch (err) {
    const message = err.status === 401 ? 'OpenAI rejected that API key.' : err.message;
    return { ok: false, message, status: err.status };
  }
}

export async function listModelIds(key) {
  const j = await call('/models', { key, timeoutMs: 15000 });
  return (j.data || []).map((m) => m.id);
}

/** Cheapest decent chat model this key can see. */
export function pickChatModel(ids) {
  const set = new Set(ids);
  const bad = /(audio|realtime|tts|transcribe|search|image|codex|instruct|embedding|moderation)/i;
  const minis = ids
    .filter((id) => /^gpt-(\d+(\.\d+)?)-mini$/.test(id) && !bad.test(id))
    .sort((a, b) => parseFloat(b.slice(4)) - parseFloat(a.slice(4)));
  if (minis.length) return minis[0];
  for (const id of ['gpt-4.1-mini', 'gpt-4o-mini']) if (set.has(id)) return id;
  const any = ids.find((id) => /^gpt-/.test(id) && /mini/.test(id) && !bad.test(id));
  return any || null;
}

export async function synthesize({ key, model, voice, text, instructions, signal }) {
  const input = String(text || '').slice(0, TTS_LIMIT) || '...';
  const body = { model, voice, input, response_format: 'mp3' };
  if (instructions && String(model).startsWith('gpt-')) body.instructions = instructions;
  return call('/audio/speech', { key, method: 'POST', body, blob: true, timeoutMs: 60000, signal });
}

/**
 * Asks a small chat model whether each reply attacks, supports, or is
 * neutral toward the post it answers. items: [{ id, from, to, parent, text }].
 * Returns Map id -> 'attack' | 'support' | 'neutral'.
 */
export async function classifyStances({ key, model, items }) {
  const lines = items.map((it) =>
    JSON.stringify({
      id: it.id,
      from: it.from,
      replying_to: it.to,
      parent_post: String(it.parent || '').slice(0, 300),
      reply: String(it.text || '').slice(0, 450),
    }));
  const body = {
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You label replies in a social media thread. For each reply decide how it treats the person it is replying to: ' +
          '"attack" (disagrees, argues, corrects, mocks, scolds, dunks, or is hostile), ' +
          '"support" (agrees, praises, thanks, jokes along, or is friendly), or ' +
          '"neutral" (a plain question, unrelated, or informational). ' +
          'Return JSON: {"stances": {"<id>": "attack" | "support" | "neutral", ...}} with every id.',
      },
      { role: 'user', content: lines.join('\n') },
    ],
  };
  const j = await call('/chat/completions', { key, method: 'POST', body, timeoutMs: 90000 });
  const raw = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  let parsed = {};
  try { parsed = JSON.parse(raw || '{}'); } catch { /* fall through */ }
  const out = new Map();
  const st = parsed.stances || parsed;
  for (const it of items) {
    const v = st && st[it.id];
    if (v === 'attack' || v === 'support' || v === 'neutral') out.set(it.id, v);
  }
  return out;
}
