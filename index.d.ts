/** A track with its lyrics. */
export interface LyricTrack {
  id: number | null;
  track: string | null;
  artist: string | null;
  album: string | null;
  /** Length in seconds, or null. */
  duration: number | null;
  instrumental: boolean;
  /** Plain lyrics, newline separated. Null for instrumentals. */
  lyrics: string | null;
  /** LRC text with [mm:ss.xx] timestamps, or null. */
  syncedLyrics: string | null;
  hasSynced: boolean;
}

export interface LookupParams {
  track: string;
  /**
   * Strongly recommended. lrclib's /get endpoint requires an artist, so when
   * this is omitted the lookup transparently falls back to a search.
   */
  artist?: string;
  album?: string;
  /** Length in seconds. Improves match accuracy a lot. */
  duration?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface SearchOptions {
  /** Max results, 1-50. Default 10. */
  limit?: number;
  timeoutMs?: number;
  retries?: number;
}

/** A timed lyric line. */
export interface LyricLine {
  /** 'mm:ss' */
  time: string;
  /** Position in seconds. */
  seconds: number;
  text: string;
}

export type LyricsErrorCode =
  | 'EMPTY_QUERY'
  | 'BAD_QUERY'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE';

export declare class LyricsError extends Error {
  name: 'LyricsError';
  code: LyricsErrorCode;
  details?: unknown;
  constructor(message: string, code: LyricsErrorCode, details?: unknown);
}

export declare function search(query: string, options?: SearchOptions): Promise<LyricTrack[]>;
export declare function getLyrics(params: LookupParams): Promise<LyricTrack>;
export declare function findLyrics(query: string, options?: SearchOptions): Promise<LyricTrack | null>;
export declare function parseLrc(lrc: string): LyricLine[];
export declare function lineAt(lrc: string | LyricLine[], seconds: number): LyricLine | null;
export declare function toPlain(syncedLyrics: string): string;
export declare const USER_AGENT: string;

declare const _default: {
  search: typeof search;
  getLyrics: typeof getLyrics;
  findLyrics: typeof findLyrics;
  parseLrc: typeof parseLrc;
  lineAt: typeof lineAt;
  toPlain: typeof toPlain;
  LyricsError: typeof LyricsError;
};
export default _default;
