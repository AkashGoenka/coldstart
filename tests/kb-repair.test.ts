/**
 * `kb repair` surfaces notes that are written but unfindable. `planRepairs`
 * itself never writes; the one exception is `mechanicalSymbolRepair`, tested
 * separately below, which fills anchor symbols only (fully derivable data, not
 * a judgment call — see repair.ts's header for why that's the one field this
 * file is allowed to fix mechanically).
 *
 * The rules under test are the ones that make it safe to run on a real notebook:
 * it reports only genuine gaps, it points the agent at the right files, and a
 * clean notebook produces one line and no worklist (so the slash command fires
 * no agent prompt when there is nothing to do).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOTE_CHECKS } from '../hooks/note-shape.mjs';
import { planRepairs, repairWorklist, mechanicalSymbolRepair, SYMBOL_BACKFILL_CAP } from '../src/kb/repair.js';
import { kbWrite } from '../src/kb/write.js';
import { initSkeleton, notebookDir } from '../src/kb/store.js';
import { saveKbNotesIndex } from '../src/kb/notes-index.js';
import type { KbNotesIndex } from '../src/kb/notes-index.js';

let root: string;
let cacheDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-repair-'));
  cacheDir = mkdtempSync(join(tmpdir(), 'kb-repair-cache-'));
  initSkeleton(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});

/** A minimal sidecar, written directly (no real code index needed to test the
 *  repair-side consumer of it). */
async function seedSidecar(anchors: Record<string, string[]>): Promise<void> {
  const kb: KbNotesIndex = { v: 2, builtAt: Date.now(), anchors, absence: {}, renames: {} };
  await saveKbNotesIndex(root, kb, cacheDir);
}

/** Every raw log, so a test can prove repair did not append to any of them. */
function rawSnapshot(): string {
  const dir = join(notebookDir(root), '.raw');
  return readdirSync(dir).sort().map((f) => `${f}:${readFileSync(join(dir, f), 'utf8')}`).join('\n');
}

const complete = {
  type: 'file-single', path: 'src/done.ts', summary: 'does the thing',
  identityAliases: ['the thing'], anchors: [{ path: 'src/done.ts', symbols: ['doThing'] }],
} as never;

describe('kb repair — detection', () => {
  it('says so plainly when there is nothing to repair, and lists no findings', async () => {
    await kbWrite(root, complete, { force: true });

    const report = planRepairs(root);
    expect(report.findings).toEqual([]);
    expect(repairWorklist(report)).toBe('Nothing to repair here.');
  });

  it('flags a file note with no aliases and no anchor symbols', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });

    const checks = planRepairs(root).findings.map((f) => f.check);
    expect(checks).toContain('missing-identity-aliases');
    expect(checks).toContain('file-no-symbols');
  });

  it('counts a hub note\'s facet symbols as symbols — the fold unions them into the anchor', async () => {
    await kbWrite(root, {
      type: 'file-hub', path: 'src/hub.ts', identityAliases: ['grab bag'],
      facets: [{ symbol: 'alpha', detail: 'the non-obvious thing' }],
    } as never, { force: true });

    expect(planRepairs(root).findings).toEqual([]);
  });

  it('flags step files a flow is not filed at, and names exactly those paths', async () => {
    await kbWrite(root, {
      type: 'flow', title: 'how X happens', identityAliases: ['x happening'], summary: 'the product fact',
      steps: [{ path: 'src/a.ts', role: 'entry' }, { path: 'src/b.ts', role: 'middle' },
        { path: 'src/c.ts', role: 'end' }],
      verified: ['src/a.ts'],
    } as never, { force: true, isNew: true });

    const f = planRepairs(root).findings.find((x) => x.check === 'flow-steps-unanchored')!;
    expect(f).toBeDefined();
    // Only the unfiled ones; src/a.ts is verified so it IS an anchor.
    expect(f.fix).toContain('src/b.ts');
    expect(f.fix).toContain('src/c.ts');
    expect(f.fix).not.toContain('src/a.ts');
    // The agent needs the whole chain to judge, so `paths` stays complete.
    expect(f.paths).toContain('src/a.ts');
  });

  it('is silent on a flow whose verified list covers every step', async () => {
    await kbWrite(root, {
      type: 'flow', title: 'fully filed', identityAliases: ['filed'], summary: 'the fact',
      steps: [{ path: 'src/a.ts', role: 'entry' }, { path: 'src/b.ts', role: 'end' }],
      verified: ['src/a.ts', 'src/b.ts'],
    } as never, { force: true, isNew: true });

    expect(planRepairs(root).findings.map((f) => f.check)).not.toContain('flow-steps-unanchored');
  });

  it('never asks a lesson for aliases — its scope terms are the retrieval surface', async () => {
    await kbWrite(root, {
      type: 'lesson', kind: 'absence', title: 'no retry logic here', body: 'looked, absent',
      scope: { terms: ['retry', 'backoff'] },
    } as never, { force: true, isNew: true });

    expect(planRepairs(root).findings).toEqual([]);
  });

  it('flags a lesson whose scope terms are gone — reachable by its exact title and nothing else', () => {
    // Not writable through kbWrite (it rejects an absence lesson with no
    // scope.terms), which is the point: this check exists for notes ALREADY on
    // disk from before that validation, so it is exercised against the folded
    // shape directly.
    const check = NOTE_CHECKS.find((c) => c.check === 'missing-scope-terms')!;
    expect(check.noteTypes).toEqual(['lesson']);
    expect(check.missingInNote({ id: 'x', type: 'lesson', scope: { terms: [] } })).toBe(true);
    expect(check.missingInNote({ id: 'x', type: 'lesson', scope: { terms: ['retry'] } })).toBe(false);
  });

  it('ignores retracted notes — a withdrawn claim does not need to be findable', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });
    const id = planRepairs(root).findings[0].note;
    await kbWrite(root, {
      op: 'retract', type: 'file', path: 'src/a.ts', id, reason: 'wrong',
      target: { kind: 'note' },
    } as never, { force: true });

    expect(planRepairs(root).findings).toEqual([]);
  });
});

