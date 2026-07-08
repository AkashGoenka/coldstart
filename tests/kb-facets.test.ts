/**
 * Note-structure redesign — slice 1 (collection/write path).
 *
 * Covers: file-note character (hub|single, sugar types), symbol-keyed facets
 * (fold merge, retract, clash gate), git-HEAD provenance stamps, the exact
 * (path,symbol) dedup gate for anchored lessons, and `kb lookup` with derived
 * flow back-links. Design: docs/notebook-note-structure-scenarios.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fold } from '../src/kb/fold.js';
import { kbWrite } from '../src/kb/write.js';
import { kbLookup, renderLookup } from '../src/kb/lookup.js';
import { appendRecord } from '../src/kb/raw-log.js';
import { loadNote } from '../src/kb/store.js';
import { fileNoteId } from '../src/kb/ids.js';
import { renderNote } from '../src/kb/render.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-kb-facets-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeRepoFile(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const rec = (over: Record<string, unknown>): Record<string, unknown> => ({
  v: 1, id: 'models-py', type: 'file', op: 'put', ...over,
});

describe('fold: character + facets', () => {
  it('character is LWW; invalid values warn and keep the previous', () => {
    const { note, warnings } = fold('models-py', [
      rec({ ts: '2026-07-01T00:00:00Z', character: 'single' }),
      rec({ ts: '2026-07-02T00:00:00Z', character: 'hub' }),
      rec({ ts: '2026-07-03T00:00:00Z', character: 'octopus' }),
    ]);
    expect(note!.character).toBe('hub');
    expect(warnings.some((w) => w.includes('octopus'))).toBe(true);
  });

  it('facets replace by symbol (detail LWW), union flows, keep other symbols', () => {
    const { note } = fold('models-py', [
      rec({
        ts: '2026-07-01T00:00:00Z', head: 'aaaaaaaaaaaa',
        facets: [
          { symbol: 'Plugin', detail: 'nav Plugin model; ordering=sortorder', flows: ['side-nav-flow'] },
          { symbol: 'Node', detail: 'alias field + uniqueness constraint', flows: ['node-alias-flow'] },
        ],
      }),
      rec({
        ts: '2026-07-02T00:00:00Z', head: 'bbbbbbbbbbbb',
        facets: [{ symbol: 'Plugin', detail: 'nav Plugin model; ordering is Meta.sortorder', flows: ['plugin-sort-flow'] }],
      }),
    ]);
    expect(note!.facets).toHaveLength(2);
    const plugin = note!.facets.find((f) => f.symbol === 'Plugin')!;
    expect(plugin.detail).toContain('Meta.sortorder');
    expect(plugin.flows).toEqual(['side-nav-flow', 'plugin-sort-flow']); // union
    expect(plugin.head).toBe('bbbbbbbbbbbb'); // stamped from the replacing record
    const node = note!.facets.find((f) => f.symbol === 'Node')!;
    expect(node.detail).toContain('uniqueness');
    expect(node.head).toBe('aaaaaaaaaaaa'); // untouched by the second record
  });

  it('retract kind "facet" removes exactly one symbol; a later put re-adds', () => {
    const { note } = fold('models-py', [
      rec({ ts: '2026-07-01T00:00:00Z', facets: [{ symbol: 'Plugin', detail: 'x' }, { symbol: 'Node', detail: 'y' }] }),
      rec({ ts: '2026-07-02T00:00:00Z', op: 'retract', target: { kind: 'facet', key: 'Plugin' } }),
    ]);
    expect(note!.facets.map((f) => f.symbol)).toEqual(['Node']);
    const revived = fold('models-py', [
      rec({ ts: '2026-07-01T00:00:00Z', facets: [{ symbol: 'Plugin', detail: 'x' }] }),
      rec({ ts: '2026-07-02T00:00:00Z', op: 'retract', target: { kind: 'facet', key: 'Plugin' } }),
      rec({ ts: '2026-07-03T00:00:00Z', facets: [{ symbol: 'Plugin', detail: 'relearned' }] }),
    ]);
    expect(revived.note!.facets[0].detail).toBe('relearned');
  });

  it('record head lands on the note and on anchors carried by verifying records', () => {
    const { note } = fold('models-py', [
      rec({ ts: '2026-07-01T00:00:00Z', head: 'aaaaaaaaaaaa', anchors: [{ path: 'models.py', hash: 'sha256:111111111111', head: 'aaaaaaaaaaaa' }] }),
      rec({ ts: '2026-07-02T00:00:00Z', head: 'cccccccccccc', anchors: [{ path: 'models.py', hash: 'sha256:222222222222', head: 'cccccccccccc' }] }),
    ]);
    expect(note!.head).toBe('cccccccccccc');
    expect(note!.anchors[0].head).toBe('cccccccccccc');
    expect(note!.anchors[0].hash).toBe('sha256:222222222222');
  });
});

describe('kb write: character + sugar', () => {
  it('a new file note without character is rejected; "file-hub" sugar supplies it', async () => {
    writeRepoFile('models.py', 'class Plugin: pass\n');
    const bare = await kbWrite(root, { type: 'file', path: 'models.py', summary: 'models' });
    expect(bare.status).toBe('error');
    expect((bare as { message: string }).message).toContain('character');

    const sugared = await kbWrite(root, {
      type: 'file-hub', path: 'models.py',
      facets: [{ symbol: 'Plugin', detail: 'nav Plugin model' }],
    });
    expect(sugared.status).toBe('written');
    const { note } = loadNote(root, fileNoteId('models.py'));
    expect(note!.type).toBe('file'); // canonical type in the log — never "file-hub"
    expect(note!.character).toBe('hub');
    expect(note!.facets).toHaveLength(1);
  });

  it('sugar conflicting with an explicit character is rejected', async () => {
    const r = await kbWrite(root, { type: 'file-hub', character: 'single', path: 'a.py', summary: 'x' });
    expect(r.status).toBe('error');
    expect((r as { message: string }).message).toContain('conflicts');
  });

  it('facets on a single-character file or a non-file note are rejected', async () => {
    writeRepoFile('view.py', 'class SpatialView: pass\n');
    const single = await kbWrite(root, {
      type: 'file-single', path: 'view.py', summary: 'one purpose',
      facets: [{ symbol: 'SpatialView', detail: 'x' }],
    });
    expect(single.status).toBe('error');
    expect((single as { message: string }).message).toContain('hub');

    const flow = await kbWrite(root, {
      type: 'flow', title: 'some flow', summary: 's',
      steps: [{ path: 'a.py', role: 'r' }],
      facets: [{ symbol: 'X', detail: 'y' }],
    } as never);
    expect(flow.status).toBe('error');
  });

  it('anchor symbols accumulate across puts (union with facet symbols)', async () => {
    writeRepoFile('models.py', 'class Plugin: pass\nclass Node: pass\n');
    await kbWrite(root, { type: 'file-hub', path: 'models.py', facets: [{ symbol: 'Plugin', detail: 'p' }] });
    await kbWrite(root, { type: 'file', path: 'models.py', facets: [{ symbol: 'Node', detail: 'n' }] });
    const { note } = loadNote(root, fileNoteId('models.py'));
    expect(note!.anchors[0].symbols).toEqual(expect.arrayContaining(['Plugin', 'Node']));
  });
});

describe('kb write: facet clash gate (show-then-confirm)', () => {
  it('same-symbol facet exits with candidates showing current knowledge; --into replaces + unions flows', async () => {
    writeRepoFile('models.py', 'class LoadStaging: pass\n');
    const id = fileNoteId('models.py');
    await kbWrite(root, {
      type: 'file-hub', path: 'models.py',
      facets: [{ symbol: 'LoadStaging', detail: 'nodegroup FK is nullable by design', flows: ['old-flow'] }],
    });

    const clash = await kbWrite(root, {
      type: 'file', path: 'models.py',
      facets: [{ symbol: 'LoadStaging', detail: 'nodegroup FK guarded, not deleted, on restore', flows: ['graph-restore-flow'] }],
    });
    expect(clash.status).toBe('candidates');
    const cands = (clash as { candidates: { id: string; title: string; summary: string }[] }).candidates;
    expect(cands[0].id).toBe(id);
    expect(cands[0].title).toContain('LoadStaging');
    expect(cands[0].summary).toContain('nullable by design'); // the clobber is informed

    const confirmed = await kbWrite(root, {
      type: 'file', path: 'models.py',
      facets: [{ symbol: 'LoadStaging', detail: 'nodegroup FK guarded, not deleted, on restore', flows: ['graph-restore-flow'] }],
    }, { into: id });
    expect(confirmed.status).toBe('written');
    const { note } = loadNote(root, id);
    expect(note!.facets[0].detail).toContain('guarded');
    expect(note!.facets[0].flows).toEqual(['old-flow', 'graph-restore-flow']);
  });

  it('a new symbol on an existing hub does not gate', async () => {
    writeRepoFile('models.py', 'x = 1\n');
    await kbWrite(root, { type: 'file-hub', path: 'models.py', facets: [{ symbol: 'Plugin', detail: 'p' }] });
    const r = await kbWrite(root, { type: 'file', path: 'models.py', facets: [{ symbol: 'Node', detail: 'n' }] });
    expect(r.status).toBe('written');
  });
});

describe('kb write: exact (path,symbol) dedup for anchored lessons', () => {
  it('gates on an existing lesson at the same address — never on title words', async () => {
    appendRecord(root, {
      id: 'loadstaging-nullable', type: 'lesson', op: 'put', kind: 'absence',
      title: 'LoadStaging nodegroup is already nullable',
      body: 'The FK is guarded, not deleted.',
      anchors: [{ path: 'models.py', symbols: ['LoadStaging'] }],
    });
    // Same address, deliberately DIFFERENT title words → still gated (exact match).
    const gated = await kbWrite(root, {
      type: 'lesson', kind: 'absence',
      title: 'graph restore keeps staging rows',
      body: 'restore guards the FK',
      anchors: [{ path: 'models.py', symbols: ['LoadStaging'] }],
    });
    expect(gated.status).toBe('candidates');
    expect((gated as { candidates: { id: string }[] }).candidates[0].id).toBe('loadstaging-nullable');

    // Different symbol on the same file → different address → written.
    const other = await kbWrite(root, {
      type: 'lesson', kind: 'absence',
      title: 'LoadStaging nodegroup is already nullable', // same words as the seed!
      body: 'different fact about a different symbol',
      scope: { terms: ['Node', 'nullable'] },
      anchors: [{ path: 'models.py', symbols: ['Node'] }],
    });
    expect(other.status).toBe('written');
  });

  it('file-level and symbol-level addresses do not cross-match; --new bypasses', async () => {
    appendRecord(root, {
      id: 'models-general', type: 'lesson', op: 'put', kind: 'absence',
      title: 'models.py imports must stay lazy', body: 'circular import trap',
      anchors: [{ path: 'models.py' }],
    });
    const symbolLevel = await kbWrite(root, {
      type: 'lesson', kind: 'absence', title: 'plugin ordering trap', body: 'x',
      scope: { terms: ['plugin', 'ordering'] },
      anchors: [{ path: 'models.py', symbols: ['Plugin'] }],
    });
    expect(symbolLevel.status).toBe('written'); // file-level lesson is a different granularity

    const fileLevel = await kbWrite(root, {
      type: 'lesson', kind: 'absence', title: 'another models rule', body: 'y',
      scope: { terms: ['models', 'rule'] },
      anchors: [{ path: 'models.py' }],
    });
    expect(fileLevel.status).toBe('candidates'); // same file-level address

    const forced = await kbWrite(root, {
      type: 'lesson', kind: 'absence', title: 'another models rule', body: 'y',
      scope: { terms: ['models', 'rule'] },
      anchors: [{ path: 'models.py' }],
    }, { isNew: true });
    expect(forced.status).toBe('written');
  });

  it('a facet at the address surfaces as a file-note candidate', async () => {
    writeRepoFile('models.py', 'class LoadStaging: pass\n');
    await kbWrite(root, {
      type: 'file-hub', path: 'models.py',
      facets: [{ symbol: 'LoadStaging', detail: 'FK guarded, not deleted' }],
    });
    const r = await kbWrite(root, {
      type: 'lesson', kind: 'absence', title: 'staging rows survive restore', body: 'z',
      anchors: [{ path: 'models.py', symbols: ['LoadStaging'] }],
    });
    expect(r.status).toBe('candidates');
    const cands = (r as { candidates: { id: string; type: string; summary: string }[] }).candidates;
    expect(cands[0].type).toBe('file');
    expect(cands[0].summary).toContain('FK guarded');
  });
});

describe('git-HEAD provenance stamps', () => {
  it('in a git repo, append stamps record + verified anchors; folded note carries it', async () => {
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    };
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'init');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().slice(0, 12);

    writeRepoFile('models.py', 'class Plugin: pass\n');
    await kbWrite(root, { type: 'file-hub', path: 'models.py', facets: [{ symbol: 'Plugin', detail: 'p' }] });
    const { note } = loadNote(root, fileNoteId('models.py'));
    expect(note!.head).toBe(head);
    expect(note!.anchors[0].head).toBe(head);
    expect(note!.facets[0].head).toBe(head);
  });

  it('outside a git repo there is simply no head — the sha tripwire is the whole story', async () => {
    writeRepoFile('new_migration.py', 'x = 1\n');
    await kbWrite(root, { type: 'file-single', path: 'new_migration.py', summary: 'adds the guard' });
    const { note } = loadNote(root, fileNoteId('new_migration.py'));
    expect(note!.head).toBeUndefined();
    expect(note!.anchors[0].head).toBeUndefined();
    expect(note!.anchors[0].hash).toMatch(/^sha256:/); // stamped sha is present regardless
  });
});

describe('kb lookup', () => {
  async function seedCorpus(): Promise<void> {
    writeRepoFile('models.py', 'class Plugin: pass\nclass LoadStaging: pass\n');
    await kbWrite(root, {
      type: 'file-hub', path: 'models.py', summary: 'ORM models hub',
      facets: [
        { symbol: 'Plugin', detail: 'nav Plugin model; ordering=sortorder', flows: ['side-nav-flow'] },
        { symbol: 'LoadStaging', detail: 'FK guarded, not deleted' },
      ],
    });
    appendRecord(root, {
      id: 'side-nav-flow', type: 'flow', op: 'put',
      title: 'how the side nav renders',
      steps: [
        { path: 'views/nav.py', role: 'entry point' },
        { path: 'models.py', symbols: ['Plugin'], role: 'defines Plugin; ordering=sortorder' },
      ],
    });
    appendRecord(root, {
      id: 'resource-lifecycle', type: 'flow', op: 'put',
      title: 'resource lifecycle state changes',
      steps: [{ path: 'models.py', role: 'save() dispatches lifecycle handlers' }], // no symbols declared
    });
    appendRecord(root, {
      id: 'loadstaging-nullable', type: 'lesson', op: 'put', kind: 'absence',
      title: 'LoadStaging nodegroup already nullable', body: 'guarded, not deleted.',
      anchors: [{ path: 'models.py', symbols: ['LoadStaging'] }],
    });
  }

  it('symbol address: only that facet, symbol-matching + undeclared-symbol steps, matching lessons', async () => {
    await seedCorpus();
    const r = kbLookup(root, 'models.py', 'Plugin');
    expect(r.fileNote!.character).toBe('hub');
    expect(r.fileNote!.facets.map((f) => f.symbol)).toEqual(['Plugin']);
    // side-nav step declares Plugin; resource-lifecycle declares nothing → both included
    expect(r.flows.map((f) => f.id).sort()).toEqual(['resource-lifecycle', 'side-nav-flow']);
    expect(r.lessons).toHaveLength(0); // lesson is addressed to LoadStaging, not Plugin

    const ls = kbLookup(root, 'models.py', 'LoadStaging');
    expect(ls.fileNote!.facets.map((f) => f.symbol)).toEqual(['LoadStaging']);
    expect(ls.lessons.map((l) => l.id)).toEqual(['loadstaging-nullable']);
    expect(ls.flows.map((f) => f.id)).toEqual(['resource-lifecycle']); // undeclared symbols can't be ruled out
  });

  it('file address: all facets + every flow touching the path; render is compact text', async () => {
    await seedCorpus();
    const r = kbLookup(root, 'models.py');
    expect(r.fileNote!.facets).toHaveLength(2);
    expect(r.flows).toHaveLength(2);
    expect(r.lessons).toHaveLength(1);
    const text = renderLookup(r);
    expect(text).toContain('file note:');
    expect(text).toContain('facet Plugin:');
    expect(text).toContain('[[side-nav-flow]] step 2');
    expect(text).toContain('[[loadstaging-nullable]]');
  });

  it('unknown address renders a single nothing-recorded line', async () => {
    await seedCorpus();
    const r = kbLookup(root, 'does/not/exist.py');
    expect(renderLookup(r)).toContain('nothing recorded');
  });

  it('anchor-only match: a flow that ANCHORS a file but has no step there still surfaces (pre-edit gate)', async () => {
    // Mirrors ~14% of real arches flows: the file is in the freshness contract
    // (anchors) but the narrative (steps) lives elsewhere.
    appendRecord(root, {
      id: 'schema-drift-flow', type: 'flow', op: 'put',
      title: 'spatial view schema drift',
      steps: [{ path: 'views/nav.py', role: 'reads the view' }],
      anchors: [{ path: 'migrations/0001_init.py' }],
    });
    const r = kbLookup(root, 'migrations/0001_init.py');
    expect(r.flows.map((f) => f.id)).toEqual(['schema-drift-flow']);
    expect(r.flows[0].viaAnchor).toBe(true);
    expect(r.flows[0].steps).toHaveLength(0);
    expect(renderLookup(r)).toContain('[[schema-drift-flow]] — depends on this file');

    // And where it DOES have a step, it renders as a step (not the anchor line).
    const stepHit = kbLookup(root, 'views/nav.py');
    expect(stepHit.flows[0].viaAnchor).toBeUndefined();
    expect(renderLookup(stepHit)).toContain('[[schema-drift-flow]] step 1');
  });
});

describe('kb write: --force (validation mode) + path warnings', () => {
  it('force skips all three gates but never structural validation', async () => {
    writeRepoFile('models.py', 'class Plugin: pass\n');
    await kbWrite(root, { type: 'file-hub', path: 'models.py', facets: [{ symbol: 'Plugin', detail: 'v1' }] });
    // facet clash: gated without force, written with it
    const forced = await kbWrite(root, {
      type: 'file', path: 'models.py', facets: [{ symbol: 'Plugin', detail: 'v2' }],
    }, { force: true });
    expect(forced.status).toBe('written');
    expect(loadNote(root, fileNoteId('models.py')).note!.facets[0].detail).toBe('v2');

    // exact-address lesson gate: skipped under force
    appendRecord(root, {
      id: 'seed-lesson', type: 'lesson', op: 'put', kind: 'absence', title: 'seed', body: 'x',
      anchors: [{ path: 'models.py', symbols: ['Plugin'] }],
    });
    const lesson = await kbWrite(root, {
      type: 'lesson', kind: 'absence', title: 'another take', body: 'y',
      scope: { terms: ['plugin', 'take'] },
      anchors: [{ path: 'models.py', symbols: ['Plugin'] }],
    }, { force: true });
    expect(lesson.status).toBe('written');

    // structural validation still applies: new file note without character
    const bad = await kbWrite(root, { type: 'file', path: 'other.py', summary: 's' }, { force: true });
    expect(bad.status).toBe('error');
  });

  it('warns on missing and absolute paths (dangling static links), never rejects', async () => {
    writeRepoFile('real.py', 'x = 1\n');
    const r = await kbWrite(root, {
      type: 'flow', title: 'some story', summary: 's',
      steps: [
        { path: 'real.py', role: 'exists' },
        { path: 'typo/nope.py', role: 'missing' },
        { path: '/abs/path.py', role: 'absolute' },
      ],
    }, { force: true });
    expect(r.status).toBe('written');
    const warnings = (r as { warnings?: string[] }).warnings ?? [];
    expect(warnings.some((w) => w.includes('typo/nope.py') && w.includes('not found'))).toBe(true);
    expect(warnings.some((w) => w.includes('/abs/path.py') && w.includes('absolute'))).toBe(true);
    expect(warnings.some((w) => w.includes('real.py'))).toBe(false);
  });
});

describe('notebook ToC (_index.md)', () => {
  it('regenerates on every write: grouped, facet symbols listed, id-collision-proof name', async () => {
    writeRepoFile('models.py', 'class Plugin: pass\n');
    await kbWrite(root, { type: 'file-hub', path: 'models.py', facets: [{ symbol: 'Plugin', detail: 'p' }] });
    await kbWrite(root, {
      type: 'flow', title: 'how the nav renders', summary: 's',
      steps: [{ path: 'models.py', role: 'r' }],
    }, { force: true });
    const idx = fs.readFileSync(path.join(root, '.coldstart/notebook/notes/_index.md'), 'utf8');
    expect(idx).toContain('## Files');
    expect(idx).toContain(`[models.py](${fileNoteId('models.py')}.md) (hub) — Plugin`);
    expect(idx).toContain('## Flows');
    expect(idx).toContain('[how the nav renders](how-the-nav-renders.md)');
    expect(idx).toContain('2 active notes (1 file · 1 flow · 0 lesson)');
  });
});

describe('render: facets in derived md', () => {
  it('facets render under ## Facets with flow wikilinks; character in frontmatter', () => {
    const { note } = fold('models-py', [
      rec({
        ts: '2026-07-01T00:00:00Z', character: 'hub',
        facets: [{ symbol: 'Plugin', detail: 'nav model', flows: ['side-nav-flow'] }],
      }),
    ]);
    const md = renderNote(note!);
    expect(md).toContain('character: hub');
    expect(md).toContain('## Facets');
    expect(md).toContain('**Plugin** — nav model — [[side-nav-flow]]');
  });
});
