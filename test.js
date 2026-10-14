'use strict';

// Offline tests. fetch is stubbed so these are deterministic and need no network.
const test = require('node:test');
const assert = require('node:assert');

const l = require('./index.js');

const realFetch = global.fetch;
function stubFetch(handler) {
  global.fetch = async (url, opts) => handler(String(url), opts);
  return () => { global.fetch = realFetch; };
}
function ok(json) {
  return { ok: true, status: 200, json: async () => json };
}

const RECORD = {
  id: 1,
  trackName: 'Bohemian Rhapsody',
  artistName: 'Queen',
  albumName: 'A Night at the Opera',
  duration: 354,
  instrumental: false,
  plainLyrics: 'Is this the real life?\nIs this just fantasy?',
  syncedLyrics: '[00:12.34] Is this the real life?\n[00:17.00] Is this just fantasy?',
};

// ── search ────────────────────────────────────────────────────────────────

test('search() maps records into a stable shape', async () => {
  const restore = stubFetch(() => ok([RECORD]));
  try {
    const [t] = await l.search('bohemian rhapsody');
    assert.strictEqual(t.track, 'Bohemian Rhapsody');
    assert.strictEqual(t.artist, 'Queen');
    assert.strictEqual(t.album, 'A Night at the Opera');
    assert.strictEqual(t.duration, 354);
    assert.strictEqual(t.hasSynced, true);
    assert.ok(t.lyrics.includes('real life'));
  } finally { restore(); }
});

test('search() sends a User-Agent and the query', async () => {
  let url = '', headers = null;
  const restore = stubFetch((u, o) => { url = u; headers = o.headers; return ok([RECORD]); });
  try {
    await l.search('test song');
    assert.match(url, /q=test%20song/);
    assert.match(headers['User-Agent'], /broken-lyrics/);
  } finally { restore(); }
});

test('search() respects limit', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...RECORD, id: i }));
  const restore = stubFetch(() => ok(many));
  try {
    const r = await l.search('x', { limit: 5 });
    assert.strictEqual(r.length, 5);
  } finally { restore(); }
});

test('search() clamps a silly limit', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ...RECORD, id: i }));
  const restore = stubFetch(() => ok(many));
  try {
    assert.strictEqual((await l.search('x', { limit: 9999 })).length, 50);
    assert.strictEqual((await l.search('x', { limit: 0 })).length, 1);
  } finally { restore(); }
});

test('an empty query throws EMPTY_QUERY without a network call', async () => {
  let called = false;
  const restore = stubFetch(() => { called = true; return ok([]); });
  try {
    await assert.rejects(() => l.search(''), (e) => e.code === 'EMPTY_QUERY');
    await assert.rejects(() => l.search('   '), (e) => e.code === 'EMPTY_QUERY');
    await assert.rejects(() => l.search(null), (e) => e.code === 'EMPTY_QUERY');
    assert.strictEqual(called, false);
  } finally { restore(); }
});

test('a non-array search response becomes BAD_RESPONSE', async () => {
  const restore = stubFetch(() => ok({ nope: true }));
  try {
    await assert.rejects(() => l.search('x'), (e) => e.code === 'BAD_RESPONSE');
  } finally { restore(); }
});

test('null entries in the results are dropped', async () => {
  const restore = stubFetch(() => ok([RECORD, null, undefined]));
  try {
    const r = await l.search('x');
    assert.strictEqual(r.length, 1);
  } finally { restore(); }
});

// ── getLyrics ─────────────────────────────────────────────────────────────

test('getLyrics() builds the query from track/artist/album/duration', async () => {
  let url = '';
  const restore = stubFetch((u) => { url = u; return ok(RECORD); });
  try {
    await l.getLyrics({ track: 'Bohemian Rhapsody', artist: 'Queen', album: 'Opera', duration: 354.7 });
    assert.match(url, /track_name=Bohemian\+Rhapsody/);
    assert.match(url, /artist_name=Queen/);
    assert.match(url, /album_name=Opera/);
    assert.match(url, /duration=355/, 'duration should be rounded');
  } finally { restore(); }
});