describe('kb repair — the worklist', () => {
  it('writes nothing: the raw logs are byte-identical after planning and rendering', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });
    const before = rawSnapshot();

    repairWorklist(planRepairs(root));

    expect(rawSnapshot()).toBe(before);
  });

  it('hands the agent an id-carrying fix spec, so a repair merges instead of forking a note', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });
    const f = planRepairs(root).findings[0];

    expect(f.fix).toContain(`"id":"${f.note}"`);
    expect(JSON.parse(f.fix).id).toBe(f.note);
  });

  it('points at the note file and the repo files, and groups by check', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });
    const page = repairWorklist(planRepairs(root));

    expect(page).toContain('## missing-identity-aliases');
    expect(page).toContain('## file-no-symbols');
    expect(page).toContain('.coldstart/notebook/notes/');
    expect(page).toContain('src/a.ts');
    // It must say out loud that fixing is the agent's job, on every surface.
    expect(page).toContain('kb write');
  });
});

describe('mechanicalSymbolRepair — the one mechanical exception', () => {
  it('backfills a single-character note\'s empty anchor symbols from the sidecar', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });
    await seedSidecar({ 'src/a.ts': ['doThing', 'DoThingOptions'] });

    const res = await mechanicalSymbolRepair(root, cacheDir);
    expect(res.fixed).toHaveLength(1);
    expect(res.fixed[0].note).toMatch(/^src-a-ts-/);
    expect(res.fixed[0].path).toBe('src/a.ts');
    expect(res.fixed[0].symbols).toEqual(['doThing', 'DoThingOptions']);

    const after = planRepairs(root);
    expect(after.findings.map((f) => f.check)).not.toContain('file-no-symbols');
  });

  it('never touches a hub note — facets stay agent-curated', async () => {
    await kbWrite(root, {
      type: 'file-hub', path: 'src/hub.ts', identityAliases: ['grab bag'],
      facets: [{ symbol: 'alpha', detail: 'the thing' }],
    } as never, { force: true });
    await seedSidecar({ 'src/hub.ts': ['alpha', 'beta', 'gamma'] });

    const res = await mechanicalSymbolRepair(root, cacheDir);
    expect(res.fixed).toEqual([]);
  });

  it('never overrides symbols a note already carries, even a partial set', async () => {
    await kbWrite(root, {
      type: 'file-single', path: 'src/a.ts', summary: 's',
      anchors: [{ path: 'src/a.ts', symbols: ['curatedOne'] }],
    } as never, { force: true });
    await seedSidecar({ 'src/a.ts': ['curatedOne', 'declaredTwo', 'declaredThree'] });

    const res = await mechanicalSymbolRepair(root, cacheDir);
    expect(res.fixed).toEqual([]);
  });

  it('leaves a path the sidecar has no data for as an agent-facing finding', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.css', summary: 's' } as never, { force: true });
    await seedSidecar({ 'src/a.css': [] }); // indexed, genuinely declares nothing

    const res = await mechanicalSymbolRepair(root, cacheDir);
    expect(res.fixed).toEqual([]);
    expect(planRepairs(root).findings.map((f) => f.check)).toContain('file-no-symbols');
  });

  it('degrades to a no-op when the keeper never ran (no sidecar) — repair still works without it', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });
    // no seedSidecar call — cacheDir has nothing in it.
    const res = await mechanicalSymbolRepair(root, cacheDir);
    expect(res.fixed).toEqual([]);
  });

  it('caps at SYMBOL_BACKFILL_CAP — a file this size is probably hub-shaped even if mislabeled', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });
    const many = Array.from({ length: SYMBOL_BACKFILL_CAP + 10 }, (_, i) => `sym${i}`);
    await seedSidecar({ 'src/a.ts': many });

    const res = await mechanicalSymbolRepair(root, cacheDir);
    expect(res.fixed[0].symbols).toHaveLength(SYMBOL_BACKFILL_CAP);
    expect(res.fixed[0].symbols).toEqual(many.slice(0, SYMBOL_BACKFILL_CAP));
  });
});
