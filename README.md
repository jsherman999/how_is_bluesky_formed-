# How Is Thread Formed?

**Live:** https://jsherman999.github.io/how_is_bluesky_formed-/

Paste a Bluesky thread link and watch it acted out as a crude Flash-style
cartoon, after the 2008 classic
[“How is babby formed?”](https://www.youtube.com/watch?v=vun48RsW-3Y).
Each poster is a caveman. They walk in, shove the last speaker off screen,
and read their post aloud while the camera slowly zooms in on their face.
The post itself scrolls by underneath, Bluesky-style, where the Yahoo
Answers page was in the original.

When several people gang up on one poster, the cartoon shows a
**pile-on**. The target stays on stage, pinned at the left edge, shrinking
and sweating. Everyone who has gone after them waits in a growing mob on
the right with clubs raised.

No build step and no server: plain ES modules, ready for GitHub Pages.

## Using it

1. Copy a post link from Bluesky (Share → Copy link) and paste it in.
2. Press **Form thread**, then the big play button.
3. **Demo** loads a made-up thread so you can see a pile-on without a link.

Options:

- **Bluesky sign-in (optional).** Public threads load anonymously. Sign
  in with your handle and an
  [app password](https://bsky.app/settings/app-passwords) to include posts
  from accounts that hide from logged-out viewers, to get a YOU tag over
  your caveman, and to post the cartoon link into the thread.
- **Voices.** *Browser voices* are free, with a different voice and pitch
  per caveman, and they're the default. *OpenAI voices* use your API key and `gpt-4o-mini-tts`,
  which is told to read like the original: slowly, earnestly, typos and
  all. *Silent* plays with no voice.
- **OpenAI key (optional).** Besides voices, a key enables **Record
  video** with sound and smarter pile-on detection. Detection takes one
  small chat call per thread to label each reply as attack, support or
  neutral.
- **Speed** starts at Fast (1.5×). *Slow* is closest to the original.
- **Thread.** If the link points at a reply, play either that reply's
  branch (what led to it plus its replies) or the whole thread from the
  top. The post limit keeps the liveliest branches.

## Linking to it from a Bluesky thread

Any link of the form
`https://jsherman999.github.io/how_is_bluesky_formed-/?t=<bsky.app post link>`
opens the page with that thread already loaded and waiting for play.
**Copy link** gives you that link for the thread on screen.

**Post link in thread** does it for you. When you're signed in, it
replies to the post you loaded with the text **how is thread formed?**.
The whole text is the link, and a preview card with the cartoon image
sits under it. A dialog shows the reply before anything is posted.

Pasting the link into the Bluesky composer by hand gets the same card,
because the page carries Open Graph tags pointing at `og.jpg`. Every
thread uses the same card, since the page is static. To redraw the
picture, edit `dev/og.html` and follow the commands in its comment.

## How the running order and pile-ons work

- Replies play depth-first, so each answer comes right after the post it
  answers. Among sibling replies, the author's own thread continuation
  goes first. After that come the busiest branches (most posts and most
  distinct people), then the oldest.
- A beat counts as a pile-on against X when, within the last 8 posts, at
  least 3 different people replied to X with something other than
  obvious agreement, and X is part of the current post.
  - Without an OpenAI key, X also has to have fought back (or been hit on
    two different posts). Otherwise every popular post would look like a
    pile-on on its author.
  - With a key, only replies the model labels "attack" count.
- Each pile-on starts at its first attack so the mob visibly grows. People
  who reply inside it without attacking X (defenders, bystanders) speak
  while the mob waits.

## Security and privacy

- `js/atp.js` makes every Bluesky request and `js/openai.js` makes every
  OpenAI request; nothing else calls `fetch`.
- The app password goes in one `createSession` call to your own PDS, and
  is then dropped. Session tokens stay in memory, or in `sessionStorage`
  if you tick "keep me signed in".
- The OpenAI key stays in `sessionStorage`, or in `localStorage` if you
  tick "remember". It is sent only to `api.openai.com`.
- Avatars and pictures come from each author's PDS through
  `com.atproto.sync.getBlob`. Bluesky's CDN sends no CORS headers, and a
  canvas holding a non-CORS image can't be recorded.
- Pictures on posts labelled adult or graphic are not drawn.

## Development

```bash
python3 -m http.server 8426
```

Then open http://localhost:8426. `dev/lineup.html` shows a row of cavemen
in every pose, which is handy when tweaking `js/caveman.js`.

Tests (thread parsing, ordering, pile-on detection, layouts):

```bash
node --test tests/thread.test.mjs
```

| File | What it does |
| --- | --- |
| `js/thread.js` | Link parsing, reply tree, running order, pile-on detection (pure) |
| `js/stage.js` | Who stands where, shoves, mob, camera, frame painting |
| `js/caveman.js` | Procedural cavemen, a stable look per account DID |
| `js/scene.js` | Prehistoric backdrop, smoke, pterodactyl |
| `js/card.js` | The scrolling Bluesky post under the scene |
| `js/voice.js` | Browser speech and OpenAI clips behind one interface |
| `js/player.js` | Beat timing: enter, speak, hold, next |
| `js/audio.js` | Web Audio graph for clips and shove sounds, feeds the recorder |
| `js/recorder.js` | MediaRecorder to MP4 or WebM |
| `js/atp.js` / `js/openai.js` | All network access |
| `js/demo.js` | The made-up demo thread |
