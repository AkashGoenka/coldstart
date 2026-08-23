/**
 * `coldstart graph` — the payload the viewer draws.
 *
 * Two things are worth pinning: the adaptive directory banding (a fixed-depth
 * cut is what a real repo's shape defeats), and that all four relation kinds
 * survive with their names attached, since an anonymous edge is the whole
 * failure mode this view exists to avoid.
 */
import { describe, it, expect } from 'vitest';
import {
  assignClusters, buildGraphPayload,
  REL_IMPORT, REL_CALLS, REL_COEDIT, REL_NOTE,
} from '../src/graph/dump.js';
import { renderGraphHtml } from '../src/graph/view.js';
import type { CodebaseIndex, IndexedFile, SymbolNode } from '../src/types.js';
import type { CoChangeIndex } from '../src/indexer/cochange.js';

function file(id: string, symbols: string[] = []): IndexedFile {
  return {
    id, path: '/' + id, relativePath: id, language: 'typescript',
    domainMap: {}, exports: [], hasDefaultExport: false, imports: [],
    hash: 'h', lineCount: 1, tokenEstimate: 1, importedByCount: 0,
    transitiveImportedByCount: 0, isBarrel: false, isTestFile: false,
    symbols: symbols.map((name): SymbolNode => ({
      id: `${id}#${name}`, name, kind: 'function', file: id,
      startLine: 1, endLine: 2, exported: true,
    })),
  } as IndexedFile;
}

function index(files: IndexedFile[], edges: { from: string; to: string }[] = [],
               symbolEdges: CodebaseIndex['symbolEdges'] = []): CodebaseIndex {
  return {
    files: new Map(files.map((f) => [f.id, f])),
    edges, symbolEdges,
  } as unknown as CodebaseIndex;
}

