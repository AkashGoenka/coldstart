import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { kbSearch, renderCompactPage } from '../src/kb/search.js';
import { noteLine, buildNoteMap } from '../src/server/find.js';
import { kbCommit } from '../src/kb/commit.js';
import { initSkeleton } from '../src/kb/store.js';
import { appendRecord } from '../src/kb/raw-log.js';
import type { FoldedNote } from '../src/kb/types.js';

/**
 * Retrieval-live surfaces (2026-07-06): the hook injection floor, the
 * pointer-only page, find's Note: summaries, and kb commit's deliberate
 * publish. These are the contracts the real validation run exercises.
 */

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-retrieval-'));
  initSkeleton(root);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Create a placeholder file for an anchor path so the note's anchors resolve
 *  as present — without it every note is "inactive" (all anchors absent) and
 *  recall correctly drops it. Ranking tests need live anchors. */
function touch(rel: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `# fixture ${rel}\n`);
}

function seedCorpus(n: number): void {
  // n distinct notes so idf operates in the calibrated regime (≥30).
  for (let i = 0; i < n; i++) {
    touch(`src/sub${i}/loader.py`);
    appendRecord(root, {
      id: `area-${i}-note`, type: 'flow', op: 'put',
      title: `how subsystem ${i} handles Widget${i}Loader requests`,
      aliases: [`widget ${i} loader`],
      summary: `Subsystem ${i} routes through Widget${i}Loader before persisting.`,
      anchors: [{ path: `src/sub${i}/loader.py`, symbols: [`Widget${i}Loader`] }],
    } as never);
  }
}

