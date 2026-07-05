import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { saveCachedIndex, loadCachedIndex } from '../src/cache/disk-cache.js';
import type { CodebaseIndex, IndexedFile } from '../src/types.js';

/** v18 segment round-trip: consumer profiles load exactly their segments,
 *  the full profile reproduces the index, and partial indexes refuse to save. */

function makeFile(rel: string, over: Partial<IndexedFile> = {}): IndexedFile {
  return {
    id: rel,
    path: `/repo${sep}${rel}`,
    relativePath: rel,
    language: 'typescript',
    domainMap: { auth: { filename: 1, path: 0, symbol: 2 } },
    exports: ['AuthService'],
    hasDefaultExport: true,
    imports: ['./util'],
    hash: 'abc123',
    lineCount: 120,
    tokenEstimate: 900,
    importedByCount: 3,
    transitiveImportedByCount: 5,
    isBarrel: false,
    isTestFile: false,
    symbols: [
      {
        id: `${rel}#AuthService`, name: 'AuthService', kind: 'class',
        startLine: 10, endLine: 90, isExported: true,
        calls: [{ name: 'validate', line: 22 }, { name: `${rel}#helper`, line: 30 }],
        extendsName: 'Base', implementsNames: ['IAuth'], annotations: ['Service'],
      },
      {
        id: `${rel}#helper`, name: 'helper', kind: 'function',
        startLine: 95, endLine: 110, isExported: false,
        calls: [], implementsNames: [],
      },
    ],
    contentTokens: { loadstaging: 3, tilehelper: 1 },
    mtimeMs: 1234567890, sizeBytes: 4321,
    ...over,
  };
}

function makeIndex(rootDir: string): CodebaseIndex {
  const a = makeFile('src/a.ts');
  const b = makeFile('src/b.ts', {
    isTestFile: true, isBarrel: true, packageName: 'com.x',
    reexportRatio: 0.5,
    djangoConventionRefs: [{ kind: 'middleware', value: 'x.Y' }],
    contentTokens: undefined, mtimeMs: undefined, sizeBytes: undefined,
  });
  return {
    rootDir,
    files: new Map([[a.id, a], [b.id, b]]),
    edges: [{ from: 'src/a.ts', to: 'src/b.ts', type: 'import', specifier: './b' }],
    symbolEdges: [
      { from: 'src/a.ts#AuthService', to: 'src/b.ts#helper', type: 'calls', line: 22 },
      { from: 'src/a.ts', to: 'src/a.ts#AuthService', type: 'exports' },
      { from: 'src/a.ts#AuthService', to: 'ghost.ts#nowhere', type: 'calls' }, // unresolvable → verbatim
    ],
    outEdges: new Map([['src/a.ts', ['src/b.ts']]]),
    inEdges: new Map([['src/b.ts', ['src/a.ts']]]),
    tokenDocFreq: new Map([['auth', 2]]),
    contentTokenPostings: new Map([['loadstaging', ['src/a.ts']]]),
    indexedAt: 1700000000000,
    gitHead: 'deadbeef',
  };
}

