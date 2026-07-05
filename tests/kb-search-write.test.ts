import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { kbSearch, renderSearchPage, renderCompactPage, shouldImplantTop } from '../src/kb/search.js';
import { kbWrite } from '../src/kb/write.js';
import { kbLint } from '../src/kb/lint.js';
import { hashFile } from '../src/kb/freshness.js';
import { appendRecord } from '../src/kb/raw-log.js';
import { buildKbNotesIndex } from '../src/kb/notes-index.js';
import type { CodebaseIndex } from '../src/types.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-kb-sw-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Minimal index stub — just what lane 2 (symbols/paths) and coverage need. */
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

function seedLesson(over: Record<string, unknown> = {}): void {
  appendRecord(root, {
    id: 'restore-drops-functions', type: 'lesson', op: 'put',
    kind: 'bug-cause',
    title: 'Version restore silently drops function assignments',
    aliases: ['functions disappear after graph restore'],
    body: 'restore_state never re-creates functions_x_graphs rows.',
    anchors: [{ path: 'app/models/graph.py', hash: 'sha256:000000000000' }],
    ...over,
  });
}

describe('kb search', () => {
  it('lane 1: symptom words hit via aliases; zero hits append to the miss-log', async () => {
    writeRepoFile('app/models/graph.py', 'class Graph: pass\n');
    seedLesson();
    const hit = await kbSearch(root, 'functions disappear after graph restore', {});
    expect(hit.hits).toHaveLength(1);
    expect(hit.hits[0].note.id).toBe('restore-drops-functions');

    const miss = await kbSearch(root, 'kubernetes ingress annotations', {});
    expect(miss.hits).toHaveLength(0);
    const missLog = fs.readFileSync(path.join(root, '.coldstart/notebook/.metrics/miss-log.jsonl'), 'utf8');
    expect(missLog).toContain('kubernetes');
  });

  it('stopwords and weak grazes: an unrelated prompt must not surface notes in hook mode', async () => {
    writeRepoFile('app/models/graph.py', 'class Graph: pass\n');
    seedLesson();
    // "the" survives parseTerms (>=3 chars) and appears in the note body — the
    // recall hook must not inject on glue words alone.
    const weak = await kbSearch(root, 'upgrade the dockerfile base image', { strongOnly: true, noMissLog: true });
    expect(weak.hits).toHaveLength(0);
    // ...but a real (name-channel) hit still passes strongOnly with one term
    const strong = await kbSearch(root, 'graph restore', { strongOnly: true, noMissLog: true });
    expect(strong.hits).toHaveLength(1);
  });

  it('strongOnly: several body-graze words still do not make a hit (long-prompt noise)', async () => {
    writeRepoFile('app/models/graph.py', 'class Graph: pass\n');
    seedLesson();
    // "rows" and "creates" both appear in the note BODY but nowhere in its
    // title/aliases/anchors — the arches phase-1 failure mode, where every
    // ~900-char benchmark prompt cleared a ≥2-covered-terms bar on shared
    // domain vocabulary and injected 3 unrelated notes per session.
    const graze = await kbSearch(root, 'which migration creates the identifier rows for a resource', { strongOnly: true, noMissLog: true });
    expect(graze.hits).toHaveLength(0);
    // the same query without strongOnly (explicit tool call) may match — the agent chose its terms
    const loose = await kbSearch(root, 'which migration creates the identifier rows for a resource', { noMissLog: true });
    expect(loose.hits.length).toBeGreaterThan(0);
  });

  it('strongOnly shape rule: English words need whole-word name hits; code-shaped terms substring-match', async () => {
    writeRepoFile('app/models/graph.py', 'class Graph: pass\n');
    seedLesson();
    appendRecord(root, { id: 'load-errors-note', type: 'flow', op: 'put', title: 'cascade-deletes LoadStaging/LoadErrors rows', summary: 'cascade path' });
    // "error" inside "LoadErrors" is an English-word/identifier collision, not a hit
    const english = await kbSearch(root, 'the worker crashed with a connection error', { strongOnly: true, noMissLog: true });
    expect(english.hits).toHaveLength(0);
    // ...but naming the identifier itself (code-shaped term) hits it
    const codeish = await kbSearch(root, 'why are LoadErrors rows deleted', { strongOnly: true, noMissLog: true });
    expect(codeish.hits.map((h) => h.note.id)).toContain('load-errors-note');
  });

  it('code-shape rule: sentence-initial "Add" is NOT code-shaped; interior caps like "AddAddress" ARE', async () => {
    appendRecord(root, {
      id: 'add-address-note',
      type: 'lesson',
      op: 'put',
      kind: 'trap',
      title: 'AddAddress utility for resolving user info',
      body: 'looks up addresses and resolves them',
    });

    // "Add" from "Add new functionality" is sentence-initial capital — NOT code-shaped.
    // Should NOT substring-match the title containing "AddAddress".
    // (The old regex would wrongly match "Add" as code-shaped, causing a false positive.)
    const sentenceInitial = await kbSearch(root, 'Add new functionality', { strongOnly: true, noMissLog: true });
    expect(sentenceInitial.hits).toHaveLength(0);

    // "AddAddress" has interior capitals — genuinely code-shaped.
    // Should substring-match the title.
    const codeShapedInterior = await kbSearch(root, 'AddAddress utility info', { strongOnly: true, noMissLog: true });
    expect(codeShapedInterior.hits.map((h) => h.note.id)).toContain('add-address-note');

    // "max_files" is code-shaped (underscore). Should substring-match the title.
    appendRecord(root, {
      id: 'max-files-note',
      type: 'flow',
      op: 'put',
      title: 'max_files configuration limits concurrent operations',
    });
    const codeShapedUnderscore = await kbSearch(root, 'how is max_files configured', { strongOnly: true, noMissLog: true });
    expect(codeShapedUnderscore.hits.map((h) => h.note.id)).toContain('max-files-note');
  });

  it('renderCompactPage: a sole hit passes the dominance gate and implants its FULL body', async () => {
    writeRepoFile('app/models/graph.py', 'class Graph: pass\n');
    seedLesson({
      body: 'restore_state never re-creates functions_x_graphs rows. '.repeat(30),
    });
    const res = await kbSearch(root, 'functions disappear after graph restore', { noMissLog: true });
    expect(shouldImplantTop(res)).toBe(true); // sole hit → dominance
    const page = renderCompactPage('functions disappear after graph restore', res);
    expect(page).toContain('## Version restore silently drops function assignments'); // full-note heading
    expect(page).toContain('id: restore-drops-functions');
    expect(page).toContain('restore_state never re-creates'); // body inlined, not clamped to a gist
    expect(page).toContain('app/models/graph.py'); // freshness line rides with the body
    // zero hits keeps the sentinel the hook's skip check looks for
    expect(renderCompactPage('nope', { hits: [], terms: [], warnings: [] })).toContain('No notebook notes match');
  });

  it('implant gate: two near-equal hits without convergence stay gist-only (no bodies)', async () => {
    writeRepoFile('app/a.py', 'pass\n');
    writeRepoFile('app/b.py', 'pass\n');
    appendRecord(root, {
      id: 'spatialview-restore-breaks', type: 'lesson', op: 'put', kind: 'trap',
      title: 'spatialview restore breaks silently',
      body: 'first note body.', anchors: [{ path: 'app/a.py' }],
    });
    appendRecord(root, {
      id: 'spatialview-restore-timeout', type: 'lesson', op: 'put', kind: 'trap',
      title: 'spatialview restore timeout on large graphs',
      body: 'second note body.', anchors: [{ path: 'app/b.py' }],
    });
    // filler corpus so the shared terms stay minority-df under strongOnly
    for (const t of ['auth cookie parsing', 'webpack bundle size', 'csv importer quoting']) {
      appendRecord(root, { id: t.replace(/ /g, '-'), type: 'lesson', op: 'put', kind: 'trap', title: t, body: t });
    }
    const res = await kbSearch(root, 'why does spatialview restore fail', { strongOnly: true, noMissLog: true });
    expect(res.hits.length).toBe(2);
    expect(res.hits[0].score).toBeLessThan(1.8 * res.hits[1].score); // near-equal → ambiguous
    expect(shouldImplantTop(res)).toBe(false);
    const page = renderCompactPage('why does spatialview restore fail', res);
    expect(page).not.toContain('## '); // no full-note section — scent trail only
    expect(page).not.toContain('id: spatialview-restore-breaks'); // implant header absent
    expect(page).toContain('- **spatialview restore breaks silently**');
    expect(page).toContain('- **spatialview restore timeout on large graphs**');
  });

  it('implant gate: symbol convergence (keeper notes index) opens the gate when dominance alone would not', async () => {
    writeRepoFile('app/models/graph.py', 'class TileHelperRegistry: pass\n');
    writeRepoFile('app/graph_utils.py', 'pass\n');
    // The top note names the symbol ITSELF (own-text match); the inventory
    // confirming it's declared in the note's anchor = the second channel.
    appendRecord(root, {
      id: 'graph-restore-note', type: 'lesson', op: 'put', kind: 'trap',
      title: 'TileHelperRegistry graph restore drops rows',
      body: 'anchored where the symbol lives.', anchors: [{ path: 'app/models/graph.py' }],
    });
    appendRecord(root, {
      id: 'graph-restore-perf', type: 'lesson', op: 'put', kind: 'trap',
      title: 'graph restore perf cliff',
      body: 'a competing note.', anchors: [{ path: 'app/graph_utils.py' }],
    });
    for (const t of ['auth cookie parsing', 'webpack bundle size', 'csv importer quoting']) {
      appendRecord(root, { id: t.replace(/ /g, '-'), type: 'lesson', op: 'put', kind: 'trap', title: t, body: t });
    }
    const notesIndex = await buildKbNotesIndex(fakeIndex({
      'app/models/graph.py': ['TileHelperRegistry'], 'app/graph_utils.py': [],
    }), root);
    const res = await kbSearch(root, 'TileHelperRegistry graph restore', { strongOnly: true, notesIndex, noMissLog: true });
    expect(res.hits[0].note.id).toBe('graph-restore-note');
    expect(res.hits.length).toBe(2);
    expect(res.hits[0].score).toBeLessThan(1.8 * res.hits[1].score); // dominance alone would NOT implant
    expect(res.hits[0].convergence).toBe(true); // code index agrees with the text match
    expect(shouldImplantTop(res)).toBe(true);
    // without the notes index the same query has no convergence channel → gate stays shut
    const blind = await kbSearch(root, 'TileHelperRegistry graph restore', { strongOnly: true, noMissLog: true });
    expect(blind.hits[0].convergence).toBe(false);
    expect(shouldImplantTop(blind)).toBe(false);
  });

  it('lane 2: a symbol name resolves via the keeper notes index to the anchored note', async () => {
    writeRepoFile('app/models/graph.py', 'def restore_state(): pass\n');
    // The note itself never mentions "TileHelper" — only the keeper's
    // per-anchor inventory knows the symbol is declared in graph.py.
    appendRecord(root, {
      id: 'graph-file-note', type: 'file', op: 'put',
      summary: 'ORM for graphs.',
      anchors: [{ path: 'app/models/graph.py' }],
    });
    const notesIndex = await buildKbNotesIndex(fakeIndex({ 'app/models/graph.py': ['TileHelperRegistry'] }), root);
    expect(notesIndex.anchors['app/models/graph.py']).toEqual(['TileHelperRegistry']);
    const withKb = await kbSearch(root, 'TileHelperRegistry', { notesIndex });
    expect(withKb.hits.map((h) => h.note.id)).toContain('graph-file-note');
    // hook mode (no notes index) cannot make that resolution
    const withoutKb = await kbSearch(root, 'TileHelperRegistry', {});
    expect(withoutKb.hits).toHaveLength(0);
  });

  it('tiers: active+fresh outranks stale outranks superseded — as a hard tier', async () => {
    writeRepoFile('src/fresh.ts', 'stable\n');
    writeRepoFile('src/stale.ts', 'v1\n');
    const freshHash = hashFile(root, 'src/fresh.ts');
    const oldHash = hashFile(root, 'src/stale.ts');
    fs.writeFileSync(path.join(root, 'src/stale.ts'), 'v2 drifted\n');

    appendRecord(root, { id: 'stale-note', type: 'lesson', op: 'put', kind: 'trap', title: 'shared topic alpha beta', body: 'alpha beta gamma delta', anchors: [{ path: 'src/stale.ts', hash: oldHash }] });
    appendRecord(root, { id: 'fresh-note', type: 'lesson', op: 'put', kind: 'trap', title: 'shared topic alpha', body: 'alpha', anchors: [{ path: 'src/fresh.ts', hash: freshHash }] });
    appendRecord(root, { id: 'dead-note', type: 'lesson', op: 'put', kind: 'trap', title: 'shared topic alpha beta gamma', body: 'alpha beta gamma' });
    appendRecord(root, { id: 'dead-note', type: 'lesson', op: 'supersede', by: 'fresh-note' });

    const { hits } = await kbSearch(root, 'shared topic alpha', { maxResults: 10 });
    expect(hits.map((h) => h.note.id)).toEqual(['fresh-note', 'stale-note', 'dead-note']);
    const page = renderSearchPage(root, 'shared topic alpha', { hits, terms: [], warnings: [] });
    expect(page).toContain('[evidence changed: src/stale.ts]');
    expect(page).toContain('superseded by: fresh-note');
  });

  it('absence notes print the keeper stamp; the keeper re-run flips it to STALE', async () => {
    writeRepoFile('src/main.ts', 'nothing to see\n');
    appendRecord(root, {
      id: 'no-rate-limiting', type: 'lesson', op: 'put', kind: 'absence',
      title: 'There is no rate limiting anywhere',
      body: 'Searched for rate limit middleware; none exists.',
      scope: { terms: ['ratelimit_middleware'] },
    });
    const index = fakeIndex({ 'src/main.ts': [] });
    const holdsKb = await buildKbNotesIndex(index, root);
    const holds = await kbSearch(root, 'rate limiting', { notesIndex: holdsKb });
    expect(holds.hits[0].absence).toContain('absence holds');

    // the absence becomes stale on the keeper's NEXT re-stamp after matching code appears
    writeRepoFile('src/main.ts', 'export function ratelimit_middleware() {}\n');
    const staleKb = await buildKbNotesIndex(index, root);
    const stale = await kbSearch(root, 'rate limiting', { notesIndex: staleKb });
    expect(stale.hits[0].absence).toContain('absence STALE');
    expect(stale.hits[0].absence).toContain('src/main.ts');

    // a stamp whose terms no longer match the note is ignored, not trusted
    const wrongTerms = { ...staleKb, absence: { 'no-rate-limiting': { terms: ['old_term'], matches: [], checkedAt: 1 } } };
    const drifted = await kbSearch(root, 'rate limiting', { notesIndex: wrongTerms });
    expect(drifted.hits[0].absence).toContain('not re-verified');

    const unverified = await kbSearch(root, 'rate limiting', {});
    expect(unverified.hits[0].absence).toContain('not re-verified');
  });
});