describe('hook injection floor', () => {
  it('boilerplate-grade weak matches are suppressed once the corpus is in the calibrated regime', async () => {
    seedCorpus(35);
    // "requests" appears in EVERY title → high df → tiny idf → weak score.
    const weak = await kbSearch(root, 'Please list all the files relevant and handle the requests output', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(weak.hits).toHaveLength(0);
    // A discriminating code-shaped term must still clear the floor.
    const strong = await kbSearch(root, 'Widget7Loader fails to persist the request payload', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(strong.hits.length).toBeGreaterThan(0);
    expect(strong.hits[0].note.id).toBe('area-7-note');
  });

  it('convergence override: 4 common minority words landing on ONE note inject; 1–3 stay suppressed', async () => {
    // The q15/d03 false-suppression mode: a real task named entirely in common
    // words. No single term is rare (df > N/10 for all), but 4 independent
    // minority words converge on the right note's name channel.
    seedCorpus(15);
    touch('src/jobs/export_queue.py');
    appendRecord(root, {
      id: 'export-queue-flow', type: 'flow', op: 'put',
      title: 'how the export queue retry batch works',
      summary: 'Exports drain through a retry queue in batches.',
      anchors: [{ path: 'src/jobs/export_queue.py', symbols: ['drain'] }],
    } as never);
    // 4 decoys per word so each word's df = 5 — above rareMax (ceil(32/10)=4,
    // so NOT rare) but a minority (10 ≤ 32), i.e. still gate-eligible.
    const words = ['export', 'queue', 'retry', 'batch'];
    for (const w of words) {
      for (let i = 0; i < 4; i++) {
        touch(`src/decoys/${w}_${i}.py`);
        appendRecord(root, {
          id: `${w}-decoy-${i}`, type: 'flow', op: 'put',
          title: `unrelated ${w} corner ${i} pipeline`,
          summary: `Decoy note ${i} for ${w}.`,
          anchors: [{ path: `src/decoys/${w}_${i}.py` }],
        } as never);
      }
    }

    // 4 converging words → the override fires despite zero rare terms.
    const converged = await kbSearch(root, 'export queue retry batch is dropping records', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(converged.hits.length).toBeGreaterThan(0);
    expect(converged.hits[0].note.id).toBe('export-queue-flow');
    expect(converged.hits[0].strongTerms).toBe(4);

    // 3 words on the same note is still a graze band (measured: q09) → silent.
    const graze = await kbSearch(root, 'the export queue is broken, fix the retry', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(graze.hits).toHaveLength(0);

    // 1 shared word is boilerplate → silent.
    const boiler = await kbSearch(root, 'please fix the export', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(boiler.hits).toHaveLength(0);
  });

  it('young notebooks (< 30 notes) are exempt — the floor must not silence a seed corpus', async () => {
    seedCorpus(4);
    const res = await kbSearch(root, 'Widget2Loader breaks on persist', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(res.hits.length).toBeGreaterThan(0);
    // and the page is pointer-only regardless of dominance
    const page = renderCompactPage('Widget2Loader breaks on persist', res);
    expect(page).not.toContain('## ');
    expect(page).toContain('- **');
  });
});

describe('inactive projection — notes whose anchored files are absent on this branch', () => {
  it('tool search keeps an absent-anchor note but flags it inactive (tier 3); a live one is active', async () => {
    touch('src/live.py');
    appendRecord(root, {
      id: 'live-note', type: 'file', op: 'put', character: 'single',
      title: 'ZebraLoader handles staging', summary: 'present file.',
      anchors: [{ path: 'src/live.py', symbols: ['ZebraLoader'] }],
    } as never);
    // src/gone.py intentionally NOT created → absent on this branch.
    appendRecord(root, {
      id: 'gone-note', type: 'file', op: 'put', character: 'single',
      title: 'ZebraUnloader handles staging', summary: 'absent file.',
      anchors: [{ path: 'src/gone.py', symbols: ['ZebraUnloader'] }],
    } as never);

    const tool = await kbSearch(root, 'ZebraUnloader ZebraLoader staging', { noMissLog: true });
    const gone = tool.hits.find((h) => h.note.id === 'gone-note');
    const live = tool.hits.find((h) => h.note.id === 'live-note');
    expect(live?.inactive).toBe(false);
    expect(gone?.inactive).toBe(true);
    expect(gone?.tier).toBe(3);
  });

  it('recall (hook mode) never injects a note whose anchored files are all absent', async () => {
    // gone-note matches its own distinctive term, but its file does not exist.
    appendRecord(root, {
      id: 'gone-note', type: 'file', op: 'put', character: 'single',
      title: 'ZebraUnloader handles staging', summary: 'absent file.',
      anchors: [{ path: 'src/gone.py', symbols: ['ZebraUnloader'] }],
    } as never);
    const hook = await kbSearch(root, 'ZebraUnloader is dropping rows', { strongOnly: true, noMissLog: true, source: 'hook' });
    expect(hook.hits.some((h) => h.note.id === 'gone-note')).toBe(false);
  });

  it('lessons are exempt — an absence lesson stays active even with no live anchor', async () => {
    appendRecord(root, {
      id: 'absence-note', type: 'lesson', op: 'put', kind: 'absence',
      title: 'no retry logic in the ingest path',
      body: 'searched, found nothing.',
      anchors: [{ path: 'src/never_existed.py' }],
      scope: { terms: ['retry', 'ingest'] },
    } as never);
    const res = await kbSearch(root, 'retry ingest', { noMissLog: true });
    const hit = res.hits.find((h) => h.note.id === 'absence-note');
    expect(hit).toBeTruthy();
    expect(hit?.inactive).toBe(false);
  });
});

describe('find Note: line summaries', () => {
  const base: FoldedNote = {
    id: 'x', type: 'file', title: 'src/models.py', aliases: [], anchors: [], status: 'active',
    updated: '2026-07-06T00:00:00Z', edits: 1, facets: [], steps: [], invariants: [],
    behaviors: [], features: [],
  } as unknown as FoldedNote;

  it('single: the WHOLE body — the body IS the note (user ruling 2026-07-07)', () => {
    const note = { ...base, character: 'single', body: 'Registers SpatialView with GuardedAdmin. Second sentence survives too.' } as FoldedNote;
    const res = noteLine(root, 'src/models.py', { note });
    expect(res.line).toContain('Registers SpatialView with GuardedAdmin.');
    expect(res.line).toContain('Second sentence survives too.');
    expect(res.summary).toBe(true);
  });

  it('hub: a query term naming a facet symbol selects THAT facet detail, in FULL', () => {
    const note = {
      ...base, character: 'hub',
      facets: [
        { symbol: 'LoadStaging', detail: 'nodegroup FK is nullable since 10887. Inner joins silently drop null rows.' },
        { symbol: 'ResourceInstance', detail: 'save() auto-sets graph_publication.' },
      ],
    } as FoldedNote;
    const res = noteLine(root, 'src/models.py', { note }, ['loadstaging', 'nullable']);
    expect(res.line).toContain('LoadStaging — nodegroup FK is nullable since 10887.');
    expect(res.line).toContain('Inner joins silently drop null rows.'); // untruncated payload
    expect(res.line).not.toContain('ResourceInstance');
    expect(res.summary).toBe(true); // matched facet detail replaces the preview
  });

  it('a facet-naming query gives the file note the Note: slot, not a title-matching flow', async () => {
    // The q8/user-observed steal: a flow whose TITLE shares a query word used
    // to beat the file note whose FACET holds the answer.
    appendRecord(root, {
      id: 'graph-restore-flow', type: 'flow', op: 'put',
      title: 'restoring a graph version cascade-deletes staging rows',
      summary: 's.', steps: [{ path: 'src/models.py', role: 'declares the FKs' }],
      anchors: [{ path: 'src/models.py' }],
    } as never);
    appendRecord(root, {
      id: 'models-hub', type: 'file', op: 'put', title: 'src/models.py',
      anchors: [{ path: 'src/models.py' }],
      facets: [{ symbol: 'GraphModel', detail: 'slug uniqueness lives in Meta.constraints, not the field.' }],
    } as never);
    const map = buildNoteMap(root, ['graphmodel', 'slug']);
    expect(map.get('src/models.py')!.note.id).toBe('models-hub');
    // a query about the FLOW still routes to the flow
    const flowMap = buildNoteMap(root, ['restoring', 'cascade']);
    expect(flowMap.get('src/models.py')!.note.id).toBe('graph-restore-flow');
  });

  it('hub with no matching term: the facet symbol inventory', () => {
    const note = {
      ...base, character: 'hub',
      facets: [{ symbol: 'A', detail: 'a' }, { symbol: 'B', detail: 'b' }],
    } as FoldedNote;
    const res = noteLine(root, 'src/models.py', { note }, ['unrelated']);
    expect(res.line).toContain('facets: A, B');
    expect(res.summary).toBe(false); // inventory is a pointer, not a summary — preview stays
  });

  it('a note with nothing beyond its path-title yields NO line (silence over noise)', () => {
    const res = noteLine(root, 'src/models.py', { note: base }, []);
    expect(res.line).toBe('');
  });
});

describe('kb commit — deliberate publish', () => {
  function git(args: string[], cwd: string): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  }
  function gitInit(): void {
    git(['init', '-q'], root);
    git(['config', 'user.email', 'kb@test'], root);
    git(['config', 'user.name', 'kb test'], root);
    fs.writeFileSync(path.join(root, 'README.md'), 'hi\n');
    git(['add', 'README.md'], root);
    git(['commit', '-qm', 'init'], root);
  }

  it('commits ONLY the notebook surface, leaving other staged work staged', () => {
    gitInit();
    appendRecord(root, {
      id: 'a-note', type: 'lesson', op: 'put', kind: 'absence', title: 'a rule', body: 'x',
    } as never);
    // unrelated staged work must survive untouched
    fs.writeFileSync(path.join(root, 'feature.ts'), 'export {}\n');
    git(['add', 'feature.ts'], root);

    const res = kbCommit(root, 'publish test');
    expect(res.kind).toBe('committed');
    const committed = git(['show', '--name-only', '--format='], root);
    expect(committed).toContain('.coldstart/notebook/.raw/a-note.jsonl');
    expect(committed).not.toContain('feature.ts');
    expect(git(['diff', '--cached', '--name-only'], root)).toContain('feature.ts'); // still staged

    // second run: nothing new to publish
    expect(kbCommit(root).kind).toBe('nothing');
  });

  it('a repo that gitignored the notebook gets "nothing to publish", never -f', () => {
    gitInit();
    fs.writeFileSync(path.join(root, '.gitignore'), '.coldstart/\n');
    appendRecord(root, {
      id: 'b-note', type: 'lesson', op: 'put', kind: 'absence', title: 'r', body: 'x',
    } as never);
    const res = kbCommit(root);
    expect(res.kind).toBe('nothing');
    expect(res.message).toContain('opted out');
  });

  it('outside a git repo: a clear error, no crash', () => {
    const res = kbCommit(root);
    expect(res.kind).toBe('error');
    expect(res.message).toContain('not a git repository');
  });
});
