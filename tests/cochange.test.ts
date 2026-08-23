/**
 * Co-change ("moves together") — derivation from real git history, the
 * parameter gates that keep it honest (min support, sweep commits, rename
 * following, index filtering), and how `gs` renders it.
 *
 * Derivation runs against a throwaway git repo built in a temp dir: the whole
 * point of this signal is that it comes from history, so a mocked git log
 * would test the parser and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveCoChange,
  coChangePartnersFor,
  saveCoChange,
  loadCoChange,
  CO_CHANGE_K,
  CO_CHANGE_MAX_COMMIT_FILES,
  type CoChangeIndex,
} from '../src/indexer/cochange.js';
import { handleGetStructure } from '../src/server/tools.js';
import type { CodebaseIndex, IndexedFile } from '../src/types.js';

// ---------------------------------------------------------------------------
// A throwaway git repo with a scripted history
// ---------------------------------------------------------------------------
let repo: string;

// Both helpers take the repo explicitly. They used to read a module-level
// `repo` that each scratch-repo test swapped and restored — and when the slow
// partner-cap test below overran its timeout, vitest moved on while that swap
// was still in place, so later tests silently ran against the wrong repo.
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function commit(cwd: string, files: Record<string, string>, message: string): void {
  for (const [path, body] of Object.entries(files)) {
    const full = join(cwd, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  git(cwd, 'add', '-A');
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', message, '--no-gpg-sign');
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'coldstart-cochange-'));
  git(repo, 'init', '-q', '-b', 'main');

  // a.py and b.py are edited together three times — the strong pair.
  for (let i = 0; i < 3; i++) {
    commit(repo, { 'a.py': `a${i}\n`, 'b.py': `b${i}\n` }, `pair ${i}`);
  }
  // a.py and c.py share exactly ONE commit — below min support.
  commit(repo, { 'a.py': 'a9\n', 'c.py': 'c0\n' }, 'weak pair');
  // a.py alone, so the "of N commits" denominator is not just the pair count.
  commit(repo, { 'a.py': 'a10\n' }, 'solo');
  // d.py only ever co-changes with an unindexed file.
  commit(repo, { 'd.py': 'd0\n', 'notes.md': 'x\n' }, 'with unindexed');
  commit(repo, { 'd.py': 'd1\n', 'notes.md': 'y\n' }, 'with unindexed again');
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

const INDEXED = new Set(['a.py', 'b.py', 'c.py', 'd.py']);
const isIndexed = (p: string) => INDEXED.has(p);

describe('deriveCoChange', () => {
  it('pairs files edited in the same commits, with the shared count', async () => {
    const data = await deriveCoChange(repo, isIndexed, 'HEAD');
    expect(data).not.toBeNull();
    expect(data!.partners['a.py']).toEqual([['b.py', 3]]);
    expect(data!.partners['b.py']).toEqual([['a.py', 3]]);
  });

  it('drops a pair with only one shared commit (min support)', async () => {
    const data = await deriveCoChange(repo, isIndexed, 'HEAD');
    const partners = (data!.partners['a.py'] ?? []).map(([p]) => p);
    expect(partners).not.toContain('c.py');
    expect(data!.partners['c.py']).toBeUndefined();
  });

  it('counts every commit touching a file as the denominator, not just paired ones', async () => {
    const data = await deriveCoChange(repo, isIndexed, 'HEAD');
    // 3 paired + 1 weak-pair + 1 solo
    expect(data!.touched['a.py']).toBe(5);
  });

  it('ignores files the index does not know', async () => {
    const data = await deriveCoChange(repo, isIndexed, 'HEAD');
    // d.py only ever changed alongside notes.md, which is not indexed.
    expect(data!.partners['d.py']).toBeUndefined();
    expect(Object.keys(data!.partners)).not.toContain('notes.md');
  });

  it('records the head it was taken at and how much history it saw', async () => {
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    const data = await deriveCoChange(repo, isIndexed, head);
    expect(data!.head).toBe(head);
    expect(data!.commitsScanned).toBe(7);
  });

  it('returns null outside a git repo instead of throwing', async () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'coldstart-nogit-'));
    try {
      expect(await deriveCoChange(notRepo, isIndexed, '')).toBeNull();
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });

  it('follows renames so pairs point at paths that still exist', async () => {
    const renamed = mkdtempSync(join(tmpdir(), 'coldstart-rename-'));
    try {
      git(renamed, 'init', '-q', '-b', 'main');
      for (let i = 0; i < 3; i++) {
        commit(renamed, { 'old.py': `o${i}\n`, 'peer.py': `p${i}\n` }, `c${i}`);
      }
      git(renamed, 'mv', 'old.py', 'new.py');
      git(renamed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'move', '--no-gpg-sign');
      const data = await deriveCoChange(renamed, (p) => p === 'new.py' || p === 'peer.py', 'HEAD');
      // Every historical commit is attributed to the CURRENT path.
      expect(data!.partners['new.py']).toEqual([['peer.py', 3]]);
      expect(data!.partners['old.py']).toBeUndefined();
    } finally {
      rmSync(renamed, { recursive: true, force: true });
    }
  });

  it('skips sweep commits that touch more files than the cap', async () => {
    const sweep = mkdtempSync(join(tmpdir(), 'coldstart-sweep-'));
    try {
      git(sweep, 'init', '-q', '-b', 'main');
      const wide: Record<string, string> = {};
      for (let i = 0; i < CO_CHANGE_MAX_COMMIT_FILES + 5; i++) wide[`f${i}.py`] = 'v0\n';
      // Two identical repo-wide sweeps: enough shared commits to clear min
      // support, so only the cap can keep these out.
      commit(sweep, wide, 'sweep 1');
      for (const k of Object.keys(wide)) wide[k] = 'v1\n';
      commit(sweep, wide, 'sweep 2');
      const data = await deriveCoChange(sweep, () => true, 'HEAD');
      expect(Object.keys(data!.partners)).toHaveLength(0);
      // The files were still SEEN — only the pairing was skipped.
      expect(data!.commitsScanned).toBe(2);
    } finally {
      rmSync(sweep, { recursive: true, force: true });
    }
  });

  it('caps stored partners at K, strongest first', async () => {
    const many = mkdtempSync(join(tmpdir(), 'coldstart-manyk-'));
    try {
      git(many, 'init', '-q', '-b', 'main');
      // hub.py pairs with p0..p11; p0 shares the most commits, p11 the fewest.
      for (let i = 0; i < CO_CHANGE_K + 4; i++) {
        for (let r = 0; r <= CO_CHANGE_K + 4 - i; r++) {
          commit(many, { 'hub.py': `h${i}-${r}\n`, [`p${i}.py`]: `v${r}\n` }, `c${i}-${r}`);
        }
      }
      const data = await deriveCoChange(many, () => true, 'HEAD');
      const partners = data!.partners['hub.py'];
      expect(partners).toHaveLength(CO_CHANGE_K);
      expect(partners[0][0]).toBe('p0.py');
      // Sorted strictly descending by shared-commit count.
      for (let i = 1; i < partners.length; i++) {
        expect(partners[i][1]).toBeLessThanOrEqual(partners[i - 1][1]);
      }
    } finally {
      rmSync(many, { recursive: true, force: true });
    }
    // ~90 commits, two git processes each: comfortably over the 5s default on a
    // loaded machine, which is what made this suite flaky.
  }, 60_000);
});

describe('saveCoChange / loadCoChange', () => {
  it('round-trips through the sidecar', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'coldstart-cc-cache-'));
    try {
      const data = (await deriveCoChange(repo, isIndexed, 'abc'))!;
      await saveCoChange(repo, data, cacheDir);
      const back = loadCoChange(repo, cacheDir);
      expect(back!.partners['a.py']).toEqual([['b.py', 3]]);
      expect(back!.head).toBe('abc');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('returns null for a missing sidecar rather than throwing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'coldstart-cc-empty-'));
    try {
      expect(loadCoChange(repo, empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('rejects a sidecar written by a different version', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'coldstart-cc-ver-'));
    try {
      const data = (await deriveCoChange(repo, isIndexed, 'abc'))!;
      await saveCoChange(repo, { ...data, v: 99 as unknown as CoChangeIndex['v'] }, cacheDir);
      expect(loadCoChange(repo, cacheDir)).toBeNull();
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('coChangePartnersFor', () => {
  const data: CoChangeIndex = {
    v: 1, builtAt: 0, head: '', commitsScanned: 100,
    partners: { 'a.py': [['b.py', 9], ['c.py', 5], ['d.py', 4], ['e.py', 2]] },
    touched: { 'a.py': 12 },
  };

  it('returns partners strongest-first with the file\'s own commit count', () => {
    const out = coChangePartnersFor(data, 'a.py', new Set(), 3);
    expect(out.map(p => p.path)).toEqual(['b.py', 'c.py', 'd.py']);
    expect(out[0]).toEqual({ path: 'b.py', shared: 9, outOf: 12 });
  });

  it('skips excluded files and backfills from further down the list', () => {
    const out = coChangePartnersFor(data, 'a.py', new Set(['b.py', 'c.py']), 3);
    expect(out.map(p => p.path)).toEqual(['d.py', 'e.py']);
  });

  it('is empty for an unknown file and for absent data', () => {
    expect(coChangePartnersFor(data, 'zz.py', new Set())).toEqual([]);
    expect(coChangePartnersFor(null, 'a.py', new Set())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rendering inside gs
// ---------------------------------------------------------------------------
function makeFile(id: string): IndexedFile {
  return {
    id, path: '/nonexistent/' + id, relativePath: id, language: 'python',
    domainMap: {}, exports: [], hasDefaultExport: false, imports: [], hash: 'h',
    lineCount: 10, tokenEstimate: 10, importedByCount: 0, transitiveImportedByCount: 0,
    isBarrel: false, isTestFile: false, symbols: [],
  };
}

function makeIndex(ids: string[], edges: Array<{ from: string; to: string }> = []): CodebaseIndex {
  const files = new Map(ids.map(id => [id, makeFile(id)]));
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();
  for (const id of ids) { outEdges.set(id, []); inEdges.set(id, []); }
  for (const e of edges) { outEdges.get(e.from)!.push(e.to); inEdges.get(e.to)!.push(e.from); }
  return {
    rootDir: '/', files, edges: edges as CodebaseIndex['edges'], symbolEdges: [],
    outEdges, inEdges, tokenDocFreq: new Map(), contentTokenPostings: new Map(),
    indexedAt: Date.now(), gitHead: '',
  };
}

const gsText = (r: object) => (r as { __rawText: string }).__rawText;

describe('gs rendering', () => {
  const data: CoChangeIndex = {
    v: 1, builtAt: 0, head: '', commitsScanned: 100,
    partners: { 'a.py': [['b.py', 14], ['imported.py', 9], ['c.py', 4]] },
    touched: { 'a.py': 17 },
  };

  it('renders partners with their evidence and a not-a-dependency label', () => {
    const out = gsText(handleGetStructure(makeIndex(['a.py', 'b.py', 'c.py']), { file_path: 'a.py' }, data));
    expect(out).toContain('Moves together');
    expect(out).toContain('NOT an import or call edge');
    expect(out).toContain("b.py — changed together in 14 of this file's 17 commits");
  });

  it('omits the section entirely when no sidecar exists', () => {
    const out = gsText(handleGetStructure(makeIndex(['a.py', 'b.py']), { file_path: 'a.py' }, null));
    expect(out).not.toContain('Moves together');
  });

  it('omits the section for a file with no partners', () => {
    const out = gsText(handleGetStructure(makeIndex(['a.py', 'z.py']), { file_path: 'z.py' }, data));
    expect(out).not.toContain('Moves together');
  });

  it('does not repeat a file already listed as an import', () => {
    const index = makeIndex(['a.py', 'b.py', 'imported.py', 'c.py'], [{ from: 'a.py', to: 'imported.py' }]);
    const out = gsText(handleGetStructure(index, { file_path: 'a.py' }, data));
    const section = out.slice(out.indexOf('Moves together'));
    expect(section).not.toContain('imported.py');
    // …and the freed slot goes to the next-strongest partner.
    expect(section).toContain('c.py');
  });

  it('does not repeat a file already listed as an importer', () => {
    const index = makeIndex(['a.py', 'b.py', 'imported.py', 'c.py'], [{ from: 'imported.py', to: 'a.py' }]);
    const out = gsText(handleGetStructure(index, { file_path: 'a.py' }, data));
    const section = out.slice(out.indexOf('Moves together'));
    expect(section).not.toContain('imported.py');
  });

  // It used to be full-view-only, and the first real session that could have
  // used it asked for `--view symbols` on a god-file — so the channel was
  // unreachable at exactly the moment it was wanted. A narrow view means "less
  // of this file", not "hide which OTHER file an edit here forgets".
  it('renders in every narrowed view, not just full', () => {
    for (const view of ['symbols', 'imports', 'importers', 'callers'] as const) {
      const out = gsText(handleGetStructure(makeIndex(['a.py', 'b.py']), { file_path: 'a.py', view }, data));
      expect(out, `view=${view}`).toContain('Moves together');
      expect(out, `view=${view}`).toContain("b.py — changed together in 14 of this file's 17 commits");
    }
  });

  // The heading claims these pairs are NOT an import edge, so the exclusion has
  // to come from the import graph itself rather than from whichever lists the
  // current view happens to print. In `--view symbols` nothing populates the
  // imports/importers lists, so a graph-scoped exclusion is the only thing
  // keeping a plain importer from being printed under a false heading.
  it('still excludes graph neighbours in a view that lists neither imports nor importers', () => {
    for (const edge of [{ from: 'a.py', to: 'imported.py' }, { from: 'imported.py', to: 'a.py' }]) {
      const index = makeIndex(['a.py', 'b.py', 'imported.py', 'c.py'], [edge]);
      const out = gsText(handleGetStructure(index, { file_path: 'a.py', view: 'symbols' }, data));
      const section = out.slice(out.indexOf('Moves together'));
      expect(section, JSON.stringify(edge)).not.toContain('imported.py');
      expect(section, JSON.stringify(edge)).toContain('c.py');
    }
  });
});
