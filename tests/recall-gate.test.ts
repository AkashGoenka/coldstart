/**
 * The learned recall gate (hooks/recall-gate.mjs) — everything except the
 * model itself. The weights were fitted offline on exactly these query texts
 * and session facts, so the transcript parsing and feature rules are pinned
 * here; a silent drift would make the fitted params meaningless. (End-to-end
 * parity with the pilot was checked once on all 200 v3 prompts: query text,
 * facts and inject decision 200/200.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { appendRecord } from '../src/kb/raw-log.js';
import { kbSearch } from '../src/kb/search.js';
import { renderIds } from '../src/kb/store.js';
import {
  parseTranscript, buildQuery, sessionFacts, gateProbability, runGate, readActiveNotes, cleanBody, PARAMS,
} from '../hooks/recall-gate.mjs';

const ROOT = '/repo';
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const user = (ts: string, text: string) => line({ type: 'user', timestamp: ts, isSidechain: false, message: { role: 'user', content: [{ type: 'text', text }] } });
const asst = (ts: string, content: unknown[]) => line({ type: 'assistant', timestamp: ts, isSidechain: false, message: { role: 'assistant', content } });
const read = (p: string) => ({ type: 'tool_use', name: 'Read', input: { file_path: p } });

const TRANSCRIPT = [
  user('2026-01-01T00:00:01Z', 'fix the keeper spawn lock'),
  line({ type: 'attachment', timestamp: '2026-01-01T00:00:02Z', attachment: { type: 'hook_additional_context', content: ['→ open: .coldstart/notebook/notes/keeper-ts-1.md'] } }),
  asst('2026-01-01T00:00:03Z', [{ type: 'text', text: 'Looking at the keeper.' }, read('/repo/src/keeper.ts')]),
  line({ type: 'user', timestamp: '2026-01-01T00:00:04Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
  asst('2026-01-01T00:00:05Z', [read('/repo/.coldstart/notebook/notes/keeper-ts-1.md'), read('/elsewhere/x.ts')]),
  user('2026-01-01T00:00:06Z', '<command-name>/compact</command-name>'),
  line({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-01-01T00:00:07Z' }),
  user('2026-01-01T00:00:08Z', 'This session is being continued from a previous conversation …'),
  user('2026-01-01T00:00:09Z', '<system-reminder>noise</system-reminder>now check the watcher'),
  asst('2026-01-01T00:00:10Z', [{ type: 'text', text: 'The watcher debounces.' }, read('/repo/src/watcher.ts')]),
].join('\n');

describe('parseTranscript', () => {
  const tx = parseTranscript(TRANSCRIPT, ROOT);

  it('keeps only prompts the human typed, with their text replies', () => {
    expect(tx.turns.map((t: any) => t.prompt)).toEqual(['fix the keeper spawn lock', 'now check the watcher']);
    expect(tx.turns[0].reply).toBe('Looking at the keeper.');
  });

  it('records compaction, shown, opened and repo-file events (other repos ignored)', () => {
    expect(tx.events.map((e: any) => `${e.kind}:${e.v ?? ''}`)).toEqual([
      'shown:keeper-ts-1', 'file:src/keeper.ts', 'opened:keeper-ts-1', 'compact:', 'file:src/watcher.ts',
    ]);
  });

  it('beforeTs cuts the stream for replay', () => {
    const cut = parseTranscript(TRANSCRIPT, ROOT, '2026-01-01T00:00:06Z');
    expect(cut.turns).toHaveLength(1);
    expect(cut.events.some((e: any) => e.kind === 'compact')).toBe(false);
  });
});

describe('buildQuery (the pilot H1 format)', () => {
  it('prior exchange then the prompt, dev:/agent: lines', () => {
    const q = buildQuery('next step', [{ ts: 't', prompt: 'first ask', reply: 'did it' }]);
    expect(q).toBe('dev: first ask\nagent: did it\ndev: next step');
  });

  it('skips a prior turn that repeats this prompt, and clips head+tail', () => {
    const long = 'a'.repeat(300);
    const q = buildQuery('same', [{ ts: 't1', prompt: long, reply: 'r' }, { ts: 't2', prompt: 'same', reply: 'x' }]);
    expect(q.split('\n')[0]).toBe(`dev: ${'a'.repeat(200)} […] ${'a'.repeat(80)}`);
    expect(q.endsWith('dev: same')).toBe(true);
  });

  it('first prompt of a session is just the prompt', () => {
    expect(buildQuery('hello', [])).toBe('dev: hello');
  });
});

describe('sessionFacts', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-gate-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const note = { id: 'keeper-ts-1', file: 'keeper-ts-1', anchors: ['src/keeper.ts'] };

  it('facts before a compaction do not count after it', () => {
    const f = sessionFacts(parseTranscript(TRANSCRIPT, ROOT), note, root, '2026-01-01T00:00:11Z');
    expect(f).toEqual({ shown: 0, opened: 0, written: 0, since: Math.log1p(1), justComp: 0, files: 0 });
  });

  it('before the compaction: shown, opened and files are all set', () => {
    const tx = parseTranscript(TRANSCRIPT, ROOT, '2026-01-01T00:00:06Z');
    const f = sessionFacts(tx, note, root, '2026-01-01T00:00:06Z');
    expect(f).toMatchObject({ shown: 1, opened: 1, files: 1, since: Math.log1p(1), justComp: 0 });
  });

  it('justComp = first prompt after a compaction', () => {
    const tx = parseTranscript(TRANSCRIPT, ROOT, '2026-01-01T00:00:09Z');
    expect(sessionFacts(tx, note, root, '2026-01-01T00:00:09Z').justComp).toBe(1);
  });

  it('written = note created in this session with no compaction since', () => {
    const raw = path.join(root, '.coldstart', 'notebook', '.raw');
    fs.mkdirSync(raw, { recursive: true });
    fs.writeFileSync(path.join(raw, 'keeper-ts-1.jsonl'), line({ ts: '2026-01-01T00:00:03Z' }) + '\n');
    const before = parseTranscript(TRANSCRIPT, ROOT, '2026-01-01T00:00:06Z');
    expect(sessionFacts(before, note, root, '2026-01-01T00:00:06Z').written).toBe(1);
    expect(sessionFacts(parseTranscript(TRANSCRIPT, ROOT), note, root, '2026-01-01T00:00:11Z').written).toBe(0);
  });
});

describe('gateProbability', () => {
  const base = { top: 0.74, shown: 0, opened: 0, written: 0, since: 1.9, justComp: 0, files: 0 };
  it('rises with the top score and with files touched, falls with prompts since compaction', () => {
    expect(gateProbability({ ...base, top: 0.82 })).toBeGreaterThan(gateProbability(base));
    expect(gateProbability({ ...base, files: 1 })).toBeGreaterThan(gateProbability(base));
    expect(gateProbability({ ...base, since: 3 })).toBeLessThan(gateProbability(base));
  });
  it('params are the fitted q4 / notes-centred set', () => {
    expect(PARAMS.features).toEqual(['top', 'shown', 'opened', 'written', 'since', 'justComp', 'files']);
    expect(PARAMS.cutoffP).toBeGreaterThan(0);
    expect(PARAMS.model).toMatch(/q4/);
  });
});

describe('gate notes + rendering', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-gate-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    for (const n of ['a', 'b', 'c']) {
      fs.writeFileSync(path.join(root, `src/${n}.ts`), `export const ${n} = 1;\n`);
      appendRecord(root, { id: `note-${n}`, type: 'lesson', op: 'put', kind: 'gotcha', title: `About ${n}`, body: `Body of ${n}, see \`src/${n}.ts\` — here.`, anchors: [{ path: `src/${n}.ts`, hash: 'sha256:000000000000' }] });
    }
    renderIds(root); // the gate reads the rendered md, as kb write leaves it
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('readActiveNotes reads id, anchors and the cleaned text', () => {
    const notes = readActiveNotes(root);
    expect(notes.map((n: any) => n.id).sort()).toEqual(['note-a', 'note-b', 'note-c']);
    const a = notes.find((n: any) => n.id === 'note-a');
    expect(a.anchors).toEqual(['src/a.ts']);
    expect(a.text).not.toContain('src/a.ts');
  });

  it('cleanBody drops Part-of links, wikilinks and backticked paths', () => {
    expect(cleanBody('x `src/a.ts` — y [[other]]\n## Part of\n- [[z]]\n## Next\nk')).toBe('x y \n\n## Next\nk');
  });

  it('kbSearch pickIds returns exactly the picks in order, deduped without backfill', async () => {
    const r = await kbSearch(root, 'anything at all', { strongOnly: true, maxResults: 3, pickIds: ['note-c', 'note-a', 'missing'] });
    expect(r.hits.map((h) => h.note.id)).toEqual(['note-c', 'note-a']);
    const d = await kbSearch(root, 'q', { strongOnly: true, maxResults: 3, pickIds: ['note-c', 'note-a'], excludeIds: new Set(['note-c']) });
    expect(d.hits.map((h) => h.note.id)).toEqual(['note-a']);
  });

  it('runGate is unavailable (never throws) for non-human prompts', async () => {
    expect(await runGate({ root, prompt: '<task-notification>x</task-notification>', transcriptPath: '' }))
      .toEqual({ status: 'unavailable', reason: 'not-human-prompt' });
  });

  it('runGate is unavailable when the embedder is switched off (vitest sets COLDSTART_EMBEDDER=0)', async () => {
    expect(process.env.COLDSTART_EMBEDDER).toBe('0');
    expect(await runGate({ root, prompt: 'about a', transcriptPath: '' })).toEqual({ status: 'unavailable', reason: 'embedder-off' });
  });
});
