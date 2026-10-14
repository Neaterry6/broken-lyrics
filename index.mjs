// ESM wrapper around the CommonJS implementation.
import mod from './index.js';

export const search = mod.search;
export const getLyrics = mod.getLyrics;
export const findLyrics = mod.findLyrics;
export const parseLrc = mod.parseLrc;
export const lineAt = mod.lineAt;
export const toPlain = mod.toPlain;
export const LyricsError = mod.LyricsError;

export default mod;
