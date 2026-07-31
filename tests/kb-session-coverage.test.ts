/**
 * Capture coverage: `kb write --session` reports how much of the session's
 * worklist has a note. The manifest is written by hooks/capture-payload.mjs —
 * these tests write it in the same shape (the contract twin) and assert the
 * reader's arithmetic, its silence when there is nothing to compare against,
 * and that a flow does NOT count as a note for its step files.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noteCoverage, specPaths } from '../src/kb/session-worklist.js';

const sids: string[] = [];
function manifest(files: { path: string; tier: string; needsNote: boolean }[], ts = Date.now()): string {
  const sid = `test-cov-${Math.random().toString(36).slice(2)}`;
  sids.push(sid);
  writeFileSync(join(tmpdir(), `coldstart-kb-worklist-${sid}.json`), JSON.stringify({ ts, files, wrote: [] }));
  return sid;
}
afterEach(() => {
  for (const sid of sids.splice(0)) {
    rmSync(join(tmpdir(), `coldstart-kb-worklist-${sid}.json`), { force: true });
  }
});

const fileSpec = (path: string) => ({ type: 'file-single', path, summary: 's' });

describe('capture coverage', () => {
  it('counts writes against the outstanding worklist and names what is left', () => {
    const sid = manifest([
      { path: 'src/a.ts', tier: 'edited ×2', needsNote: true },
      { path: 'src/b.ts', tier: 'edited', needsNote: true },
      { path: 'src/c.ts', tier: 'read', needsNote: true },
    ]);
    const first = noteCoverage(sid, fileSpec('src/a.ts'));
    expect(first).toContain('1 of 3 worklist files noted');
    expect(first).toContain('src/b.ts [edited]');
    // Low coverage → the skips must be justified, not silently dropped.
    expect(first).toContain('say which and why');

    // State carries across writes in the same session (the chained-&& case).
    const second = noteCoverage(sid, fileSpec('src/b.ts'));
    expect(second).toContain('2 of 3 worklist files noted');
    expect(second).not.toContain('say which and why'); // past the low bar
    expect(second).not.toContain('src/b.ts');
  });

  it('excludes already-fresh files from the denominator but reports them', () => {
    const sid = manifest([
      { path: 'src/a.ts', tier: 'edited', needsNote: true },
      { path: 'src/fresh.ts', tier: 'read', needsNote: false },
    ]);
    const line = noteCoverage(sid, fileSpec('src/a.ts'));
    expect(line).toContain('1 of 1 worklist files noted');
    expect(line).toContain('1 more already had a fresh note');
  });

  it('is silent without a session, without a manifest, and on a stale one', () => {
    expect(noteCoverage(undefined, fileSpec('src/a.ts'))).toBeNull();
    expect(noteCoverage('never-armed-session', fileSpec('src/a.ts'))).toBeNull();
    const old = manifest([{ path: 'src/a.ts', tier: 'edited', needsNote: true }], Date.now() - 48 * 3600 * 1000);
    expect(noteCoverage(old, fileSpec('src/a.ts'))).toBeNull();
  });

  it('credits only file notes — a flow does not note its step files', () => {
    expect(specPaths(fileSpec('src/a.ts'))).toEqual(['src/a.ts']);
    expect(specPaths({ type: 'file-hub', path: 'src/b.ts', facets: [] })).toEqual(['src/b.ts']);
    expect(specPaths({ type: 'flow', title: 't', steps: [{ path: 'src/a.ts' }] })).toEqual([]);
    expect(specPaths({ type: 'lesson', title: 't' })).toEqual([]);

    const sid = manifest([{ path: 'src/a.ts', tier: 'edited', needsNote: true }]);
    const line = noteCoverage(sid, { type: 'flow', title: 't', steps: [{ path: 'src/a.ts' }] });
    expect(line).toContain('0 of 1 worklist files noted');
  });
});