test('getLyrics() with no artist goes through search (regression)', async () => {
  // lrclib's /get REQUIRES artist_name and 400s without it, so a track-only
  // lookup must fall back to /search rather than calling /get and failing.
  const seen = [];
  const restore = stubFetch((u) => {
    seen.push(u);
    return ok([RECORD]); // search returns an array
  });
  try {
    const t = await l.getLyrics({ track: 'Hello' });
    assert.ok(seen.length > 0);
    assert.match(seen[0], /\/search\?q=/, 'should use the search endpoint');
    assert.ok(!seen.some((u) => u.includes('/get?')), 'must NOT call /get without an artist');
    assert.strictEqual(t.track, 'Bohemian Rhapsody');
  } finally { restore(); }
});

test('getLyrics() WITH an artist uses /get', async () => {
  let url = '';
  const restore = stubFetch((u) => { url = u; return ok(RECORD); });
  try {
    await l.getLyrics({ track: 'Bohemian Rhapsody', artist: 'Queen' });
    assert.match(url, /\/get\?/);
    assert.match(url, /artist_name=Queen/);
  } finally { restore(); }
});

test('getLyrics() needs a track', async () => {
  await assert.rejects(() => l.getLyrics({}), (e) => e.code === 'EMPTY_QUERY');
  await assert.rejects(() => l.getLyrics({ track: '  ' }), (e) => e.code === 'EMPTY_QUERY');
});

test('a 404 becomes NOT_FOUND', async () => {
  const restore = stubFetch(() => ({ ok: false, status: 404, json: async () => ({}) }));
  try {
    await assert.rejects(() => l.getLyrics({ track: 'nope' }), (e) => e.code === 'NOT_FOUND');
  } finally { restore(); }
});

// ── findLyrics ────────────────────────────────────────────────────────────

test('findLyrics() prefers a result that has lyrics', async () => {
  const noLyrics = { ...RECORD, id: 2, plainLyrics: null, syncedLyrics: null, trackName: 'No Words' };
  const restore = stubFetch(() => ok([noLyrics, RECORD]));
  try {
    const t = await l.findLyrics('x');
    assert.strictEqual(t.track, 'Bohemian Rhapsody', 'should skip the lyric-less one');
  } finally { restore(); }
});

test('findLyrics() prefers synced lyrics when available', async () => {
  const plainOnly = { ...RECORD, id: 3, syncedLyrics: null, trackName: 'Plain Only' };
  const restore = stubFetch(() => ok([plainOnly, RECORD]));
  try {
    const t = await l.findLyrics('x');
    assert.strictEqual(t.track, 'Bohemian Rhapsody', 'should prefer the synced one');
    assert.strictEqual(t.hasSynced, true);
  } finally { restore(); }
});

test('findLyrics() returns null when nothing matches', async () => {
  const restore = stubFetch(() => ok([]));
  try {
    assert.strictEqual(await l.findLyrics('zzz'), null);
  } finally { restore(); }
});

// ── LRC parsing ───────────────────────────────────────────────────────────

test('parseLrc() reads timestamps', () => {
  const lines = l.parseLrc('[00:12.34] Is this the real life?\n[00:17.00] Is this just fantasy?');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].text, 'Is this the real life?');
  assert.strictEqual(lines[0].time, '00:12');
  assert.ok(Math.abs(lines[0].seconds - 12.34) < 0.001, 'got ' + lines[0].seconds);
  assert.ok(Math.abs(lines[1].seconds - 17) < 0.001);
});

test('parseLrc() handles two-digit and three-digit fractions', () => {
  const a = l.parseLrc('[00:01.5] five tenths');
  const b = l.parseLrc('[00:01.500] five hundred ms');
  assert.ok(Math.abs(a[0].seconds - 1.5) < 0.001, 'got ' + a[0].seconds);
  assert.ok(Math.abs(b[0].seconds - 1.5) < 0.001, 'got ' + b[0].seconds);
});