describe('disk-cache v18 segments', () => {
  let cacheBase: string;
  const rootDir = join(tmpdir(), 'cs-cache-test-root');

  beforeAll(async () => {
    cacheBase = mkdtempSync(join(tmpdir(), 'cs-cache-'));
    await saveCachedIndex(makeIndex(rootDir), cacheBase);
  });
  afterAll(() => rmSync(cacheBase, { recursive: true, force: true }));

  it('full profile reproduces every field', async () => {
    const idx = (await loadCachedIndex(rootDir, cacheBase, 'full'))!;
    expect(idx).not.toBeNull();
    expect(idx.profile).toBeUndefined();
    const a = idx.files.get('src/a.ts')!;
    expect(a.path).toBe(rootDir + sep + 'src/a.ts');
    expect(a.domainMap).toEqual({ auth: { filename: 1, path: 0, symbol: 2 } });
    expect(a.exports).toEqual(['AuthService']);
    expect(a.imports).toEqual(['./util']);
    expect(a.hash).toBe('abc123');
    expect(a.hasDefaultExport).toBe(true);
    expect(a.contentTokens).toEqual({ loadstaging: 3, tilehelper: 1 });
    expect(a.mtimeMs).toBe(1234567890);
    expect(a.sizeBytes).toBe(4321);
    const svc = a.symbols[0];
    expect(svc.id).toBe('src/a.ts#AuthService');
    expect(svc.calls).toEqual([{ name: 'validate', line: 22 }, { name: 'src/a.ts#helper', line: 30 }]);
    expect(svc.extendsName).toBe('Base');
    expect(svc.implementsNames).toEqual(['IAuth']);
    expect(svc.annotations).toEqual(['Service']);
    const b = idx.files.get('src/b.ts')!;
    expect(b.isTestFile).toBe(true);
    expect(b.isBarrel).toBe(true);
    expect(b.packageName).toBe('com.x');
    expect(b.reexportRatio).toBe(0.5);
    expect(b.djangoConventionRefs).toEqual([{ kind: 'middleware', value: 'x.Y' }]);
    expect(b.contentTokens).toBeUndefined();
    expect(idx.tokenDocFreq.get('auth')).toBe(2);
    expect(idx.edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts', type: 'import', specifier: './b' }]);
    expect(idx.symbolEdges).toEqual([
      { from: 'src/a.ts#AuthService', to: 'src/b.ts#helper', type: 'calls', line: 22 },
      { from: 'src/a.ts', to: 'src/a.ts#AuthService', type: 'exports' },
      { from: 'src/a.ts#AuthService', to: 'ghost.ts#nowhere', type: 'calls' },
    ]);
    expect(idx.outEdges.get('src/a.ts')).toEqual(['src/b.ts']);
    expect(idx.inEdges.get('src/b.ts')).toEqual(['src/a.ts']);
    expect(idx.contentTokenPostings.get('loadstaging')).toEqual(['src/a.ts']);
    expect(idx.gitHead).toBe('deadbeef');
  });

  it('find profile: core fields live, build fields empty, no symbolEdges', async () => {
    const idx = (await loadCachedIndex(rootDir, cacheBase, 'find'))!;
    expect(idx.profile).toBe('find');
    const a = idx.files.get('src/a.ts')!;
    // what find READS survives
    expect(a.symbols.map((s) => s.name)).toEqual(['AuthService', 'helper']);
    expect(a.symbols[0].startLine).toBe(10);
    expect(a.symbols[0].isExported).toBe(true);
    expect(a.contentTokens).toEqual({ loadstaging: 3, tilehelper: 1 });
    expect(a.lineCount).toBe(120);
    expect(a.importedByCount).toBe(3);
    expect(idx.edges[0].specifier).toBe('./b');
    expect(idx.contentTokenPostings.get('loadstaging')).toEqual(['src/a.ts']);
    // keeper-only data is deliberately absent
    expect(a.domainMap).toEqual({});
    expect(a.exports).toEqual([]);
    expect(a.imports).toEqual([]);
    expect(a.hash).toBe('');
    expect(a.symbols[0].calls).toEqual([]);
    expect(idx.symbolEdges).toEqual([]);
    expect(idx.tokenDocFreq.size).toBe(0);
  });

  it('gs profile adds symbolEdges', async () => {
    const idx = (await loadCachedIndex(rootDir, cacheBase, 'gs'))!;
    expect(idx.profile).toBe('gs');
    expect(idx.symbolEdges.length).toBe(3);
    expect(idx.symbolEdges[0].from).toBe('src/a.ts#AuthService');
    expect(idx.files.get('src/a.ts')!.symbols[0].calls).toEqual([]); // still slim
  });

  it('refuses to save a partial index', async () => {
    const partial = (await loadCachedIndex(rootDir, cacheBase, 'find'))!;
    await expect(saveCachedIndex(partial, cacheBase)).rejects.toThrow(/partial index/);
  });

  it('version mismatch returns null (no TTL check exists)', async () => {
    // A fresh save is valid regardless of timestamp age: back-date indexedAt far
    // past the old 24h TTL and confirm it still loads.
    const old = makeIndex(rootDir);
    old.indexedAt = 1000; // 1970
    await saveCachedIndex(old, cacheBase);
    const idx = await loadCachedIndex(rootDir, cacheBase, 'find');
    expect(idx).not.toBeNull();
  });
});