describe('assignClusters', () => {
  it('splits a band that would swallow the sphere', () => {
    // 40 files under app/, 5 elsewhere: a depth-1 cut puts 89% in one band.
    const ids = [
      ...Array.from({ length: 20 }, (_, i) => `app/models/m${i}.py`),
      ...Array.from({ length: 20 }, (_, i) => `app/views/v${i}.py`),
      ...Array.from({ length: 5 }, (_, i) => `lib/l${i}.py`),
    ];
    const got = assignClusters(ids);
    expect(got.get('app/models/m0.py')).toBe('app/models');
    expect(got.get('app/views/v0.py')).toBe('app/views');
    // No band may hold more than a modest share once splitting has run.
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(got.get(id)!, (counts.get(got.get(id)!) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(20);
  });

  it('folds slivers together instead of leaving one-file bands', () => {
    const ids = [
      ...Array.from({ length: 60 }, (_, i) => `src/a/f${i}.ts`),
      'oddball.ts',
    ];
    const got = assignClusters(ids);
    // A single root-level file cannot clear the minimum, so it lands in the
    // terminal catch-all rather than earning its own latitude band. `other` is
    // allowed to stay small — that is the whole point of it.
    expect(got.get('oddball.ts')).toBe('other');
    expect(new Set([...got.values()])).toEqual(new Set(['src/a', 'other']));
  });

  it('is a pure function of the paths — same input, same seats', () => {
    const ids = ['a/x.ts', 'a/y.ts', 'b/z.ts'];
    expect([...assignClusters(ids)]).toEqual([...assignClusters([...ids])]);
  });
});

describe('buildGraphPayload', () => {
  const files = [file('src/a.ts', ['run']), file('src/b.ts', ['save', 'load']), file('src/c.ts')];

  it('emits import edges as directed with no detail', () => {
    const { payload } = buildGraphPayload('r', index(files, [{ from: 'src/a.ts', to: 'src/b.ts' }]), null, []);
    const e = payload.e.filter((x) => x[2] === REL_IMPORT);
    expect(e).toHaveLength(1);
    expect(e[0][3]).toBe(1);
  });

  it('names call edges with the callees, aggregated per file pair', () => {
    const { payload } = buildGraphPayload('r', index(files, [], [
      { from: 'src/a.ts#run', to: 'src/b.ts#save', type: 'calls' },
      { from: 'src/a.ts#run', to: 'src/b.ts#load', type: 'calls' },
    ]), null, []);
    const e = payload.e.filter((x) => x[2] === REL_CALLS);
    // One edge for the file pair, not one per call site.
    expect(e).toHaveLength(1);
    expect(e[0][4]).toBe('save(), load()');
  });

  it('ignores same-file calls and unresolvable ones', () => {
    const { payload } = buildGraphPayload('r', index(files, [], [
      { from: 'src/a.ts#run', to: 'src/a.ts#other', type: 'calls' },
      { from: 'src/a.ts#run', to: 'nowhere#gone', type: 'calls' },
      { from: 'src/a.ts#run', to: 'src/b.ts#save', type: 'extends' },
    ]), null, []);
    expect(payload.e.filter((x) => x[2] === REL_CALLS)).toHaveLength(0);
  });

  it('carries the co-change support count as the edge label', () => {
    const cc = {
      v: 1, head: 'h', commitsScanned: 7,
      partners: { 'src/a.ts': [['src/b.ts', 3] as [string, number]] },
      touched: { 'src/a.ts': 7 },
    } as unknown as CoChangeIndex;
    const { payload } = buildGraphPayload('r', index(files), cc, []);
    const e = payload.e.filter((x) => x[2] === REL_COEDIT);
    expect(e).toHaveLength(1);
    expect(e[0][4]).toBe('3 of 7 commits');
    expect(e[0][3]).toBe(0); // mutual, not directed
  });

  it('joins a note’s anchors as a star, not all-pairs', () => {
    const { payload, stats } = buildGraphPayload('r', index(files), null, [
      { title: 'how it works', paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
    ]);
    const e = payload.e.filter((x) => x[2] === REL_NOTE);
    expect(e).toHaveLength(2); // star from the first anchor, not 3 pairs
    expect(e[0][4]).toBe('how it works');
    expect(stats.notes).toBe(1);
  });

  it('skips a note anchored to only one file', () => {
    const { payload, stats } = buildGraphPayload('r', index(files), null, [
      { title: 'single', paths: ['src/a.ts'] },
    ]);
    expect(payload.e.filter((x) => x[2] === REL_NOTE)).toHaveLength(0);
    expect(stats.notes).toBe(0);
  });

  it('counts isolated files, which is most of a real repo', () => {
    const { stats } = buildGraphPayload('r', index(files, [{ from: 'src/a.ts', to: 'src/b.ts' }]), null, []);
    expect(stats.files).toBe(3);
    expect(stats.isolated).toBe(1); // c.ts
  });

  it('keeps the same pair on different relation kinds as separate edges', () => {
    const cc = {
      v: 1, head: 'h', commitsScanned: 2,
      partners: { 'src/a.ts': [['src/b.ts', 2] as [string, number]] }, touched: { 'src/a.ts': 2 },
    } as unknown as CoChangeIndex;
    const { payload } = buildGraphPayload('r', index(files, [{ from: 'src/a.ts', to: 'src/b.ts' }]), cc, []);
    const kinds = payload.e.map((x) => x[2]).sort();
    expect(kinds).toEqual([REL_IMPORT, REL_COEDIT].sort());
  });
});

describe('renderGraphHtml', () => {
  it('substitutes both placeholders', () => {
    const html = renderGraphHtml('<title>__TITLE__</title><script>const D=__DATA_JSON__;</script>',
      'myrepo', { a: 1 });
    expect(html).toContain('myrepo — codebase graph');
    expect(html).toContain('const D={"a":1};');
  });

  it('cannot be broken out of by a path containing a closing script tag', () => {
    const html = renderGraphHtml('<script>const D=__DATA_JSON__;</script>', 'r',
      { p: 'a</script><img onerror=x>' });
    expect(html).not.toContain('a</script>');
    expect(html).toContain('<\\/script>');
  });

  it('escapes the repo name into the title', () => {
    const html = renderGraphHtml('<title>__TITLE__</title>', '<b>x', {});
    expect(html).toContain('&lt;b&gt;x');
  });
});
