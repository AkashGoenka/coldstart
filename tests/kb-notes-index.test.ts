import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildKbNotesIndex, saveKbNotesIndex, loadKbNotesIndex, kbNotesIndexPath, stampCoversTerms } from '../src/kb/notes-index.js';
import { appendRecord } from '../src/kb/raw-log.js';
import { kbLint } from '../src/kb/lint.js';
import type { CodebaseIndex } from '../src/types.js';

let root: string;
let cacheDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-kb-notes-'));
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-cache-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

/** Minimal index stub — just what buildKbNotesIndex and collectCoverage need. */
function fakeIndex(files: Record<string, string[]>): CodebaseIndex {
  const map = new Map<string, { path: string; symbols: { name: string }[] }>();
  for (const [rel, syms] of Object.entries(files)) {
    map.set(rel, { path: path.join(root, rel), symbols: syms.map((name) => ({ name })) });
  }
  return { rootDir: root, files: map } as unknown as CodebaseIndex;
}

function writeRepoFile(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('kb notes index', () => {
  it('save/load round-trip: buildKbNotesIndex → save → load returns deep-equal data', async () => {
    writeRepoFile('src/main.ts', 'export function main() {}\n');
    appendRecord(root, {
      id: 'main-file', type: 'file', op: 'put',
      summary: 'Entry point.',
      anchors: [{ path: 'src/main.ts' }],
    });

    const index = fakeIndex({ 'src/main.ts': ['main'] });
    const built = await buildKbNotesIndex(index, root);

    expect(built.v).toBe(1);
    expect(built.anchors).toEqual({ 'src/main.ts': ['main'] });
    expect(built.absence).toEqual({});
    expect(typeof built.builtAt).toBe('number');

    await saveKbNotesIndex(root, built, cacheDir);
    const loaded = loadKbNotesIndex(root, cacheDir);

    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(built);
  });

  it('loadKbNotesIndex returns null when file is absent, corrupt JSON, or wrong version', async () => {
    // File absent
    const missing = loadKbNotesIndex(root, cacheDir);
    expect(missing).toBeNull();

    // Corrupt JSON
    const corruptPath = kbNotesIndexPath(root, cacheDir);
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, '{broken json}');
    const corrupt = loadKbNotesIndex(root, cacheDir);
    expect(corrupt).toBeNull();

    // Wrong version
    const wrongVersion = { v: 999, builtAt: Date.now(), anchors: {}, absence: {} };
    fs.writeFileSync(corruptPath, JSON.stringify(wrongVersion));
    const wrong = loadKbNotesIndex(root, cacheDir);
    expect(wrong).toBeNull();
  });

  it('anchors inventory: unindexed file gets empty inventory; indexed file gets its symbol names', async () => {
    writeRepoFile('src/indexed.ts', 'export function foo() {}\nexport class Bar {}\n');
    writeRepoFile('src/unindexed.ts', 'nothing here\n');

    appendRecord(root, {
      id: 'indexed-note', type: 'file', op: 'put',
      summary: 'Has an index.',
      anchors: [{ path: 'src/indexed.ts' }],
    });
    appendRecord(root, {
      id: 'unindexed-note', type: 'file', op: 'put',
      summary: 'No index.',
      anchors: [{ path: 'src/unindexed.ts' }],
    });

    const index = fakeIndex({ 'src/indexed.ts': ['foo', 'Bar'] });
    const built = await buildKbNotesIndex(index, root);

    expect(built.anchors['src/indexed.ts']).toEqual(['foo', 'Bar']);
    expect(built.anchors['src/unindexed.ts']).toEqual([]);
  });

  it('absence stamps: terms appearing in repo get matches; globs filter matches; missing terms yield empty matches', async () => {
    writeRepoFile('src/has_term.ts', 'export const special_marker = true;\n');
    writeRepoFile('src/excluded.ts', 'export const special_marker = false;\n');
    writeRepoFile('src/clean.ts', 'nothing special here\n');

    appendRecord(root, {
      id: 'no-absence-anywhere', type: 'lesson', op: 'put', kind: 'absence',
      title: 'Term never appears',
      body: 'Checked everywhere.',
      scope: { terms: ['nonexistent_term'] },
    });

    appendRecord(root, {
      id: 'has-absence-unfiltered', type: 'lesson', op: 'put', kind: 'absence',
      title: 'special_marker is not defined',
      body: 'Search everywhere.',
      scope: { terms: ['special_marker'] },
    });

    appendRecord(root, {
      id: 'has-absence-filtered', type: 'lesson', op: 'put', kind: 'absence',
      title: 'special_marker is defined only in has_term.ts',
      body: 'Checked and filtered.',
      scope: { terms: ['special_marker'], globs: ['src/has_*'] },
    });

    const index = fakeIndex({
      'src/has_term.ts': [],
      'src/excluded.ts': [],
      'src/clean.ts': [],
    });
    const built = await buildKbNotesIndex(index, root);

    // Nonexistent term → no matches
    expect(built.absence['no-absence-anywhere']?.matches).toEqual([]);

    // Unfiltered term → both files where it appears
    const unfilteredMatches = built.absence['has-absence-unfiltered']?.matches ?? [];
    expect(unfilteredMatches.sort()).toEqual(['src/excluded.ts', 'src/has_term.ts']);

    // Filtered by glob → only has_term.ts
    expect(built.absence['has-absence-filtered']?.matches).toEqual(['src/has_term.ts']);

    // Verify the stamp records the terms
    expect(built.absence['has-absence-unfiltered']?.terms).toEqual(['special_marker']);
  });

  it('superseded/retracted absence notes get NO stamp', async () => {
    writeRepoFile('src/main.ts', 'export const feature_flag = false;\n');

    // Create an active absence note
    appendRecord(root, {
      id: 'active-absence', type: 'lesson', op: 'put', kind: 'absence',
      title: 'Feature flag undefined',
      body: 'Should be defined.',
      scope: { terms: ['feature_flag'] },
    });

    // Create and then supersede another absence note
    appendRecord(root, {
      id: 'superseded-absence', type: 'lesson', op: 'put', kind: 'absence',
      title: 'Old absence note',
      body: 'Will be superseded.',
      scope: { terms: ['feature_flag'] },
    });
    appendRecord(root, {
      id: 'superseded-absence', type: 'lesson', op: 'supersede', by: 'active-absence',
    });

    // Create and then retract another absence note
    appendRecord(root, {
      id: 'retracted-absence', type: 'lesson', op: 'put', kind: 'absence',
      title: 'Bad absence note',
      body: 'Will be retracted.',
      scope: { terms: ['feature_flag'] },
    });
    appendRecord(root, {
      id: 'retracted-absence', type: 'lesson', op: 'retract', target: { kind: 'note' },
    });

    const index = fakeIndex({ 'src/main.ts': [] });
    const built = await buildKbNotesIndex(index, root);

    // Only the active note gets a stamp
    expect(built.absence['active-absence']).toBeDefined();
    expect(built.absence['superseded-absence']).toBeUndefined();
    expect(built.absence['retracted-absence']).toBeUndefined();
  });

  it('kbLint absence-stale: absence with matches → finding; stale terms → no finding; no notes index → no finding', async () => {
    writeRepoFile('src/main.ts', 'export const rate_limit = 100;\n');

    appendRecord(root, {
      id: 'rate-limit-absence', type: 'lesson', op: 'put', kind: 'absence',
      title: 'Rate limiting is absent',
      body: 'Checked everywhere.',
      scope: { terms: ['rate_limit'] },
    });

    const index = fakeIndex({ 'src/main.ts': [] });
    const builtKb = await buildKbNotesIndex(index, root);

    // With a notes index whose stamp has matches → absence-stale finding
    const findings1 = await kbLint(root, builtKb);
    const staleFindings = findings1.filter((f) => f.check === 'absence-stale');
    expect(staleFindings).toHaveLength(1);
    expect(staleFindings[0].note).toBe('rate-limit-absence');
    expect(staleFindings[0].detail).toContain('src/main.ts');

    // Manually create a stamp with stale terms (different from scope.terms)
    const staleLintIndex = {
      ...builtKb,
      absence: {
        'rate-limit-absence': { terms: ['old_term'], matches: ['src/main.ts'], checkedAt: Date.now() },
      },
    };
    const findings2 = await kbLint(root, staleLintIndex);
    const staleFindings2 = findings2.filter((f) => f.check === 'absence-stale');
    expect(staleFindings2).toHaveLength(0);

    // Without a notes index → no absence-stale findings
    const findings3 = await kbLint(root, null);
    const staleFindings3 = findings3.filter((f) => f.check === 'absence-stale');
    expect(staleFindings3).toHaveLength(0);
  });

  it('absence with empty matches → absence holds (no finding)', async () => {
    writeRepoFile('src/main.ts', 'nothing relevant here\n');

    appendRecord(root, {
      id: 'holds-absence', type: 'lesson', op: 'put', kind: 'absence',
      title: 'Feature never implemented',
      body: 'Checked everywhere.',
      scope: { terms: ['never_implemented'] },
    });

    const index = fakeIndex({ 'src/main.ts': [] });
    const built = await buildKbNotesIndex(index, root);

    // Empty matches means the absence holds
    expect(built.absence['holds-absence']?.matches).toEqual([]);

    // kbLint should NOT flag it as stale
    const findings = await kbLint(root, built);
    const staleFindings = findings.filter((f) => f.check === 'absence-stale');
    expect(staleFindings).toHaveLength(0);
  });

  it('multiple anchors on the same note: each anchor appears in the index', async () => {
    writeRepoFile('src/a.ts', 'export function funcA() {}\n');
    writeRepoFile('src/b.ts', 'export function funcB() {}\n');

    appendRecord(root, {
      id: 'flow-multi', type: 'file', op: 'put',
      summary: 'Multi-file flow.',
      anchors: [
        { path: 'src/a.ts' },
        { path: 'src/b.ts' },
      ],
    });

    const index = fakeIndex({
      'src/a.ts': ['funcA'],
      'src/b.ts': ['funcB'],
    });
    const built = await buildKbNotesIndex(index, root);

    expect(built.anchors['src/a.ts']).toEqual(['funcA']);
    expect(built.anchors['src/b.ts']).toEqual(['funcB']);
  });

  it('builtin timestamp: builtAt is approximately current time', async () => {
    const before = Date.now();
    const index = fakeIndex({});
    const built = await buildKbNotesIndex(index, root);
    const after = Date.now();

    expect(built.builtAt).toBeGreaterThanOrEqual(before);
    expect(built.builtAt).toBeLessThanOrEqual(after);
  });

  it('absence stamp records checkedAt timestamp', async () => {
    writeRepoFile('src/main.ts', 'export const marker = true;\n');

    appendRecord(root, {
      id: 'marked', type: 'lesson', op: 'put', kind: 'absence',
      title: 'Marker exists',
      body: 'Checked.',
      scope: { terms: ['marker'] },
    });

    const before = Date.now();
    const index = fakeIndex({ 'src/main.ts': [] });
    const built = await buildKbNotesIndex(index, root);
    const after = Date.now();

    const stamp = built.absence['marked'];
    expect(stamp?.checkedAt).toBeGreaterThanOrEqual(before);
    expect(stamp?.checkedAt).toBeLessThanOrEqual(after);
  });

  it('stampCoversTerms: order-insensitive, but length/content differences invalidate', () => {
    const stamp = { terms: ['foo', 'bar'], matches: [], checkedAt: 1 };
    expect(stampCoversTerms(stamp, ['bar', 'foo'])).toBe(true); // reorder is not a change
    expect(stampCoversTerms(stamp, ['foo', 'bar'])).toBe(true);
    expect(stampCoversTerms(stamp, ['foo'])).toBe(false);
    expect(stampCoversTerms(stamp, ['foo', 'baz'])).toBe(false);
    expect(stampCoversTerms(undefined, ['foo'])).toBe(false);
  });
});
