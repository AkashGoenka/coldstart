/**
 * capture-trigger.test.ts — the v5 capture stack's pure pieces:
 * ignore matcher, evidence extractor tiers, trigger state machine.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// hooks/ modules are plain ESM — import them directly.
import { compileIgnore, loadIgnore, DEFAULT_IGNORES } from '../hooks/ignore.mjs';
import { extractEvidence, contentReadFiles, segmentStats } from '../hooks/evidence.mjs';
import { initialState, step, T_ARM, T_CAP } from '../hooks/trigger.mjs';
import { ensureColdstartignore } from '../src/init.js';
import { appendRecord } from '../src/kb/raw-log.js';
import { initSkeleton } from '../src/kb/store.js';
import { kbLint } from '../src/kb/lint.js';

// --- helpers -------------------------------------------------------------------

function assistantLine(blocks: object[]): string {
  return JSON.stringify({ type: 'assistant', message: { content: blocks } });
}
function resultLine(toolUseId: string, isError = false): string {
  return JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError }] },
  });
}
function toolUse(id: string, name: string, input: object): object {
  return { type: 'tool_use', id, name, input };
}

/** A throwaway repo dir so bash-token existence checks pass. */
function makeRepo(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'cs-evid-'));
  for (const f of files) {
    const full = join(root, f);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '// x\n');
  }
  return root;
}

// --- ignore matcher --------------------------------------------------------------

describe('ignore matcher', () => {
  const ignored = compileIgnore(DEFAULT_IGNORES);

  it('default-ignores data-shaped files at any depth', () => {
    expect(ignored('package.json')).toBe(true);
    expect(ignored('config/tsconfig.json')).toBe(true);
    expect(ignored('yarn.lock')).toBe(true);
    expect(ignored('sub/dir/pnpm-lock.yaml')).toBe(true);
    expect(ignored('dist/index.js')).toBe(true);
    expect(ignored('app/build/out.js')).toBe(true);
    expect(ignored('.env')).toBe(true);
    expect(ignored('.env.local')).toBe(true);
    expect(ignored('assets/logo.png')).toBe(true);
    expect(ignored('bundle.min.js')).toBe(true);
  });

  it('keeps logic-bearing configs IN (deliberately not defaulted)', () => {
    expect(ignored('vite.config.ts')).toBe(false);
    expect(ignored('.github/workflows/publish.yml')).toBe(false);
    expect(ignored('config/routes.rb')).toBe(false);
    expect(ignored('src/index.ts')).toBe(false);
  });

  it('negation re-includes and later lines win', () => {
    const m = compileIgnore([...DEFAULT_IGNORES, '!tsconfig.json', '*.yml']);
    expect(m('tsconfig.json')).toBe(false);
    expect(m('other.json')).toBe(true);
    expect(m('ci.yml')).toBe(true);
  });

  it('loadIgnore layers user file over defaults', () => {
    const root = makeRepo([]);
    mkdirSync(join(root, '.coldstart'), { recursive: true });
    writeFileSync(join(root, '.coldstart', '.coldstartignore'), '# mine\n*.generated.ts\n!package.json\n');
    const m = loadIgnore(root);
    expect(m('api.generated.ts')).toBe(true);
    expect(m('package.json')).toBe(false); // user negated a default
    expect(m('other.json')).toBe(true);
  });
});

// --- evidence tiers ---------------------------------------------------------------

