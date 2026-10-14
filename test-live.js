'use strict';

// Live tests — these hit the real lrclib.net API. Run with `npm run test:live`.
const test = require('node:test');
const assert = require('node:assert');

const l = require('./index.js');

test('live: search finds a well-known song', async () => {
  const hits = await l.search('bohemian rhapsody queen');
  assert.ok(hits.length > 0, 'should find results');
  const hit = hits.find((h) => h.lyrics || h.syncedLyrics) || hits[0];
  assert.ok(hit.track, 'should have a track name');
  assert.ok(hit.artist, 'should have an artist');
});

test('live: getLyrics returns real lyric text', async () => {
  const t = await l.getLyrics({ track: 'Bohemian Rhapsody', artist: 'Queen' });
  assert.ok(t.track, 'should have a track');
  assert.ok(t.lyrics || t.syncedLyrics, 'should have lyrics');
  if (t.lyrics) {
    assert.ok(t.lyrics.length > 50, 'lyrics should be substantial');
    assert.match(t.lyrics, /real life|fantasy|Mama/i, 'should contain known lyrics');
  }
});

test('live: synced lyrics parse into timed lines', async () => {
  const t = await l.getLyrics({ track: 'Bohemian Rhapsody', artist: 'Queen' });
  if (!t.syncedLyrics) return; // not every track has synced lyrics
  const lines = l.parseLrc(t.syncedLyrics);
  assert.ok(lines.length > 3, 'should parse multiple lines, got ' + lines.length);
  for (const line of lines) {
    assert.ok(Number.isFinite(line.seconds), 'every line needs a time');
    assert.ok(line.seconds >= 0);
  }
  // times should be ascending
  for (let i = 1; i < lines.length; i++) {
    assert.ok(lines[i].seconds >= lines[i - 1].seconds, 'lines should be sorted');
  }
  const first = l.lineAt(t.syncedLyrics, lines[2].seconds);
  assert.strictEqual(first.text, lines[2].text, 'lineAt should agree with the parse');
});

test('live: findLyrics returns the best match with lyrics', async () => {
  const t = await l.findLyrics('bohemian rhapsody');
  assert.ok(t, 'should find something');
  assert.ok(t.lyrics || t.syncedLyrics, 'the chosen match should have lyrics');
});

test('live: a nonsense track returns NOT_FOUND, not a crash', async () => {
  await assert.rejects(
    () => l.getLyrics({ track: 'zzzzqqqxxyywwvv-nonexistent-song-12345' }),
    (e) => e.code === 'NOT_FOUND' || e.code === 'BAD_RESPONSE'
  );
});
