/**
 * The per-file text the embedder daemon embeds for `find` re-ranking ("A2 sketch", pilot-find): the path as the
 * document title + the file's declared symbol names in source order, deduplicated, with the `Owner.` qualifier
 * stripped (Java/C# methods are stored as `Class.method`; unstripped, the class name repeats per method — jmri
 * tokens 278k → 141k and better ranking). Body-only edits do not change it, so they never cost a re-embed.
 * Byte-identical to ~/coldstart-rag/scripts/pilot-find/build-texts.ts `A2|` texts (pinned in tests).
 */
import type { CodebaseIndex } from '../types.js';
import { isVendorForEmbedding } from '../indexer/vendor.js';

export function sketchText(relPath: string, symbols: ReadonlyArray<{ name: string; startLine: number }>): string {
  const names = [...new Set([...symbols].sort((a, b) => a.startLine - b.startLine).map((s) => s.name))];
  const bare = [...new Set(names.map((n) => n.slice(n.lastIndexOf('.') + 1)))];
  return `title: ${relPath} | text: ${bare.join(' ') || '(no symbols)'}`;
}

/**
 * Which files get a sketch (and so a vector). Never vendored/minified code (src/indexer/vendor.ts). A symbol-less file's sketch is its path alone — still worth it for
 * README.md / index.html / styles.css (real answers to docs and site prompts), not for DATA. Dropped:
 *  - a data-format file (DATA_EXT) with no symbols;
 *  - a data-format OR symbol-less file in a directory holding > BULK_DIR_MIN files of the same extension — a dump
 *    such as 36k raw XBRL .xml files (the indexer DOES extract symbols from XML, so "has symbols" alone isn't enough)
 *    or jmri's thousands of decoder XMLs: hours of embedding for vectors no prompt needs.
 * A lone pom.xml / layout .xml with symbols, and code in any directory, are kept.
 */
export const DATA_EXT = /\.(xml|csv|tsv|jsonl|ndjson|parquet|arrow|feather|avro|orc|xbrl|dat|log|sqlite|db|duckdb|npy|npz|pkl|h5|hdf5)$/i;
export const BULK_DIR_MIN = 100;
const filterCache = new WeakMap<CodebaseIndex, (rel: string) => boolean>();
export function sketchFilter(index: CodebaseIndex): (rel: string) => boolean {
  const hit = filterCache.get(index);
  if (hit) return hit;
  const slot = (rel: string) => {
    const slash = rel.lastIndexOf('/'), dot = rel.lastIndexOf('.');
    return `${rel.slice(0, Math.max(0, slash))}\0${dot > slash ? rel.slice(dot).toLowerCase() : ''}`;
  };
  const perSlot = new Map<string, number>();
  for (const rel of index.files.keys()) perSlot.set(slot(rel), (perSlot.get(slot(rel)) ?? 0) + 1);
  const fn = (rel: string): boolean => {
    const f = index.files.get(rel);
    if (!f || f.isTestFile) return false;
    if (isVendorForEmbedding(rel, f)) return false; // vendor code is NEVER embedded (USER rule)
    const data = DATA_EXT.test(rel), bare = f.symbols.length === 0;
    if (data && bare) return false;
    if ((data || bare) && (perSlot.get(slot(rel)) ?? 0) > BULK_DIR_MIN) return false;
    return true;
  };
  filterCache.set(index, fn);
  return fn;
}

/** `g<N>-sketches.jsonl` body: one `{"path","text"}` line per sketched file (sketchFilter). */
export function sketchesJsonl(index: CodebaseIndex): string {
  let out = '';
  const keep = sketchFilter(index);
  for (const [rel, f] of index.files) {
    if (!keep(rel)) continue;
    out += JSON.stringify({ path: rel, text: sketchText(rel, f.symbols) }) + '\n';
  }
  return out;
}