describe('evidence extractor', () => {
  it('Read/Edit tools are content tiers; results must confirm', () => {
    const t = [
      assistantLine([toolUse('t1', 'Read', { file_path: '/repo/src/a.ts' })]),
      resultLine('t1'),
      assistantLine([toolUse('t2', 'Edit', { file_path: '/repo/src/b.ts' })]),
      resultLine('t2'),
      assistantLine([toolUse('t3', 'Read', { file_path: '/repo/src/gone.ts' })]),
      resultLine('t3', true), // errored: contributes nothing
      assistantLine([toolUse('t4', 'Read', { file_path: '/repo/src/pending.ts' })]),
      // no result at all: contributes nothing
    ].join('\n');
    const ev = extractEvidence(t, '/repo');
    expect(ev.get('src/a.ts')?.reads).toBe(1);
    expect(ev.get('src/b.ts')?.edits).toBe(1);
    expect(ev.has('src/gone.ts')).toBe(false);
    expect(ev.has('src/pending.ts')).toBe(false);
  });

  it('bash: read verbs are reads, grep/unknown verbs are mentions, sed -i is an edit', () => {
    const root = makeRepo(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
    const t = [
      assistantLine([toolUse('b1', 'Bash', { command: `cat src/a.ts | head -50` })]),
      resultLine('b1'),
      assistantLine([toolUse('b2', 'Bash', { command: `grep -rn "foo" src/b.ts` })]),
      resultLine('b2'),
      assistantLine([toolUse('b3', 'Bash', { command: `sed -i '' 's/x/y/' src/c.ts` })]),
      resultLine('b3'),
      assistantLine([toolUse('b4', 'Bash', { command: `node src/d.ts` })]),
      resultLine('b4'),
    ].join('\n');
    const ev = extractEvidence(t, root);
    expect(ev.get('src/a.ts')?.reads).toBe(1);
    expect(ev.get('src/b.ts')?.mentions).toBe(1);
    expect(ev.get('src/b.ts')?.reads).toBe(0);
    expect(ev.get('src/c.ts')?.edits).toBe(1);
    expect(ev.get('src/d.ts')?.mentions).toBe(1);
    // worklist = content tiers only
    const work = contentReadFiles(ev);
    expect(work).toContain('src/a.ts');
    expect(work).toContain('src/c.ts');
    expect(work).not.toContain('src/b.ts');
    expect(work).not.toContain('src/d.ts');
  });

  it('coldstart gs counts as a skim tier', () => {
    const root = makeRepo(['src/a.ts']);
    const t = [
      assistantLine([toolUse('g1', 'Bash', { command: `coldstart gs src/a.ts` })]),
      resultLine('g1'),
    ].join('\n');
    const ev = extractEvidence(t, root);
    expect(ev.get('src/a.ts')?.gs).toBe(1);
    expect(contentReadFiles(ev)).toContain('src/a.ts');
  });

  it('segmentStats flags prose-heavy tool-light synthesis', () => {
    const synth = assistantLine([{ type: 'text', text: 'x'.repeat(2000) }]);
    expect(segmentStats(synth).synthesis).toBe(true);
    const busy = [
      assistantLine([{ type: 'text', text: 'x'.repeat(2000) }, toolUse('a', 'Read', {}), toolUse('b', 'Read', {}), toolUse('c', 'Read', {})]),
    ].join('\n');
    expect(segmentStats(busy).synthesis).toBe(false);
  });
});

// --- trigger state machine ----------------------------------------------------------

function reads(...rels: string[]): Map<string, { reads: number; edits: number; gs: number }> {
  return new Map(rels.map((r) => [r, { reads: 1, edits: 0, gs: 0 }]));
}
const QUIET = { delta: new Map(), synthesis: false, freshNoted: new Set<string>(), headDrift: false };

describe('trigger', () => {
  it('never fires on the first stop, arms at T, fires on descent', () => {
    let s = initialState();
    // stop 1: 5 new files → active, score 5+1=6 < 10
    let r = step(s, { ...QUIET, delta: reads('a', 'b', 'c', 'd', 'e') });
    expect(r.decision).toBeNull();
    // stop 2: 4 more files → score 9+2=11 ≥ 10 → armed, but no descent yet
    r = step(r.state, { ...QUIET, delta: reads('f', 'g', 'h', 'i') });
    expect(r.decision).toBeNull();
    expect(r.state.armed).toBe(true);
    // stop 3: quiet
    r = step(r.state, QUIET);
    expect(r.decision).toBeNull();
    // stop 4: second quiet → DESCENT fire, non-blocking
    r = step(r.state, QUIET);
    expect(r.decision?.fire).toBe('descent');
    expect(r.decision?.mode).toBe('inject');
    expect(r.decision?.files.length).toBe(9);
    // post-fire: everything captured, disarmed
    expect(r.state.armed).toBe(false);
    r = step(r.state, QUIET);
    expect(r.decision).toBeNull();
  });

  it('surge fires when new files arrive after quiet while armed', () => {
    let s = initialState();
    let r = step(s, { ...QUIET, delta: reads('a', 'b', 'c', 'd', 'e') });
    r = step(r.state, { ...QUIET, delta: reads('f', 'g', 'h', 'i') }); // armed
    r = step(r.state, QUIET); // one quiet (descent needs two)
    r = step(r.state, { ...QUIET, delta: reads('x', 'y') }); // ≥2 new after quiet
    expect(r.decision?.fire).toBe('surge');
    expect(r.decision?.mode).toBe('inject');
  });

  it('fresh-noted files score nothing; editing one clears the discount', () => {
    let s = initialState();
    const freshNoted = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    let r = step(s, { ...QUIET, delta: reads(...freshNoted), freshNoted });
    r = step(r.state, { ...QUIET, delta: reads(), synthesis: true });
    r = step(r.state, QUIET);
    r = step(r.state, QUIET);
    expect(r.decision).toBeNull(); // all fresh → never armed, never fires
    // an edit to a fresh-noted file re-enters it
    const edit = new Map([['a', { reads: 0, edits: 1, gs: 0 }]]);
    r = step(r.state, { ...QUIET, delta: edit });
    expect(r.state.files['a'].fresh).toBe(false);
  });

  it('head drift fires instantly (block) with the ≥2-file floor', () => {
    let s = initialState();
    let r = step(s, { ...QUIET, delta: reads('a') });
    r = step(r.state, { ...QUIET, headDrift: true });
    expect(r.decision).toBeNull(); // 1 uncaptured file < floor
    r = step(r.state, { ...QUIET, delta: reads('b') });
    r = step(r.state, { ...QUIET, headDrift: true });
    expect(r.decision?.fire).toBe('head-drift');
    expect(r.decision?.mode).toBe('block');
  });

  it('cap rescues a long grind, non-blocking (dense sessions starve descent)', () => {
    let s = initialState();
    let r = step(s, { ...QUIET, delta: reads('a', 'b') });
    // grind: active synthesis stops pile up score without new files or quiet
    for (let i = 0; i < 40 && !r.decision; i++) {
      r = step(r.state, { ...QUIET, delta: reads(`f${i}`), synthesis: true });
    }
    expect(r.decision?.fire).toBe('cap');
    expect(r.decision?.mode).toBe('inject');
    expect(r.decision!.score).toBeGreaterThanOrEqual(T_CAP);
  });

  it('worklist ranks edited files first', () => {
    let s = initialState();
    const d = new Map([
      ['read-only.ts', { reads: 3, edits: 0, gs: 0 }],
      ['edited.ts', { reads: 1, edits: 2, gs: 0 }],
    ]);
    let r = step(s, { ...QUIET, delta: d });
    r = step(r.state, { ...QUIET, delta: reads('c', 'd', 'e', 'f', 'g', 'h', 'i') });
    r = step(r.state, QUIET);
    r = step(r.state, QUIET);
    expect(r.decision?.files[0]).toBe('edited.ts');
  });

  it('re-edit after capture re-enters the file', () => {
    let s = initialState();
    let r = step(s, { ...QUIET, delta: reads('a', 'b', 'c', 'd', 'e') });
    r = step(r.state, { ...QUIET, delta: reads('f', 'g', 'h', 'i') });
    r = step(r.state, QUIET);
    r = step(r.state, QUIET); // descent fire → all captured
    expect(r.decision?.fire).toBe('descent');
    const edit = new Map([['a', { reads: 0, edits: 1, gs: 0 }]]);
    r = step(r.state, { ...QUIET, delta: edit });
    expect(r.state.files['a'].captured).toBe(false);
  });

  it('T_ARM sanity: exported constants match the frozen spec', () => {
    expect(T_ARM).toBe(10);
    expect(T_CAP).toBe(20);
  });
});

// --- .coldstartignore scaffold + lint report ---------------------------------------

describe('coldstartignore wiring', () => {
  it('init scaffolds the template once in .coldstart/ and never touches user edits', () => {
    const root = makeRepo([]);
    expect(ensureColdstartignore(root)).toBe('created');
    const p = join(root, '.coldstart', '.coldstartignore');
    const scaffolded = readFileSync(p, 'utf8');
    expect(scaffolded).toContain('gitignore syntax');
    expect(loadIgnore(root)('package.json')).toBe(true); // comments-only template = defaults intact
    writeFileSync(p, '*.custom\n');
    expect(ensureColdstartignore(root)).toBe('kept');
    expect(readFileSync(p, 'utf8')).toBe('*.custom\n');
  });

  it('scaffold gitignores the ignore file itself (personal, even in shared notebooks)', () => {
    const root = makeRepo([]);
    ensureColdstartignore(root);
    const gi = readFileSync(join(root, '.coldstart', '.gitignore'), 'utf8');
    expect(gi.split('\n')).toContain('.coldstartignore');
    ensureColdstartignore(root); // idempotent — no duplicate line
    const again = readFileSync(join(root, '.coldstart', '.gitignore'), 'utf8');
    expect(again.split('\n').filter((l) => l === '.coldstartignore')).toHaveLength(1);
  });

  it('kb lint REPORTS a note anchored to an ignored file (never blocks the write)', async () => {
    const root = makeRepo(['package.json', 'src/real.ts']);
    initSkeleton(root);
    appendRecord(root, {
      id: 'json-leak', type: 'file', op: 'put',
      anchors: [{ path: 'package.json', symbols: [] }],
      summary: 'a note that should never have been written',
    } as Parameters<typeof appendRecord>[1]);
    appendRecord(root, {
      id: 'fine-note', type: 'file', op: 'put',
      anchors: [{ path: 'src/real.ts', symbols: [] }],
      summary: 'a legitimate note',
    } as Parameters<typeof appendRecord>[1]);
    const findings = await kbLint(root, null);
    const ignored = findings.filter((f) => f.check === 'ignored-anchor');
    expect(ignored).toHaveLength(1);
    expect(ignored[0].note).toBe('json-leak');
    expect(ignored[0].detail).toContain('package.json');
  });
});
