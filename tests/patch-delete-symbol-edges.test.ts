import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { walkDirectory } from '../src/indexer/walker.js';
import { parseFile, buildFileId } from '../src/indexer/parser.js';
import { resolveImports } from '../src/indexer/resolvers/index.js';
import { buildGraph } from '../src/indexer/graph.js';
import { buildFileDomains, isTestPath } from '../src/indexer/tokenize.js';
import { buildContentTokenPostings } from '../src/indexer/content-tokens.js';
import { buildSymbolEdges } from '../src/indexer/symbol-edges.js';
import { baseIndexedFile } from '../src/indexer/indexed-file.js';
import { patchIndex } from '../src/indexer/patch.js';
import { lintIndexInvariants } from '../src/indexer/invariants.js';
import type { CodebaseIndex, IndexedFile } from '../src/types.js';

async function buildSmall(rootDir: string): Promise<CodebaseIndex> {
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

// Deleting a file that OTHER files call must also prune the symbolEdges
// pointing into it. Phase 1 only strips edges from changed files — the
// callers aren't in the change set — and a dangling se.to fails the
// invariant lint, turning every delete of a referenced file into a full
// rebuild (observed live in the 2.0 write/edit/search E2E, W4).
describe('patchIndex prunes symbolEdges into a deleted file', () => {
  let root: string;

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'cs-delsym-')));
    fs.mkdirSync(join(root, 'src'), { recursive: true });
    fs.writeFileSync(join(root, 'src/callee.ts'), 'export function calleeFn(): number { return 41; }\n');
    fs.writeFileSync(
      join(root, 'src/caller.ts'),
      "import { calleeFn } from './callee.js';\nexport function callerFn(): number { return calleeFn() + 1; }\n",
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('delete of a called file leaves no dangling se.to and passes the lint', async () => {
    const idx = await buildSmall(root);
    expect(idx.symbolEdges.some(se => se.to.startsWith('src/callee.ts#'))).toBe(true);

    fs.rmSync(join(root, 'src/callee.ts'));
    await patchIndex(idx, new Set([join(root, 'src/callee.ts')]), root);

    expect(idx.files.has('src/callee.ts')).toBe(false);
    const dangling = idx.symbolEdges.filter(
      se => se.to === 'src/callee.ts' || se.to.startsWith('src/callee.ts#'),
    );
    expect(dangling).toEqual([]);
    expect(lintIndexInvariants(idx)).toEqual([]);
  });
});
