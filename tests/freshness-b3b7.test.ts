import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sep } from 'node:path';

import { reconcileChanges } from '../src/indexer/reconcile.js';
import { lintIndexInvariants } from '../src/indexer/invariants.js';
import {
  updateKeeperState, readKeeperState, appendRepairLog, readRepairTail,
  keeperStatePath, repairLogPath,
} from '../src/keeper-state.js';
import { patchThreshold } from '../src/constants.js';
import {
  waitForKeeperCache, waitForCacheAdvance,
} from '../src/keeper.js';
import {
  saveCachedIndex, loadCachedIndex, getCacheDir,
} from '../src/cache/disk-cache.js';
import type { CodebaseIndex, IndexedFile, Edge, SymbolEdge } from '../src/types.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helper: Fake index builder (minimal but realistic)
// ---------------------------------------------------------------------------

function makeFile(
  id: string,
  over: Partial<IndexedFile> = {},
): IndexedFile {
  return {
    id,
    path: `/repo${sep}${id}`,
    relativePath: id,
    language: 'typescript',
    domainMap: { test: { filename: 1, path: 0, symbol: 0 } },
    exports: ['Test'],
    hasDefaultExport: true,
    imports: [],
    hash: 'abc123',
    lineCount: 10,
    tokenEstimate: 50,
    importedByCount: 0,
    transitiveImportedByCount: 0,
    isBarrel: false,
    isTestFile: false,
    symbols: [
      {
        id: `${id}#Test`,
        name: 'Test',
        kind: 'class',
        startLine: 1,
        endLine: 10,
        isExported: true,
        calls: [],
        implementsNames: [],
      },
    ],
    mtimeMs: 1000000000,
    sizeBytes: 500,
    ...over,
  };
}

function makeIndex(rootDir: string, files: string[] = []): CodebaseIndex {
  const fileMap = new Map<string, IndexedFile>();
  const fileList = files.length > 0 ? files : ['src/a.ts', 'src/b.ts'];

  for (const id of fileList) {
    fileMap.set(id, makeFile(id, { path: path.join(rootDir, id) }));
  }

  return {
    rootDir,
    files: fileMap,
    edges: [],
    symbolEdges: [],
    outEdges: new Map(),
    inEdges: new Map(),
    tokenDocFreq: new Map(),
    contentTokenPostings: new Map(),
    indexedAt: 1700000000000,
    gitHead: 'abc123def456',
  };
}

// ---------------------------------------------------------------------------
// Tests: reconcile.ts
// ---------------------------------------------------------------------------

