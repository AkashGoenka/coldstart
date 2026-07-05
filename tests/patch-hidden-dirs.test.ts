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
import type { CodebaseIndex, IndexedFile } from '../src/types.js';

// Minimal real index over a temp dir — patchIndex stats and parses changed
// files for real, so fake in-memory paths won't do.
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

// Both batch producers (the watcher and reconcile's porcelain pass) can hand
// patchIndex paths the walker would never descend into — .coldstart/ notebook
// writes, .claude/settings.json, node_modules. The patch must mirror the
// walker's dir rules or the index diverges from a rebuild (C2 leak).
describe('patchIndex mirrors walker dir rules for hidden/excluded dirs', () => {
  let root: string;

  beforeAll(() => {
    // realpath: macOS tmpdir is a symlink (/var → /private/var) and the walker
    // relativizes resolved paths against rootDir.
    root = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'cs-hidden-')));
    fs.mkdirSync(join(root, 'src'), { recursive: true });
    fs.writeFileSync(join(root, 'src/a.ts'), 'export function alpha(): number { return 1; }\n');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects hidden-dir and excluded-dir files; keeps real files and root dotfiles', async () => {
    const idx = await buildSmall(root);
    expect(idx.files.has('src/a.ts')).toBe(true);

    for (const [dir, file] of [
      ['.coldstart/notebook/notes', 'leak.ts'],
      ['.claude', 'settings.ts'],
      ['node_modules/pkg', 'index.ts'],
    ] as const) {
      fs.mkdirSync(join(root, dir), { recursive: true });
      fs.writeFileSync(join(root, dir, file), 'export const leaked = 1;\n');
    }
    fs.writeFileSync(join(root, 'src/b.ts'), 'export function beta(): number { return 2; }\n');
    // Hidden FILES at the root are walked (only dir segments are filtered).
    fs.writeFileSync(join(root, '.rootdot.ts'), 'export const rootDot = 1;\n');

    await patchIndex(idx, new Set([
      join(root, '.coldstart/notebook/notes/leak.ts'),
      join(root, '.claude/settings.ts'),
      join(root, 'node_modules/pkg/index.ts'),
      join(root, 'src/b.ts'),
      join(root, '.rootdot.ts'),
    ]), root);

    const paths = [...idx.files.keys()];
    expect(paths.filter(p => p.includes('.coldstart') || p.includes('.claude') || p.includes('node_modules'))).toEqual([]);
    expect(idx.files.has('src/b.ts')).toBe(true);
    expect(idx.files.has('.rootdot.ts')).toBe(true);
  });
});
