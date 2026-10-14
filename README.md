# broken-lyrics

**Song lyrics lookup with zero dependencies.** Search, plain lyrics, synced LRC lyrics, and timestamp parsing. No API key, no signup, no SDK.

```bash
npm install broken-lyrics
```

## Why this exists

Getting lyrics usually means either scraping a page or paying for an API. This wraps [lrclib](https://lrclib.net) — free, keyless, and it returns **both** plain lyrics and time-synced LRC — and adds the part most wrappers skip: parsing those timestamps so you can drive a now-playing display.

**0 dependencies. Node 18+.**

## Quick start

```js
const { getLyrics } = require('broken-lyrics');

const t = await getLyrics({ track: 'Bohemian Rhapsody', artist: 'Queen' });
console.log(t.lyrics);        // plain text, newline separated
console.log(t.syncedLyrics);  // '[00:12.34] Is this the real life?...'
```

ESM works too:

```js
import { getLyrics } from 'broken-lyrics';
```

## API

### `search(query, options?)`

Free-text search. Returns an array.

```js
const hits = await search('bohemian rhapsody');
hits[0].track;        // 'Bohemian Rhapsody'
hits[0].artist;       // 'Queen'
hits[0].hasSynced;    // true
```

| option | default | notes |
|---|---|---|
| `limit` | `10` | 1–50 |

### `getLyrics(params)`

Look up one track.

```js
await getLyrics({ track: 'Bohemian Rhapsody', artist: 'Queen' });
await getLyrics({ track: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', duration: 355 });
```

| param | notes |
|---|---|
| `track` | **required** |
| `artist` | strongly recommended — see below |
| `album` | improves accuracy |
| `duration` | length in seconds, improves accuracy a lot |

**About `artist`:** lrclib's exact-match endpoint *requires* it and rejects a track-only query with HTTP 400. So when you omit `artist`, this package transparently falls back to a search and returns the best match. You get an answer either way — but passing the artist is faster and more precise.

### `findLyrics(query, options?)`

Search and return the best match, preferring results that actually have lyrics (and synced ones above plain). Returns `null` if nothing matches.

```js
const t = await findLyrics('bohemian rhapsody');
if (t) console.log(t.lyrics);
```

### `parseLrc(lrc)`

Parse LRC text into timed lines.

```js
parseLrc('[00:12.34] Is this the real life?\n[00:17.00] Is this just fantasy?');
// [
//   { time: '00:12', seconds: 12.34, text: 'Is this the real life?' },
//   { time: '00:17', seconds: 17,    text: 'Is this just fantasy?' },
// ]
```

Handles multi-timestamp lines (`[00:10][00:20] chorus`), 2- and 3-digit fractions, metadata tags (`[ar:]`, `[ti:]`), and out-of-order input. Lyric markers like `[Chorus]` and `[Instrumental]` are **kept** — they're part of the words.

### `lineAt(lrc, seconds)`

The line that should be showing at a playback position. Pass raw LRC or the output of `parseLrc()`.

```js
const line = lineAt(t.syncedLyrics, 42.5);
console.log(line.text);
```

Returns `null` before the first line. Past the end it holds the last line.

### `toPlain(syncedLyrics)`

Strip timestamps, keep the words.

### `LyricsError`

Every failure throws this, so you branch on `.code`.

| code | meaning |
|---|---|
| `EMPTY_QUERY` | blank track/query |
| `BAD_QUERY` | the provider rejected the query (includes its reason) |
| `NOT_FOUND` | no lyrics for that track |
| `RATE_LIMITED` | HTTP 429 — backed off and retried automatically |
| `TIMEOUT` / `NETWORK` | couldn't reach the service |
| `SERVER_ERROR` | 5xx — retried |
| `HTTP_ERROR` | other non-2xx |
| `BAD_RESPONSE` | body wasn't JSON |

## Common patterns

**Now-playing display**

```js
const t = await getLyrics({ track: song.title, artist: song.artist, duration: song.duration });
const lines = parseLrc(t.syncedLyrics || '');
setInterval(() => {
  const line = lineAt(lines, audio.currentTime);
  if (line) ui.lyric = line.text;
}, 250);
```

**Karaoke highlight**

```js
const lines = parseLrc(t.syncedLyrics);
const idx = lines.findIndex((l) => l.seconds > audio.currentTime);
const active = idx === -1 ? lines.length - 1 : idx - 1;
```

**Bot command**

```js
if (text.startsWith('!lyrics ')) {
  const t = await findLyrics(text.slice(8));
  return reply(t ? t.lyrics.slice(0, 900) : 'no lyrics found');
}
```

**Handle instrumentals**

```js
const t = await getLyrics({ track, artist });
if (t.instrumental) return reply('this one has no words');
```

## Tests

```bash
npm test          # 40 offline tests, fetch stubbed, no network
npm run test:live # 5 tests against the real lrclib API
```

The offline suite covers LRC parsing edge cases, limit clamping, error mapping and retries. The live suite proves real lookups work — **it caught two bugs the stubbed tests hid**: that `/get` requires an artist, and that an explicit `limit: 0` was silently becoming 10.

## Credit

Lyrics data from [lrclib](https://lrclib.net) — free and keyless. Lyrics are
copyright their respective owners; this package only fetches them.

## Licence

MIT © Akewushola Abdulbakri Temitope (brokenvzn)
