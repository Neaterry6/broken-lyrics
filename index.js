'use strict';

/**
 * broken-lyrics — song lyrics lookup, zero dependencies.
 *
 * Uses the public lrclib.net API via the built-in global `fetch`. No API key,
 * no signup, no SDK. Node 18+.
 *
 *   const { search, getLyrics } = require('broken-lyrics');
 *   const hits = await search('Bohemian Rhapsody');
 *   const lyrics = await getLyrics({ track: 'Bohemian Rhapsody', artist: 'Queen' });
 */

const BASE = 'https://lrclib.net/api';

/** lrclib asks clients to identify themselves. */
const USER_AGENT = 'broken-lyrics/1.0 (+https://github.com/Neaterry6/broken-lyrics)';

class LyricsError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'LyricsError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** @private */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One request, with timeout, retries and error mapping.
 * @private
 */
async function request(path, { timeoutMs = 15000, retries = 2 } = {}) {
  const url = `${BASE}${path}`;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, accept: 'application/json' },
      });
    } catch (err) {
      clearTimeout(timer);
      const code = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      lastError = new LyricsError(
        code === 'TIMEOUT' ? `Request timed out after ${timeoutMs}ms.` : `Could not reach the lyrics service: ${err.message}`,
        code
      );
      if (code === 'TIMEOUT' || attempt === retries) throw lastError;
      await sleep(400 * Math.pow(2, attempt));
      continue;
    }
    clearTimeout(timer);

    if (res.status === 404) {
      throw new LyricsError('No lyrics found for that track.', 'NOT_FOUND');
    }
    if (res.status === 429) {
      lastError = new LyricsError('Rate limited. Slow down.', 'RATE_LIMITED');
      if (attempt === retries) throw lastError;
      await sleep(600 * Math.pow(2, attempt));
      continue;
    }
    if (res.status === 400) {
      // lrclib returns 400 for a malformed or incomplete query.
      let detail = '';
      try { detail = await res.text(); } catch {}
      throw new LyricsError(
        `The service rejected the query: ${String(detail).slice(0, 160) || 'bad request'}`,
        'BAD_QUERY',
        detail
      );
    }
    if (res.status >= 500) {
      lastError = new LyricsError(`Service returned ${res.status}.`, 'SERVER_ERROR');
      if (attempt === retries) throw lastError;
      await sleep(400 * Math.pow(2, attempt));
      continue;
    }
    if (!res.ok) {
      throw new LyricsError(`Service returned ${res.status}.`, 'HTTP_ERROR', res.status);
    }

    try {
      return await res.json();
    } catch {
      throw new LyricsError('Service returned something that is not JSON.', 'BAD_RESPONSE');
    }
  }
  throw lastError;
}

/** Normalise one lrclib record into a stable shape. */
function mapRecord(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    id: r.id ?? null,
    track: r.trackName || r.name || null,
    artist: r.artistName || null,
    album: r.albumName || null,
    duration: typeof r.duration === 'number' ? r.duration : null,
    instrumental: !!r.instrumental,
    /** Plain lyrics, newline separated. Null for instrumentals. */
    lyrics: r.plainLyrics || null,
    /** LRC-format lyrics with [mm:ss.xx] timestamps, or null. */
    syncedLyrics: r.syncedLyrics || null,
    hasSynced: !!r.syncedLyrics,
  };
}

/**
 * Search for tracks by free text.
 *
 * @param {string} query Song or artist text.
 * @param {object} [options]
 * @param {number} [options.limit=10] Max results (1-50).
 * @returns {Promise<Array>} Matching tracks.
 */
async function search(query, options = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new LyricsError('search() needs a non-empty query.', 'EMPTY_QUERY');
  }
  const rawLimit = options.limit === undefined || options.limit === null ? 10 : Number(options.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.floor(rawLimit))) : 10;
  const body = await request(`/search?q=${encodeURIComponent(query.trim())}`, options);
  if (!Array.isArray(body)) {
    throw new LyricsError('Service returned an unexpected payload.', 'BAD_RESPONSE', body);
  }
  return body.map(mapRecord).filter(Boolean).slice(0, limit);
}

