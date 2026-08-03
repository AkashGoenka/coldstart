/**
 * Capture coverage — the durable worklist. `hooks/capture-payload.mjs` drops
 * `.coldstart/notebook/.worklist.json` (contract twin) when it builds the
 * capture prompt; a `kb write` batch calls `finalizeBatchCoverage` to credit the
 * file notes written, report what worked files still lack a note, and then trim
 * (some left) or clear (all captured) the pair. These tests write the json in
 * the same shape and assert that arithmetic, the trim/clear behavior, its
 * silence when there is nothing to compare against, and that a flow does NOT
 * count as a note for its files.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  finalizeBatchCoverage, specPaths, worklistJsonPath, worklistMdPath,
} from '../src/kb/durable-worklist.js';

const roots: string[] = [];
function repoWith(files: { path: string; tier: string; needsNote: boolean }[]): string {
  const root = mkdtempSync(join(tmpdir(), 'cs-cov-'));
  roots.push(root);
  mkdirSync(join(root, '.coldstart', 'notebook'), { recursive: true });
  writeFileSync(worklistJsonPath(root), JSON.stringify({ ts: Date.now(), files, wrote: [] }));
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const fileSpec = (path: string) => ({ type: 'file-single', path, summary: 's' });

describe('durable worklist coverage', () => {
  it('counts written file notes against the outstanding worklist and names what is left', () => {
    const root = repoWith([
      { path: 'src/a.ts', tier: 'edited ×2', needsNote: true },
      { path: 'src/b.ts', tier: 'edited', needsNote: true },
      { path: 'src/c.ts', tier: 'read', needsNote: true },
    ]);
    const line = finalizeBatchCoverage(root, ['src/a.ts', 'src/b.ts']);
    expect(line).toContain('2 of 3 worklist files noted');
    expect(line).toContain('src/c.ts [read]');
    expect(line).toContain('A flow does not cover them');
    // some outstanding remain → the pair is TRIMMED to what is left, not cleared.
    expect(existsSync(worklistJsonPath(root))).toBe(true);
    expect(existsSync(worklistMdPath(root))).toBe(true);
  });

  it('clears the pair once everything outstanding has a note', () => {
    const root = repoWith([
      { path: 'src/a.ts', tier: 'edited', needsNote: true },
      { path: 'src/b.ts', tier: 'edited', needsNote: true },
    ]);
    const line = finalizeBatchCoverage(root, ['src/a.ts', 'src/b.ts']);
    expect(line).toContain('2 of 2 worklist files noted');
    expect(line).not.toContain('still without a file note');
    expect(existsSync(worklistJsonPath(root))).toBe(false);
    expect(existsSync(worklistMdPath(root))).toBe(false);
  });

  it('excludes already-fresh files from the denominator but reports them', () => {
    const root = repoWith([
      { path: 'src/a.ts', tier: 'edited', needsNote: true },
      { path: 'src/fresh.ts', tier: 'read', needsNote: false },
    ]);
    const line = finalizeBatchCoverage(root, ['src/a.ts']);
    expect(line).toContain('1 of 1 worklist files noted');
    expect(line).toContain('1 more already had a fresh note');
  });

  it('a flow written instead of the file notes leaves them outstanding', () => {
    const root = repoWith([{ path: 'src/a.ts', tier: 'edited', needsNote: true }]);
    // A flow spec contributes no file-note paths, so nothing is credited.
    const line = finalizeBatchCoverage(root, []);
    expect(line).toContain('0 of 1 worklist files noted');
    expect(line).toContain('src/a.ts [edited]');
  });

  it('is silent when there is no worklist to compare against', () => {
    const root = mkdtempSync(join(tmpdir(), 'cs-cov-'));
    roots.push(root);
    expect(finalizeBatchCoverage(root, ['src/a.ts'])).toBeNull();
  });

  it('credits only file notes — a flow/lesson notes none of its files', () => {
    expect(specPaths(fileSpec('src/a.ts'))).toEqual(['src/a.ts']);
    expect(specPaths({ type: 'file-hub', path: 'src/b.ts', facets: [] })).toEqual(['src/b.ts']);
    expect(specPaths({ type: 'flow', title: 't', steps: [{ path: 'src/a.ts' }] })).toEqual([]);
    expect(specPaths({ type: 'lesson', title: 't' })).toEqual([]);
    expect(specPaths({ op: 'retract', id: 'x', type: 'file-single', path: 'src/a.ts' })).toEqual([]);
  });
});