describe('kb write — two-phase gate', () => {
  it('a new flow with a near-duplicate concept returns candidates; --into merges; --new coins', async () => {
    writeRepoFile('src/auth.ts', 'export function mint() {}\n');
    const first = await kbWrite(root, {
      type: 'flow', title: 'Auth token refresh flow',
      summary: 'How tokens refresh.',
      steps: [{ path: 'src/auth.ts', role: 'mints' }],
      verified: ['src/auth.ts'],
    });
    expect(first.status).toBe('written');
    const firstId = (first as { id: string }).id;
    expect(firstId).toBe('auth-token-refresh-flow');

    // same concept, differently worded → gate catches it
    const dup = await kbWrite(root, { type: 'flow', title: 'token refresh (auth)', summary: 'refresh of auth tokens' });
    expect(dup.status).toBe('candidates');
    expect((dup as { candidates: { id: string }[] }).candidates.map((c) => c.id)).toContain(firstId);

    // phase 2a: merge into the existing concept
    const merged = await kbWrite(root, { type: 'flow', title: 'token refresh (auth)', invariants: ['refresh TTL > access TTL'] }, { into: firstId });
    expect(merged.status).toBe('written');
    expect((merged as { id: string }).id).toBe(firstId);

    // phase 2b: explicitly a new concept
    const fresh = await kbWrite(root, { type: 'flow', title: 'token refresh (auth)', summary: 'genuinely different' }, { isNew: true });
    expect(fresh.status).toBe('written');
    expect((fresh as { id: string }).id).not.toBe(firstId);

    // a genuinely new concept passes with no gate friction
    const unrelated = await kbWrite(root, { type: 'flow', title: 'CSV export pipeline', summary: 'export rows to CSV', steps: [{ path: 'src/auth.ts', role: 'x' }] });
    expect(unrelated.status).toBe('written');
  });

  it('file notes derive their id from the path, anchor to it, and count it verified', async () => {
    writeRepoFile('src/kb/fold.ts', 'export function fold() {}\n');
    const res = await kbWrite(root, { type: 'file', path: 'src/kb/fold.ts', summary: 'the fold' });
    expect(res.status).toBe('written');
    const raw = fs.readFileSync(path.join(root, '.coldstart/notebook/.raw', `${(res as { id: string }).id}.jsonl`), 'utf8');
    const rec = JSON.parse(raw.trim());
    expect(rec.anchors[0].path).toBe('src/kb/fold.ts');
    expect(rec.anchors[0].hash).toMatch(/^sha256:/);
    // same path again → same id, same log (update, not duplicate)
    const again = await kbWrite(root, { type: 'file', path: 'src/kb/fold.ts', summary: 'updated' });
    expect((again as { id: string }).id).toBe((res as { id: string }).id);
  });

  it('validates specs with actionable errors; supports retract/supersede ops', async () => {
    expect((await kbWrite(root, { title: 'no type' })).status).toBe('error');
    expect(((await kbWrite(root, { type: 'lesson', title: 'no kind', body: 'x' })) as { message: string }).message).toContain('kind');
    expect(((await kbWrite(root, { type: 'lesson', kind: 'absence', title: 'a', body: 'b' })) as { message: string }).message).toContain('scope.terms');
    expect((await kbWrite(root, { type: 'file', summary: 'no path' })).status).toBe('error');
    expect((await kbWrite(root, { type: 'flow', op: 'retract', id: 'nope', target: { kind: 'note' } })).status).toBe('error'); // no such note

    seedLesson();
    const retract = await kbWrite(root, { type: 'lesson', op: 'retract', id: 'restore-drops-functions', target: { kind: 'note' } });
    expect(retract.status).toBe('written');
    const gone = await kbSearch(root, 'functions disappear after graph restore', { maxResults: 5 });
    expect(gone.hits[0]?.note.status).toBe('retracted');
  });
});

