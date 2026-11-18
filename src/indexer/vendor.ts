/**
 * Vendored / minified code: never an answer. `find` drops it from the page and from pointers; the embedder never
 * embeds it (sketchFilter). By path (vendored tree / *.min.*) OR by content shape — chars-per-line ≫ real source
 * (minified bundles run 2700-43000 cpl, real source p99 ≈ 600), which catches un-suffixed bundles like nifty.js that
 * the path rule misses. Scoped to script/style languages so data/config files and golds are never touched.
 * Index-only (lineCount/tokenEstimate), NO file read.
 */
import type { IndexedFile } from '../types.js';

const VENDOR_PATH = /(^|\/)(node_modules|vendor|bower_components)\//i;
const MIN_SUFFIX = /\.min\.(js|css)$/i;
const SCRIPT_STYLE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|css|scss|sass|less)$/i;
const MINIFIED_CPL = 1000;
export const isVendorOrMinified = (rel: string, file: Pick<IndexedFile, 'lineCount' | 'tokenEstimate'>): boolean => {
  if (VENDOR_PATH.test(rel) || MIN_SUFFIX.test(rel)) return true;
  return SCRIPT_STYLE_EXT.test(rel) && file.lineCount > 0
    && (file.tokenEstimate * 4) / file.lineCount > MINIFIED_CPL;
};

/** Wider net for the embedder only (USER rule: no vendor code is ever embedded); find's page keeps the rule above. */
const EMBED_VENDOR_PATH = /(^|\/)(third[_-]?party|jspm_packages|site-packages|\.venv|venv|Pods|Carthage|\.yarn|deps)\//i;
export const isVendorForEmbedding = (rel: string, file: Pick<IndexedFile, 'lineCount' | 'tokenEstimate'>): boolean =>
  isVendorOrMinified(rel, file) || EMBED_VENDOR_PATH.test(rel);