/**
 * Look up lyrics for a specific track.
 *
 * Pass `duration` (seconds) when you know it — it makes the match far more
 * accurate, because lrclib matches on it.
 *
 * @param {object} params
 * @param {string} params.track
 * @param {string} [params.artist]
 * @param {string} [params.album]
 * @param {number} [params.duration] Length in seconds.
 * @returns {Promise<object>} The matched record with lyrics.
 */
async function getLyrics(params = {}) {
  const { track, artist, album, duration } = params;
  if (typeof track !== 'string' || !track.trim()) {
    throw new LyricsError('getLyrics() needs a track name.', 'EMPTY_QUERY');
  }

  // The /get endpoint requires BOTH track_name and artist_name — without an
  // artist it answers 400 "missing field `artist_name`". So when we have no
  // artist, go through search and take the best match instead.
  if (!artist) {
    const query = album ? `${track} ${album}` : track;
    const best = await findLyrics(query, params);
    if (!best) throw new LyricsError('No lyrics found for that track.', 'NOT_FOUND');
    return best;
  }

  const qs = new URLSearchParams({ track_name: track.trim(), artist_name: String(artist).trim() });
  if (album) qs.set('album_name', String(album).trim());
  if (Number.isFinite(Number(duration))) qs.set('duration', String(Math.round(Number(duration))));

  const body = await request(`/get?${qs.toString()}`, params);
  const mapped = mapRecord(body);
  if (!mapped) throw new LyricsError('Service returned an unexpected payload.', 'BAD_RESPONSE', body);
  return mapped;
}

/**
 * Search, then take the best match's lyrics. The convenience path when you
 * just want words for "artist - song".
 *
 * @param {string} query
 * @param {object} [options]
 * @returns {Promise<object|null>} The best match, or null if nothing matched.
 */
async function findLyrics(query, options = {}) {
  const results = await search(query, { ...options, limit: options.limit || 10 });
  if (!results.length) return null;
  // Prefer a result that actually has lyrics, then one with synced lyrics.
  const withLyrics = results.filter((r) => r.lyrics || r.syncedLyrics);
  const pool = withLyrics.length ? withLyrics : results;
  return pool.find((r) => r.hasSynced) || pool[0];
}

/**
 * Parse LRC-format lyrics into timed lines.
 *
 * @param {string} lrc
 * @returns {Array<{time: number, seconds: number, text: string}>}
 */
function parseLrc(lrc) {
  if (typeof lrc !== 'string' || !lrc.trim()) return [];
  const out = [];
  for (const rawLine of lrc.split('\n')) {
    // a line can carry several timestamps: [00:12.34][00:56.78]words
    const stamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    // Strip only real timestamps. A blanket /\[[^\]]*\]/ would eat lyric
    // markers like [Chorus] or [Instrumental], which are part of the words.
    const text = rawLine.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();
    for (const m of stamps) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const fracRaw = m[3] || '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      const seconds = min * 60 + sec + frac;
      out.push({
        time: `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`,
        seconds,
        text,
      });
    }
  }
  return out.sort((a, b) => a.seconds - b.seconds);
}

/**
 * Pick the lyric line that should be showing at a given playback position.
 * Handy for a "now playing" display.
 *
 * @param {string|Array} lrc LRC text, or the output of parseLrc().
 * @param {number} seconds Current position.
 * @returns {{time:string, seconds:number, text:string}|null}
 */
function lineAt(lrc, seconds) {
  const lines = typeof lrc === 'string' ? parseLrc(lrc) : lrc;
  if (!Array.isArray(lines) || !lines.length) return null;
  const t = Number(seconds);
  if (!Number.isFinite(t)) return null;

  let current = null;
  for (const line of lines) {
    if (line.seconds <= t) current = line;
    else break;
  }
  return current;
}

/** Strip synced timestamps and return plain lyric text. */
function toPlain(syncedLyrics) {
  return parseLrc(syncedLyrics).map((l) => l.text).join('\n');
}

module.exports = {
  search,
  getLyrics,
  findLyrics,
  parseLrc,
  lineAt,
  toPlain,
  LyricsError,
  USER_AGENT,
};
