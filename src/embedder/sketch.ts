/**
 * The per-file text the embedder daemon embeds for `find` re-ranking ("A2 sketch", pilot-find): the path as the
 * document title + the file's declared symbol names in source order, deduplicated, with the `Owner.` qualifier
 * stripped (Java/C# methods are stored as `Class.method`; unstripped, the class name repeats per method — jmri
 * tokens 278k → 141k and better ranking). Body-only edits do not change it, so they never cost a re-embed.
 * Byte-identical to ~/coldstart-rag/scripts/pilot-find/build-texts.ts `A2|` texts (pinned in tests).
 */
import type { CodebaseIndex } from '../types.js';

export function sketchText(relPath: string, symbols: ReadonlyArray<{ name: string; startLine: number }>): string {
  const names = [...new Set([...symbols].sort((a, b) => a.startLine - b.startLine).map((s) => s.name))];
  const bare = [...new Set(names.map((n) => n.slice(n.lastIndexOf('.') + 1)))];
  return `title: ${relPath} | text: ${bare.join(' ') || '(no symbols)'}`;
}

/** `g<N>-sketches.jsonl` body: one `{"path","text"}` line per non-test file. */
export function sketchesJsonl(index: CodebaseIndex): string {
  let out = '';
  for (const [rel, f] of index.files) {
    if (f.isTestFile) continue;
    out += JSON.stringify({ path: rel, text: sketchText(rel, f.symbols) }) + '\n';
  }
  return out;
}
