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

  it('path-name override: naming a note\'s anchor path injects it even when tokenization drops the path', async () => {
    // Calibrated regime, so the rarity gate is fully active — the override must
    // work independently of it.
    seedCorpus(35);
    touch('src/routing/urls.py');
    appendRecord(root, {
      id: 'urls-file', type: 'file', op: 'put', character: 'single',
      title: 'src/routing/urls.py', summary: 'The main URL router.',
      anchors: [{ path: 'src/routing/urls.py' }],
    } as never);

    // parseTerms drops the `/`-glued path and the 2-char extension, so the
    // path contributes no usable terms; the override surfaces it anyway.
    const named = await kbSearch(root, 'what does src/routing/urls.py actually do', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(named.hits.length).toBeGreaterThan(0);
    expect(named.hits[0].note.id).toBe('urls-file');

    // A bare path yields ZERO parseTerms terms — still resolves via the override.
    const bare = await kbSearch(root, 'src/routing/urls.py', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(bare.hits.length).toBeGreaterThan(0);
    expect(bare.hits[0].note.id).toBe('urls-file');

    // A prompt naming no path stays silent — no accidental squash graze.
    const nopath = await kbSearch(root, 'please clean up and refactor everything here', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(nopath.hits).toHaveLength(0);
  });
});

describe('inactive projection — notes whose anchored files are absent on this branch', () => {
  it('tool search keeps an absent-anchor note but flags it inactive (bottom tier); a live one is active', async () => {
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
    // 2 since staleness stopped being a tier — inactive/superseded/active only.
    expect(gone?.tier).toBe(2);
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

describe('rename overlay — a note follows a byte-exact move instead of going inactive', () => {
  function write(rel: string, content: string): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  // Minimal keeper-derived notes index carrying only a rename overlay.
  const idx = (renames: Record<string, { to: string }>) =>
    ({ v: 2, builtAt: 0, anchors: {}, absence: {}, renames }) as never;

  it('resolves a moved anchor to its new path (active, tier 0), re-verified live', async () => {
    write('src/orig.py', 'def zebra_unloader():\n    return 1\n');
    // verified → the append stamps the anchor hash from the live file bytes.
    appendRecord(root, {
      id: 'moved-note', type: 'file', op: 'put', character: 'single',
      title: 'ZebraUnloader handles staging', summary: 'unloader.',
      anchors: [{ path: 'src/orig.py', symbols: ['ZebraUnloader'] }],
      verified: ['src/orig.py'],
    } as never);
    // Refactor: identical bytes appear at a new path, the old one vanishes.
    write('src/moved.py', 'def zebra_unloader():\n    return 1\n');
    fs.rmSync(path.join(root, 'src/orig.py'));

    const res = await kbSearch(root, 'ZebraUnloader staging', {
      noMissLog: true, notesIndex: idx({ 'src/orig.py': { to: 'src/moved.py' } }),
    });
    const hit = res.hits.find((h) => h.note.id === 'moved-note');
    expect(hit).toBeTruthy();
    expect(hit?.inactive).toBe(false);
    expect(hit?.tier).toBe(0);
    expect(hit?.stamped[0].state).toBe('moved');
    expect(hit?.stamped[0].movedTo).toBe('src/moved.py');
  });

  it('guard: destination content differs from the recorded hash → stays inactive', async () => {
    write('src/orig.py', 'def zebra_unloader():\n    return 1\n');
    appendRecord(root, {
      id: 'moved-note', type: 'file', op: 'put', character: 'single',
      title: 'ZebraUnloader handles staging', summary: 'unloader.',
      anchors: [{ path: 'src/orig.py', symbols: ['ZebraUnloader'] }],
      verified: ['src/orig.py'],
    } as never);
    // The overlay points at a file whose content does NOT match (rename+edit).
    write('src/moved.py', 'def zebra_unloader():\n    return 2  # edited\n');
    fs.rmSync(path.join(root, 'src/orig.py'));

    const res = await kbSearch(root, 'ZebraUnloader staging', {
      noMissLog: true, notesIndex: idx({ 'src/orig.py': { to: 'src/moved.py' } }),
    });
    const hit = res.hits.find((h) => h.note.id === 'moved-note');
    expect(hit?.stamped[0].state).toBe('missing');
    expect(hit?.inactive).toBe(true);
  });

  it('recall (hook mode) keeps a moved note — its subject exists at the new path', async () => {
    write('src/orig.py', 'def zebra_unloader():\n    return 1\n');
    appendRecord(root, {
      id: 'moved-note', type: 'file', op: 'put', character: 'single',
      title: 'ZebraUnloader handles staging', summary: 'unloader.',
      anchors: [{ path: 'src/orig.py', symbols: ['ZebraUnloader'] }],
      verified: ['src/orig.py'],
    } as never);
    write('src/moved.py', 'def zebra_unloader():\n    return 1\n');
    fs.rmSync(path.join(root, 'src/orig.py'));

    const hook = await kbSearch(root, 'ZebraUnloader is dropping rows', {
      strongOnly: true, noMissLog: true, source: 'hook',
      notesIndex: idx({ 'src/orig.py': { to: 'src/moved.py' } }),
    });
    expect(hook.hits.some((h) => h.note.id === 'moved-note')).toBe(true);
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

/**
 * Matcher repairs (2026-07-29). Three defects found by replaying 238 logged
 * hook injections against the real notebook:
 *   - wordHit was a strict \b regex, so "fires" never reached a note titled
 *     "…capture fire";
 *   - the convergence signal was computed and used for the implant tier but
 *     never consulted by the suppression gate;
 *   - the symbol lookup that produces convergence was gated on isCodeShaped —
 *     a SPELLING test — so in a repo whose domain nouns are ordinary words it
 *     fired on 1 of 236 queries.
 */
describe('matcher repairs', () => {
  /** notesIndex stub: anchor path → declared symbol names. */
  function symbolIndex(anchors: Record<string, string[]>) {
    return { v: 2, anchors, renames: {}, absence: {} } as never;
  }

  it('stemming: a plural/tense query term reaches the singular authored title', async () => {
    seedCorpus(35);
    touch('hooks/trigger.mjs');
    appendRecord(root, {
      id: 'capture-fire-note', type: 'flow', op: 'put',
      title: 'how notebook capture fire works',
      summary: 'The trigger arms on volume and fires on descent.',
      anchors: [{ path: 'hooks/trigger.mjs', symbols: ['armTrigger'] }],
    } as never);

    for (const q of ['why does capture fires twice', 'why did capture fired twice', 'capture firing twice']) {
      const res = await kbSearch(root, q, { strongOnly: true, noMissLog: true, source: 'hook' });
      expect(res.hits.length, `query: ${q}`).toBeGreaterThan(0);
      expect(res.hits[0].note.id, `query: ${q}`).toBe('capture-fire-note');
    }
  });

  it('stemming does not merge unrelated words', async () => {
    seedCorpus(35);
    touch('src/billing/charge.ts');
    appendRecord(root, {
      id: 'charge-note', type: 'flow', op: 'put',
      title: 'how the charge pipeline settles',
      summary: 'Charges settle nightly.',
      anchors: [{ path: 'src/billing/charge.ts' }],
    } as never);
    // "charging" stems to the same root as "charge"; "chart" must not.
    // The query carries a SECOND term from the note's own title ("pipeline")
    // so this stays a test of stemming and not of HOOK_MIN_CARRIERS — one
    // ordinary word is deliberately not enough to inject. A stemming
    // regression is still caught: without it only "pipeline" carries, the hit
    // falls to a single prose carrier and drops out entirely.
    const ok = await kbSearch(root, 'the charging pipeline fails at night', { strongOnly: true, noMissLog: true, source: 'hook' });
    expect(ok.hits[0]?.note.id).toBe('charge-note');
    const no = await kbSearch(root, 'the chart is wrong', { strongOnly: true, noMissLog: true, source: 'hook' });
    expect(no.hits.find((h) => h.note.id === 'charge-note')).toBeUndefined();
  });

  it('one ordinary word is a graze; two carriers inject (HOOK_MIN_CARRIERS)', async () => {
    seedCorpus(35);
    touch('src/billing/refund.ts');
    appendRecord(root, {
      id: 'refund-note', type: 'file', op: 'put',
      title: 'how refunds settle overnight',
      summary: 'Refunds settle in the nightly batch.',
      anchors: [{ path: 'src/billing/refund.ts' }],
    } as never);
    // ONE plain-English carrier ("refunds" → the title) is a homonym far more
    // often than a topic match — measured 5% precise on 140 labeled injections.
    const one = await kbSearch(root, 'can you look at refunds today', { strongOnly: true, noMissLog: true, source: 'hook' });
    expect(one.hits.find((h) => h.note.id === 'refund-note')).toBeUndefined();
    // TWO independent carriers ("refunds" + "settle") clear the bar.
    const two = await kbSearch(root, 'how do refunds settle', { strongOnly: true, noMissLog: true, source: 'hook' });
    expect(two.hits[0]?.note.id).toBe('refund-note');
    // Tool mode is unaffected — the agent chose its own terms.
    const tool = await kbSearch(root, 'refunds', { noMissLog: true, source: 'tool' });
    expect(tool.hits.find((h) => h.note.id === 'refund-note')).toBeDefined();
  });

  it('excludeIds suppresses a repeat without promoting anything into its slot', async () => {
    seedCorpus(35);
    for (const [id, p, title] of [
      ['alpha-note', 'src/pay/alpha.ts', 'how the alpha ledger reconciles'],
      ['beta-note', 'src/pay/beta.ts', 'how the beta ledger reconciles'],
    ] as const) {
      touch(p);
      appendRecord(root, { id, type: 'file', op: 'put', title, summary: `${title}.`, anchors: [{ path: p }] } as never);
    }
    const q = 'how does the ledger reconciles';
    const base = await kbSearch(root, q, { strongOnly: true, noMissLog: true, source: 'hook' });
    expect(base.hits.length).toBeGreaterThan(1);

    // Excluding the top hit must SHRINK the page, leaving the rest in order —
    // never backfill a lower-ranked note into the freed slot.
    const ded = await kbSearch(root, q, {
      strongOnly: true, noMissLog: true, source: 'hook',
      excludeIds: new Set([base.hits[0].note.id]),
    });
    expect(ded.hits.map((h) => h.note.id)).toEqual(base.hits.slice(1).map((h) => h.note.id));

    // Everything already seen → inject nothing at all.
    const all = await kbSearch(root, q, {
      strongOnly: true, noMissLog: true, source: 'hook',
      excludeIds: new Set(base.hits.map((h) => h.note.id)),
    });
    expect(all.hits).toHaveLength(0);
  });

  it('convergence bypasses the suppression gate', async () => {
    // A common word (df above rareMax, so not "rare") that is nonetheless a
    // declared symbol in the note's own anchor file. Two channels agree →
    // it must inject rather than being suppressed as a graze.
    seedCorpus(35);
    touch('src/status.ts');
    appendRecord(root, {
      id: 'status-note', type: 'file', op: 'put',
      title: 'keeper status',
      summary: 'Renders keeper liveness and freshness.',
      anchors: [{ path: 'src/status.ts', symbols: ['renderStatus'] }],
    } as never);
    // Decoys mention "status" in their BODY only: enough to push df out of the
    // rare band, not enough to make them scorable hits (a plain word must
    // whole-word-match the name channel), so rank 0 stays the real note.
    for (let i = 0; i < 6; i++) {
      touch(`src/decoy/other_${i}.ts`);
      appendRecord(root, {
        id: `decoy-${i}`, type: 'file', op: 'put',
        title: `unrelated corner ${i}`,
        summary: `Decoy ${i} incidentally mentions status in prose.`,
        anchors: [{ path: `src/decoy/other_${i}.ts` }],
      } as never);
    }
    // Only "status" may carry — any other rare word would inject via the
    // rarity bypass and the test would prove nothing.
    const q = 'can you check status';
    const opts = { strongOnly: true, noMissLog: true, source: 'hook' as const };

    // Without the index there is no convergence signal → the gate suppresses.
    expect((await kbSearch(root, q, opts)).hits).toHaveLength(0);

    // With the index, "status" is a declared symbol token in the note's own
    // anchor file → convergence → the same query injects.
    const withIdx = await kbSearch(root, q, {
      ...opts, notesIndex: symbolIndex({ 'src/status.ts': ['renderStatus'] }),
    });
    expect(withIdx.hits.length).toBeGreaterThan(0);
    expect(withIdx.hits[0].note.id).toBe('status-note');
    expect(withIdx.hits[0].convergence).toBe(true);
  });

  it('convergence lookup: English words match whole tokens, not fragments', async () => {
    seedCorpus(35);
    touch('src/init.ts');
    appendRecord(root, {
      id: 'gitattributes-note', type: 'file', op: 'put',
      title: 'init writes the gitattributes entry',
      summary: 'Ensures the notebook diff driver is registered.',
      anchors: [{ path: 'src/init.ts', symbols: ['ensureGitattributes'] }],
    } as never);
    const notesIndex = symbolIndex({ 'src/init.ts': ['ensureGitattributes'] });
    const opts = { strongOnly: true, noMissLog: true, source: 'hook' as const, notesIndex };

    // "but" is a substring of ensureGitattri(but)es — the measured luck class.
    const luck = await kbSearch(root, 'gitattributes but not the driver', opts);
    const hit = luck.hits.find((h) => h.note.id === 'gitattributes-note');
    expect(hit?.carriers.some((c) => c.startsWith('but:'))).not.toBe(true);

    // A whole token still converges.
    const real = await kbSearch(root, 'where does init handle gitattributes', opts);
    expect(real.hits[0]?.note.id).toBe('gitattributes-note');
    expect(real.hits[0]?.convergence).toBe(true);
  });

  it('carriers record which term carried the hit and in which channel', async () => {
    seedCorpus(35);
    const res = await kbSearch(root, 'Widget7Loader fails to persist', {
      strongOnly: true, noMissLog: true, source: 'hook',
    });
    expect(res.hits[0].carriers.some((c) => c.toLowerCase().startsWith('widget7loader:'))).toBe(true);
  });
});
