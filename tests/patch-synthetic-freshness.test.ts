import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { walkDirectory } from '../src/indexer/walker.js';
import { parseFile, buildFileId } from '../src/indexer/parser.js';
import { resolveImports } from '../src/indexer/resolvers/index.js';
import { buildGraph } from '../src/indexer/graph.js';
import { addRailsSyntheticEdges } from '../src/indexer/rails-synthetic.js';
import { buildFileDomains, isTestPath } from '../src/indexer/tokenize.js';
import { buildContentTokenPostings } from '../src/indexer/content-tokens.js';
import { buildSymbolEdges } from '../src/indexer/symbol-edges.js';
import { baseIndexedFile } from '../src/indexer/indexed-file.js';
import { patchIndex } from '../src/indexer/patch.js';
import type { CodebaseIndex, IndexedFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, 'fixtures', 'rails-mini');

// Build a full index the way buildIndex() does — including the Rails synthetic
// (convention) edge pass — so we can prove an incremental patch preserves them.
async function buildFull(rootDir: string): Promise<CodebaseIndex> {
  const walked = await walkDirectory({ rootDir, excludes: [], includes: [] });
  const files: IndexedFile[] = [];
  for (const wf of walked) {
    const id = buildFileId(wf.relativePath);
    const parsed = await parseFile(wf.absolutePath, wf.language, id);
    if (!parsed) continue;
    files.push({
      ...baseIndexedFile(id, wf.absolutePath, wf.relativePath, wf.language, parsed),
      domainMap: buildFileDomains(wf.relativePath, parsed.exports),
      importedByCount: 0,
      transitiveImportedByCount: 0,
      isBarrel: false,
      isTestFile: isTestPath(wf.relativePath),
    });
  }
  const { edges } = await resolveImports(files, rootDir);
  const idSet = new Set(files.map(f => f.id));
  await addRailsSyntheticEdges(files, edges, idSet, rootDir);
  const { outEdges, inEdges } = buildGraph(files.map(f => f.id), edges);
  for (const f of files) f.importedByCount = inEdges.get(f.id)?.length ?? 0;
  const filesMap = new Map(files.map(f => [f.id, f]));
  const tokenDocFreq = new Map<string, number>();
  for (const f of files) for (const t of Object.keys(f.domainMap)) tokenDocFreq.set(t, (tokenDocFreq.get(t) ?? 0) + 1);
  return {
    rootDir, files: filesMap, edges, symbolEdges: buildSymbolEdges(files, outEdges, filesMap),
    outEdges, inEdges, tokenDocFreq, contentTokenPostings: buildContentTokenPostings(files),
    indexedAt: Date.now(), gitHead: '',
  };
}

const synthOut = (idx: CodebaseIndex, fileId: string): string[] =>
  idx.edges
    .filter(e => e.from === fileId && /^(const:|convention:)/.test(e.specifier))
    .map(e => `${e.specifier}->${e.to}`)
    .sort();

describe('patch preserves synthetic (convention) edges on an incremental edit', () => {
  it('re-creates a Rails convention file\'s synthetic edges after it is patched', async () => {
    const idx = await buildFull(root);

    // Pick any file that owns synthetic edges (rails-mini has a controller with
    // convention:views edges to its view folder).
    const target = [...idx.files.values()].find(f => synthOut(idx, f.id).length > 0);
    expect(target, 'rails-mini fixture should yield a file with synthetic edges').toBeTruthy();

    const before = synthOut(idx, target!.id);
    expect(before.length).toBeGreaterThan(0);

    const abs = target!.path;
    const original = fs.readFileSync(abs, 'utf8');
    try {
      // Mutate the file so the patch isn't skipped as a no-op (hash must change).
      fs.writeFileSync(abs, original + '\n# touched by freshness test\n');
      await patchIndex(idx, new Set([abs]), root);

      const after = synthOut(idx, target!.id);
      // The synthetic edges must survive the edit (regression guard for the
      // Phase-1 strip that used to delete them permanently).
      expect(after).toEqual(before);

      // outEdges graph map must be in sync with the edge list, not just idx.edges.
      const outTargets = new Set(idx.outEdges.get(target!.id) ?? []);
      for (const e of idx.edges.filter(x => x.from === target!.id)) {
        expect(outTargets.has(e.to)).toBe(true);
      }
    } finally {
      fs.writeFileSync(abs, original);
    }
  });
});
