import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { renderNote } from '../src/kb/render.js';
import { hashFile, stampAnchors, freshnessLine } from '../src/kb/freshness.js';
import type { FoldedNote } from '../src/kb/types.js';

function baseNote(over: Partial<FoldedNote>): FoldedNote {
  return {
    id: 'n1', type: 'lesson', title: 'Title', aliases: [], anchors: [],
    status: 'active', updated: '2026-07-02T10:00:00.000Z', edits: 1,
    facets: [], behaviors: [], features: [], steps: [], invariants: [], extra: {},
    ...over,
  };
}

describe('kb render — golden shapes', () => {
  it('lesson note: frontmatter contract + body + absence scope', () => {
    const md = renderNote(baseNote({
      id: 'graph-restore-drops-functions',
      kind: 'bug-cause',
      title: 'Version restore silently drops function assignments',
      aliases: ['functions disappear after graph restore'],
      anchors: [{ path: 'arches/app/models/graph.py', symbols: ['restore_state'], hash: 'sha256:ab12cd34ef56' }],
      body: 'restore never re-creates functions_x_graphs — see [[graph-publication-flow]].',
      scope: { terms: ['functions_x_graphs restore'], globs: ['arches/**'] },
      extra: { confidence: 'high' },
    }));
    expect(md).toContain('id: graph-restore-drops-functions');
    expect(md).toContain('type: lesson');
    expect(md).toContain('kind: bug-cause');
    expect(md).toContain('aliases: ["functions disappear after graph restore"]');
    // anchors render as one JSON object per line — machine-readable back
    const anchorLine = md.split('\n').find((l) => l.trim().startsWith('- {'));
    expect(JSON.parse(anchorLine!.trim().slice(2)).path).toBe('arches/app/models/graph.py');
    expect(md).toContain('[[graph-publication-flow]]');
    expect(md).toContain('## Scope (absence');
    expect(md).toContain('confidence: "high"'); // unknown field preserved
    expect(md).not.toContain('[fresh]'); // freshness stamps are NEVER rendered
    expect(md).not.toContain('[evidence changed');
  });

  it('file note: summary, behaviors, [[flow]] links; flow note: steps + invariants', () => {
    const fileMd = renderNote(baseNote({
      id: 'src-auth-ts-abc12345', type: 'file', title: 'src/auth.ts',
      summary: 'Owns token minting.',
      behaviors: [{ concept_id: 'clock-skew', symbols: ['mint'], detail: 'allows 30s skew' }],
      features: [{ concept_id: 'auth-flow', role: 'entry point' }],
    }));
    expect(fileMd).toContain('# src/auth.ts');
    expect(fileMd).toContain('**clock-skew** (`mint`) — allows 30s skew');
    expect(fileMd).toContain('- [[auth-flow]] — entry point');

    const flowMd = renderNote(baseNote({
      id: 'auth-flow', type: 'flow', title: 'Auth flow',
      summary: 'How login works.',
      steps: [{ path: 'src/routes.ts', role: 'receives POST /login' }, { path: 'src/auth.ts', symbols: ['mint'], role: 'mints token' }],
      invariants: ['token TTL <= refresh TTL'],
    }));
    expect(flowMd).toContain('1. `src/routes.ts` — receives POST /login');
    expect(flowMd).toContain('2. `src/auth.ts` (`mint`) — mints token');
    expect(flowMd).toContain('- token TTL <= refresh TTL');
  });

  it('superseded and retracted banners', () => {
    expect(renderNote(baseNote({ status: 'superseded', supersededBy: 'better-note' })))
      .toContain('Superseded by [[better-note]]');
    expect(renderNote(baseNote({ status: 'retracted' }))).toContain('Retracted');
  });
});

describe('kb freshness', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-kb-fresh-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('stamps fresh / changed / missing / unverified per anchor (partial re-stamp basis)', () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/fresh.ts'), 'stable\n');
    fs.writeFileSync(path.join(root, 'src/changed.ts'), 'v1\n');
    const freshHash = hashFile(root, 'src/fresh.ts');
    const oldHash = hashFile(root, 'src/changed.ts');
    fs.writeFileSync(path.join(root, 'src/changed.ts'), 'v2 — drifted\n');

    const stamped = stampAnchors(root, [
      { path: 'src/fresh.ts', hash: freshHash },
      { path: 'src/changed.ts', hash: oldHash },
      { path: 'src/gone.ts', hash: 'sha256:dead00000000' },
      { path: 'src/fresh.ts', hash: undefined } as never, // never verified
    ]);
    expect(stamped.map((s) => s.state)).toEqual(['fresh', 'changed', 'missing', 'unverified']);
    // a multi-anchor flow NAMES the drifted file — never "the flow is false"
    expect(freshnessLine(stamped[1])).toBe('[evidence changed: src/changed.ts]');
    expect(freshnessLine(stamped[2])).toBe('[anchor missing: src/gone.ts]');
  });

  it('a stored "missing" hash on a now-present file reads as changed', () => {
    fs.writeFileSync(path.join(root, 'back.ts'), 'now exists\n');
    const [s] = stampAnchors(root, [{ path: 'back.ts', hash: 'missing' }]);
    expect(s.state).toBe('changed');
  });
});