test('parseLrc() handles a line with several timestamps', () => {
  const lines = l.parseLrc('[00:10.00][00:20.00] repeated chorus');
  assert.strictEqual(lines.length, 2, 'one entry per timestamp');
  assert.strictEqual(lines[0].text, 'repeated chorus');
  assert.strictEqual(lines[1].text, 'repeated chorus');
  assert.ok(lines[0].seconds < lines[1].seconds);
});

test('parseLrc() sorts out-of-order input', () => {
  const lines = l.parseLrc('[00:30.00] third\n[00:10.00] first\n[00:20.00] second');
  assert.deepStrictEqual(lines.map((x) => x.text), ['first', 'second', 'third']);
});

test('parseLrc() ignores metadata tags', () => {
  const lines = l.parseLrc('[ar:Queen]\n[ti:Bohemian Rhapsody]\n[00:12.34] real line');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].text, 'real line');
});

test('parseLrc() handles minutes over 60 and empty lines', () => {
  const lines = l.parseLrc('[05:03.00] long song\n\n[06:00.00] later');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].seconds, 303);
  assert.strictEqual(lines[1].seconds, 360);
});

test('parseLrc() returns [] for junk input', () => {
  assert.deepStrictEqual(l.parseLrc(''), []);
  assert.deepStrictEqual(l.parseLrc('no timestamps here'), []);
  assert.deepStrictEqual(l.parseLrc(null), []);
  assert.deepStrictEqual(l.parseLrc(undefined), []);
});

test('parseLrc() keeps an instrumental marker line', () => {
  const lines = l.parseLrc('[00:00.00] [Instrumental]');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].text, '[Instrumental]');
});

// ── lineAt ────────────────────────────────────────────────────────────────

test('lineAt() finds the line playing at a position', () => {
  const lrc = '[00:10.00] first\n[00:20.00] second\n[00:30.00] third';
  assert.strictEqual(l.lineAt(lrc, 5), null, 'before the first line');
  assert.strictEqual(l.lineAt(lrc, 10).text, 'first', 'exactly on a line');
  assert.strictEqual(l.lineAt(lrc, 15).text, 'first', 'between lines');
  assert.strictEqual(l.lineAt(lrc, 25).text, 'second');
  assert.strictEqual(l.lineAt(lrc, 999).text, 'third', 'past the end holds the last line');
});

test('lineAt() accepts pre-parsed lines', () => {
  const lines = l.parseLrc('[00:10.00] first\n[00:20.00] second');
  assert.strictEqual(l.lineAt(lines, 15).text, 'first');
});

test('lineAt() returns null for bad input', () => {
  assert.strictEqual(l.lineAt('[00:10.00] x', NaN), null);
  assert.strictEqual(l.lineAt('', 5), null);
  assert.strictEqual(l.lineAt(null, 5), null);
});

// ── toPlain ───────────────────────────────────────────────────────────────

test('toPlain() strips timestamps', () => {
  const plain = l.toPlain('[00:12.34] Is this the real life?\n[00:17.00] Is this just fantasy?');
  assert.strictEqual(plain, 'Is this the real life?\nIs this just fantasy?');
});

test('toPlain() returns an empty string for junk', () => {
  assert.strictEqual(l.toPlain(''), '');
  assert.strictEqual(l.toPlain(null), '');
});

// ── errors / http ─────────────────────────────────────────────────────────

test('429 becomes RATE_LIMITED and is retried', async () => {
  let attempts = 0;
  const restore = stubFetch(() => { attempts++; return { ok: false, status: 429, json: async () => ({}) }; });
  try {
    await assert.rejects(() => l.search('x', { retries: 1 }), (e) => e.code === 'RATE_LIMITED');
    assert.strictEqual(attempts, 2);
  } finally { restore(); }
});