describe('reconcile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-reconcile-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('matching fingerprints detects no stale files in stat walk', async () => {
    // Create a file, stat it, then use those exact stats as fingerprints.
    // This tests that isStale returns false when stats match.
    const aPath = path.join(testDir, 'src/a.ts');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, 'content');

    const aStat = fs.statSync(aPath);

    // Create index with this file
    const index = makeIndex(testDir, ['src/a.ts']);
    index.files.get('src/a.ts')!.mtimeMs = aStat.mtimeMs;
    index.files.get('src/a.ts')!.sizeBytes = aStat.size;

    // In git repo, this avoids triggering fs-walk
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testDir, stdio: 'pipe' });
    execSync('git add .', { cwd: testDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: testDir, stdio: 'pipe' });

    const head = execSync('git rev-parse HEAD', { cwd: testDir, encoding: 'utf-8' }).trim();
    index.gitHead = head;

    const result = await reconcileChanges(index, testDir);
    expect(result).not.toBeNull();
    // Since we're on HEAD with no changes, there should be no stale files and no new files
    expect(result!.reason.includes('git')).toBe(true);
  });

  it('edited file (mtime/size differ) → in changed', async () => {
    const aPath = path.join(testDir, 'src/a.ts');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, 'original');

    const stat1 = fs.statSync(aPath);

    // Wait a bit to ensure mtime differs, then modify
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(aPath, 'modified content with different size');

    const index = makeIndex(testDir, ['src/a.ts']);
    index.files.get('src/a.ts')!.mtimeMs = stat1.mtimeMs;
    index.files.get('src/a.ts')!.sizeBytes = stat1.size;

    const result = await reconcileChanges(index, testDir);
    expect(result).not.toBeNull();
    expect(result!.changed.size).toBeGreaterThan(0);
    expect(result!.changed.has(aPath)).toBe(true);
  });

  it('deleted file → in changed', async () => {
    const aPath = path.join(testDir, 'src/a.ts');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, 'content');

    const stat1 = fs.statSync(aPath);
    fs.rmSync(aPath);

    const index = makeIndex(testDir, ['src/a.ts']);
    index.files.get('src/a.ts')!.mtimeMs = stat1.mtimeMs;
    index.files.get('src/a.ts')!.sizeBytes = stat1.size;

    const result = await reconcileChanges(index, testDir);
    expect(result).not.toBeNull();
    expect(result!.changed.has(aPath)).toBe(true);
  });

  it('new untracked file in git repo → in changed, reason contains "git"', async () => {
    // Set up a git repo
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testDir, stdio: 'pipe' });

    // Commit an initial state
    const aPath = path.join(testDir, 'src/a.ts');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, 'original');
    execSync('git add .', { cwd: testDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: testDir, stdio: 'pipe' });

    const head1 = execSync('git rev-parse HEAD', { cwd: testDir, encoding: 'utf-8' }).trim();

    // Create a new file without committing
    const bPath = path.join(testDir, 'src/b.ts');
    fs.writeFileSync(bPath, 'new file');

    const index = makeIndex(testDir, ['src/a.ts']);
    index.gitHead = head1;

    const result = await reconcileChanges(index, testDir);
    expect(result).not.toBeNull();
    expect(result!.changed.has(bPath)).toBe(true);
    expect(result!.reason.includes('git')).toBe(true);
  });

  it('non-git dir uses fs-walk to discover new files', async () => {
    // testDir is not a git repo — reconcile should fall back to fs-walk.
    // This test verifies that fs-walk is used (not git paths).
    const aPath = path.join(testDir, 'src/a.ts');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, 'content');

    const aStat = fs.statSync(aPath);

    // Create index with file 'a' and matching fingerprints
    const index = makeIndex(testDir, ['src/a.ts']);
    index.files.get('src/a.ts')!.mtimeMs = aStat.mtimeMs;
    index.files.get('src/a.ts')!.sizeBytes = aStat.size;

    // testDir is not a git repo, so result should use fs-walk as source
    const result = await reconcileChanges(index, testDir);
    expect(result).not.toBeNull();
    // In non-git, it uses fs-walk path
    expect(result!.reason.includes('fs-walk')).toBe(true);
  });

  it('file with undefined mtimeMs/sizeBytes → treated as changed', async () => {
    const aPath = path.join(testDir, 'src/a.ts');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, 'content');

    const index = makeIndex(testDir, ['src/a.ts']);
    // Deliberately leave mtimeMs/sizeBytes undefined
    index.files.get('src/a.ts')!.mtimeMs = undefined;
    index.files.get('src/a.ts')!.sizeBytes = undefined;

    const result = await reconcileChanges(index, testDir);
    expect(result).not.toBeNull();
    expect(result!.changed.has(aPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: invariants.ts
// ---------------------------------------------------------------------------

describe('invariants', () => {
  it('consistent index → []', () => {
    const rootDir = '/tmp/test';
    const a = makeFile('src/a.ts', { path: path.join(rootDir, 'src/a.ts') });
    const b = makeFile('src/b.ts', { path: path.join(rootDir, 'src/b.ts') });

    const index: CodebaseIndex = {
      rootDir,
      files: new Map([['src/a.ts', a], ['src/b.ts', b]]),
      edges: [{ from: 'src/a.ts', to: 'src/b.ts', type: 'import', specifier: './b' }],
      symbolEdges: [],
      outEdges: new Map([['src/a.ts', ['src/b.ts']]]),
      inEdges: new Map([['src/b.ts', ['src/a.ts']]]),
      tokenDocFreq: new Map(),
      contentTokenPostings: new Map(),
      indexedAt: Date.now(),
      gitHead: 'abc',
    };

    const problems = lintIndexInvariants(index);
    expect(problems).toEqual([]);
  });

  it('edge pointing at missing file → flagged', () => {
    const rootDir = '/tmp/test';
    const a = makeFile('src/a.ts', { path: path.join(rootDir, 'src/a.ts') });

    const index: CodebaseIndex = {
      rootDir,
      files: new Map([['src/a.ts', a]]),
      edges: [{ from: 'src/a.ts', to: 'src/missing.ts', type: 'import', specifier: './missing' }],
      symbolEdges: [],
      outEdges: new Map(),
      inEdges: new Map(),
      tokenDocFreq: new Map(),
      contentTokenPostings: new Map(),
      indexedAt: Date.now(),
      gitHead: 'abc',
    };

    const problems = lintIndexInvariants(index);
    expect(problems.some((p) => p.includes('edge.to not in files'))).toBe(true);
  });

  it('outEdges target missing → flagged', () => {
    const rootDir = '/tmp/test';
    const a = makeFile('src/a.ts', { path: path.join(rootDir, 'src/a.ts') });

    const index: CodebaseIndex = {
      rootDir,
      files: new Map([['src/a.ts', a]]),
      edges: [],
      symbolEdges: [],
      outEdges: new Map([['src/a.ts', ['src/missing.ts']]]),
      inEdges: new Map(),
      tokenDocFreq: new Map(),
      contentTokenPostings: new Map(),
      indexedAt: Date.now(),
      gitHead: 'abc',
    };

    const problems = lintIndexInvariants(index);
    expect(problems.some((p) => p.includes('outEdges target not in files'))).toBe(true);
  });

  it('inEdges source missing → flagged', () => {
    const rootDir = '/tmp/test';
    const b = makeFile('src/b.ts', { path: path.join(rootDir, 'src/b.ts') });

    const index: CodebaseIndex = {
      rootDir,
      files: new Map([['src/b.ts', b]]),
      edges: [],
      symbolEdges: [],
      outEdges: new Map(),
      inEdges: new Map([['src/b.ts', ['src/missing.ts']]]),
      tokenDocFreq: new Map(),
      contentTokenPostings: new Map(),
      indexedAt: Date.now(),
      gitHead: 'abc',
    };

    const problems = lintIndexInvariants(index);
    expect(problems.some((p) => p.includes('inEdges source not in files'))).toBe(true);
  });

  it('adjacency not mirrored (out has A→B but in lacks it) → flagged', () => {
    const rootDir = '/tmp/test';
    const a = makeFile('src/a.ts', { path: path.join(rootDir, 'src/a.ts') });
    const b = makeFile('src/b.ts', { path: path.join(rootDir, 'src/b.ts') });

    const index: CodebaseIndex = {
      rootDir,
      files: new Map([
        ['src/a.ts', a],
        ['src/b.ts', b],
      ]),
      edges: [],
      symbolEdges: [],
      outEdges: new Map([['src/a.ts', ['src/b.ts']]]),
      inEdges: new Map([['src/b.ts', []]]), // missing src/a.ts
      tokenDocFreq: new Map(),
      contentTokenPostings: new Map(),
      indexedAt: Date.now(),
      gitHead: 'abc',
    };

    const problems = lintIndexInvariants(index);
    expect(problems.some((p) => p.includes('adjacency not mirrored'))).toBe(true);
  });

  it('symbolEdge with missing file → flagged', () => {
    const rootDir = '/tmp/test';
    const a = makeFile('src/a.ts', { path: path.join(rootDir, 'src/a.ts') });

    const index: CodebaseIndex = {
      rootDir,
      files: new Map([['src/a.ts', a]]),
      edges: [],
      symbolEdges: [
        {
          from: 'src/a.ts#Test',
          to: 'src/missing.ts#Other',
          type: 'calls',
          line: 5,
        },
      ],
      outEdges: new Map(),
      inEdges: new Map(),
      tokenDocFreq: new Map(),
      contentTokenPostings: new Map(),
      indexedAt: Date.now(),
      gitHead: 'abc',
    };

    const problems = lintIndexInvariants(index);
    expect(problems.some((p) => p.includes('symbolEdge.to file not in files'))).toBe(true);
  });

  it('contentToken posting referencing dead file → flagged', () => {
    const rootDir = '/tmp/test';
    const a = makeFile('src/a.ts', { path: path.join(rootDir, 'src/a.ts') });

    const index: CodebaseIndex = {
      rootDir,
      files: new Map([['src/a.ts', a]]),
      edges: [],
      symbolEdges: [],
      outEdges: new Map(),
      inEdges: new Map(),
      tokenDocFreq: new Map(),
      contentTokenPostings: new Map([['deadtoken', ['src/missing.ts']]]),
      indexedAt: Date.now(),
      gitHead: 'abc',
    };

    const problems = lintIndexInvariants(index);
    expect(problems.some((p) => p.includes('posting references dead file'))).toBe(true);
  });

  it('respects sampleLimit', () => {
    const rootDir = '/tmp/test';
    const files = new Map<string, IndexedFile>();
    for (let i = 0; i < 10; i++) {
      files.set(`src/f${i}.ts`, makeFile(`src/f${i}.ts`, {
        path: path.join(rootDir, `src/f${i}.ts`),
      }));
    }

    // Create many broken edges
    const outEdges = new Map<string, string[]>();
    for (let i = 0; i < 10; i++) {
      outEdges.set(`src/f${i}.ts`, [`src/missing-${i}.ts`]);
    }

    const index: CodebaseIndex = {
      rootDir,
      files,
      edges: [],
      symbolEdges: [],
      outEdges,
      inEdges: new Map(),
      tokenDocFreq: new Map(),
      contentTokenPostings: new Map(),
      indexedAt: Date.now(),
      gitHead: 'abc',
    };

    const problems = lintIndexInvariants(index, 3);
    expect(problems.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: keeper-state.ts
// ---------------------------------------------------------------------------

describe('keeper-state', () => {
  let cacheDir: string;
  const testRoot = '/some/test/root';

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-keeper-state-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('updateKeeperState/readKeeperState round-trip', async () => {
    await updateKeeperState(testRoot, {
      lastReconcile: { at: 1000, detail: 'reconcile done' },
    }, cacheDir);

    const state = readKeeperState(testRoot, cacheDir);
    expect(state).not.toBeNull();
    expect(state!.lastReconcile?.detail).toBe('reconcile done');
    expect(typeof state!.pid).toBe('number');
  });

  it('missing state file → readKeeperState returns null', () => {
    const state = readKeeperState('/nonexistent/root', cacheDir);
    expect(state).toBeNull();
  });

  it('corrupt JSON state file → readKeeperState returns null', async () => {
    const statePath = keeperStatePath(testRoot, cacheDir);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{broken');

    const state = readKeeperState(testRoot, cacheDir);
    expect(state).toBeNull();
  });

  it('appendRepairLog + readRepairTail: events in order, detail truncated to 500 chars', async () => {
    const longDetail = 'x'.repeat(600);

    await appendRepairLog(testRoot, 'patch-failed', longDetail, cacheDir);
    await appendRepairLog(testRoot, 'rebuild-failed', 'short', cacheDir);
    await appendRepairLog(testRoot, 'invariant-violation', 'another', cacheDir);

    const tail = readRepairTail(testRoot, 3, cacheDir);
    expect(tail.length).toBe(3);
    expect(tail[0].event).toBe('patch-failed');
    expect(tail[0].detail.length).toBe(500);
    expect(tail[1].event).toBe('rebuild-failed');
    expect(tail[2].event).toBe('invariant-violation');
  });

  it('readRepairTail: corrupt line in middle is skipped', async () => {
    const repairPath = repairLogPath(testRoot, cacheDir);
    fs.mkdirSync(path.dirname(repairPath), { recursive: true });

    // Write directly
    fs.writeFileSync(repairPath, '');
    fs.appendFileSync(repairPath, JSON.stringify({ at: 1000, event: 'patch-failed', detail: 'first' }) + '\n');
    fs.appendFileSync(repairPath, '{broken json\n');
    fs.appendFileSync(repairPath, JSON.stringify({ at: 2000, event: 'rebuild-failed', detail: 'second' }) + '\n');

    const tail = readRepairTail(testRoot, 3, cacheDir);
    // Should skip the corrupt line and return the valid ones
    expect(tail.length).toBe(2);
    expect(tail[0].detail).toBe('first');
    expect(tail[1].detail).toBe('second');
  });

  it('readRepairTail with empty file → []', async () => {
    const tail = readRepairTail(testRoot, 3, cacheDir);
    expect(tail).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: constants.ts — patchThreshold
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('patchThreshold: floor 30 for small counts', () => {
    expect(patchThreshold(10)).toBe(30);
    expect(patchThreshold(100)).toBe(30);
    expect(patchThreshold(150)).toBe(30); // At boundary (ceil(30) = 30)
    expect(patchThreshold(151)).toBeGreaterThan(30); // Above boundary
  });

  it('patchThreshold: ceil(0.2*n) above floor', () => {
    const count = 16186;
    const result = patchThreshold(count);
    expect(result).toBe(Math.ceil(0.2 * count));
    expect(result).toBe(3238);
  });

  it('patchThreshold: boundary at 150', () => {
    expect(patchThreshold(150)).toBe(Math.ceil(0.2 * 150)); // = 30
    expect(patchThreshold(151)).toBe(Math.ceil(0.2 * 151)); // = 31
  });
});

// ---------------------------------------------------------------------------
// Tests: keeper.ts — waitForKeeperCache + waitForCacheAdvance
// ---------------------------------------------------------------------------

describe('keeper waits', () => {
  let cacheDir: string;
  let testRoot: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-keeper-wait-'));
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-keeper-root-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('waitForKeeperCache: meta.json exists immediately → "ready"', async () => {
    const metaDir = getCacheDir(testRoot, cacheDir);
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, 'meta.json'), '{}');

    const result = await waitForKeeperCache(testRoot, cacheDir, 5000);
    expect(result).toBe('ready');
  });

  it('waitForKeeperCache: no keeper + no meta after grace → "no-keeper"', async () => {
    // Don't create meta or lock, wait a bit
    const result = await waitForKeeperCache(testRoot, cacheDir, 4000);
    expect(result).toBe('no-keeper');
  });

  it('waitForCacheAdvance: meta.json mtime advances → true', async () => {
    const metaDir = getCacheDir(testRoot, cacheDir);
    fs.mkdirSync(metaDir, { recursive: true });

    const metaPath = path.join(metaDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({ version: '18.0.0' }));

    // Schedule a rewrite ~300ms in
    const promise = waitForCacheAdvance(testRoot, cacheDir, 700);
    setTimeout(() => {
      fs.writeFileSync(metaPath, JSON.stringify({ version: '18.0.0', updated: true }));
    }, 300);

    const result = await promise;
    expect(result).toBe(true);
  });

  it('waitForCacheAdvance: nothing changes → false', async () => {
    const metaDir = getCacheDir(testRoot, cacheDir);
    fs.mkdirSync(metaDir, { recursive: true });
    const metaPath = path.join(metaDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({ version: '18.0.0' }));

    // Short timeout, no changes
    const result = await waitForCacheAdvance(testRoot, cacheDir, 600);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: disk-cache.ts — generation handling
// ---------------------------------------------------------------------------

describe('disk-cache generations', () => {
  let cacheDir: string;
  let testRoot: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-cache-gen-'));
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-gen-root-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('save → load roundtrip works', async () => {
    const index = makeIndex(testRoot);

    await saveCachedIndex(index, cacheDir);
    const loaded = await loadCachedIndex(testRoot, cacheDir, 'full');

    expect(loaded).not.toBeNull();
    expect(loaded!.rootDir).toBe(testRoot);
    expect(loaded!.files.size).toBe(2);
  });

  it('save twice → meta.gen increments, g1 files persist, g0 files gone after save #3', async () => {
    const index1 = makeIndex(testRoot);
    await saveCachedIndex(index1, cacheDir);

    const cdir = getCacheDir(testRoot, cacheDir);
    const meta1 = JSON.parse(fs.readFileSync(path.join(cdir, 'meta.json'), 'utf8'));
    expect(meta1.gen).toBe(1);

    const files1 = fs.readdirSync(cdir);
    const g1Files = files1.filter((f) => f.startsWith('g1-'));
    expect(g1Files.length).toBeGreaterThan(0);

    // Save again
    const index2 = makeIndex(testRoot);
    await saveCachedIndex(index2, cacheDir);

    const meta2 = JSON.parse(fs.readFileSync(path.join(cdir, 'meta.json'), 'utf8'));
    expect(meta2.gen).toBe(2);

    // g1 files should still exist
    const files2 = fs.readdirSync(cdir);
    expect(files2.filter((f) => f.startsWith('g1-')).length).toBeGreaterThan(0);

    // Save a third time
    const index3 = makeIndex(testRoot);
    await saveCachedIndex(index3, cacheDir);

    const meta3 = JSON.parse(fs.readFileSync(path.join(cdir, 'meta.json'), 'utf8'));
    expect(meta3.gen).toBe(3);

    // Now g1 should be swept
    const files3 = fs.readdirSync(cdir);
    expect(files3.filter((f) => f.startsWith('g1-')).length).toBe(0);
    expect(files3.filter((f) => f.startsWith('g2-')).length).toBeGreaterThan(0);
  });

  it('load after each save returns latest data', async () => {
    const index1 = makeIndex(testRoot, ['src/a.ts']);
    await saveCachedIndex(index1, cacheDir);

    const loaded1 = await loadCachedIndex(testRoot, cacheDir, 'full');
    expect(loaded1!.files.size).toBe(1);

    // Add another file and save again
    const index2 = makeIndex(testRoot, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
    await saveCachedIndex(index2, cacheDir);

    const loaded2 = await loadCachedIndex(testRoot, cacheDir, 'full');
    expect(loaded2!.files.size).toBe(3);
  });

  it('partial index refuses to save', async () => {
    const index = makeIndex(testRoot);
    index.profile = 'find'; // Mark as partial

    await expect(saveCachedIndex(index, cacheDir)).rejects.toThrow(
      /refusing to save a partial index/,
    );
  });
});