describe('kb lint', () => {
  it('flags dead anchors, duplicate flows (anchor-set overlap), and orphans', async () => {
    writeRepoFile('src/a.ts', 'a\n');
    writeRepoFile('src/b.ts', 'b\n');
    appendRecord(root, { id: 'flow-one', type: 'flow', op: 'put', title: 'Flow one', anchors: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] });
    appendRecord(root, { id: 'flow-two', type: 'flow', op: 'put', title: 'Flow two', anchors: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] });
    appendRecord(root, { id: 'dead-anchor-note', type: 'lesson', op: 'put', kind: 'trap', title: 'points at nothing', body: 'x', anchors: [{ path: 'src/deleted.ts' }] });
    // a file note that references flow-one keeps it un-orphaned
    appendRecord(root, { id: 'a-file', type: 'file', op: 'put', summary: 's', anchors: [{ path: 'src/a.ts' }], features: [{ concept_id: 'flow-one', role: 'start' }] });

    const findings = await kbLint(root);
    const checks = findings.map((f) => `${f.check}:${f.note}`);
    expect(checks).toContain('dead-anchor:dead-anchor-note');
    expect(findings.some((f) => f.check === 'duplicate-flows' && f.detail.includes('flow-two'))).toBe(true);
    expect(checks).toContain('orphan:flow-two');
    expect(checks).toContain('orphan:dead-anchor-note');
    expect(checks).not.toContain('orphan:flow-one');
  });
});