test('a transient 500 recovers', async () => {
  let attempts = 0;
  const restore = stubFetch(() => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 500, json: async () => ({}) };
    return ok([RECORD]);
  });
  try {
    const r = await l.search('x', { retries: 2 });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(attempts, 2);
  } finally { restore(); }
});

test('a network failure becomes NETWORK', async () => {
  const restore = stubFetch(() => { throw new Error('ECONNREFUSED'); });
  try {
    await assert.rejects(() => l.search('x', { retries: 0 }), (e) => e.code === 'NETWORK');
  } finally { restore(); }
});

test('a non-JSON body becomes BAD_RESPONSE', async () => {
  const restore = stubFetch(() => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } }));
  try {
    await assert.rejects(() => l.search('x'), (e) => e.code === 'BAD_RESPONSE');
  } finally { restore(); }
});

test('an instrumental has no lyrics but is still a valid result', async () => {
  const inst = { ...RECORD, instrumental: true, plainLyrics: null, syncedLyrics: null };
  const restore = stubFetch(() => ok(inst)); // /get returns a single object
  try {
    const t = await l.getLyrics({ track: 'x', artist: 'y' });
    assert.strictEqual(t.instrumental, true);
    assert.strictEqual(t.lyrics, null);
    assert.strictEqual(t.hasSynced, false);
  } finally { restore(); }
});

test('a 400 from the provider becomes BAD_QUERY with the detail', async () => {
  const restore = stubFetch(() => ({
    ok: false,
    status: 400,
    text: async () => 'missing field `artist_name`',
    json: async () => ({}),
  }));
  try {
    await assert.rejects(() => l.getLyrics({ track: 'x', artist: 'y' }), (e) => {
      assert.strictEqual(e.code, 'BAD_QUERY');
      assert.match(e.message, /artist_name/);
      return true;
    });
  } finally { restore(); }
});

test('limit 0 clamps to 1, it does not silently become 10 (regression)', async () => {
  // `Number(0) || 10` returns 10 because 0 is falsy. An explicit 0 must clamp to
  // the minimum, not fall through to the default.
  const many = Array.from({ length: 30 }, (_, i) => ({ ...RECORD, id: i }));
  const restore = stubFetch(() => ok(many));
  try {
    assert.strictEqual((await l.search('x', { limit: 0 })).length, 1);
    assert.strictEqual((await l.search('x', { limit: 1 })).length, 1);
  } finally { restore(); }
});

test('limit of a non-number falls back to the default (regression)', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...RECORD, id: i }));
  const restore = stubFetch(() => ok(many));
  try {
    assert.strictEqual((await l.search('x', { limit: 'abc' })).length, 10);
    assert.strictEqual((await l.search('x', { limit: NaN })).length, 10);
  } finally { restore(); }
});

test('bracketed lyric markers survive parsing (regression)', () => {
  // Stripping every [ ... ] group ate real lyric text like [Chorus].
  const lines = l.parseLrc('[00:00.00] [Instrumental]\n[00:05.00] [Chorus] sing along');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].text, '[Instrumental]');
  assert.strictEqual(lines[1].text, '[Chorus] sing along');
});

test('metadata tags are still dropped while markers survive', () => {
  const lines = l.parseLrc('[ar:Queen]\n[ti:Test]\n[00:10.00] [Verse 1] hello');
  assert.strictEqual(lines.length, 1, 'only the timed line counts');
  assert.strictEqual(lines[0].text, '[Verse 1] hello');
});

test('toPlain keeps bracketed markers too', () => {
  assert.strictEqual(l.toPlain('[00:00.00] [Instrumental]'), '[Instrumental]');
});

test('LyricsError is a real Error carrying a code', () => {
  const e = new l.LyricsError('boom', 'TIMEOUT');
  assert.ok(e instanceof Error);
  assert.strictEqual(e.name, 'LyricsError');
  assert.strictEqual(e.code, 'TIMEOUT');
});
