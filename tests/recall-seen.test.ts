/**
 * Recall dedup across a compaction, driven through the REAL hook scripts:
 * the host's recall hook (kb-recall / cursor-kb-recall / codex-kb-recall)
 * and the compaction hook (recall-compact.mjs) as each host invokes it.
 *
 * Regression: the reset used to key on the transcript SHRINKING, but Claude
 * Code transcripts are append-only (a compact appends a compact_boundary
 * line), so it never fired — shown notes stayed hidden after every compaction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendRecord } from '../src/kb/raw-log.js';
import { logMetric } from '../src/kb/store.js';
import { seenPath } from '../hooks/recall-seen.mjs';

const hook = (f: string) => fileURLToPath(new URL(`../hooks/${f}`, import.meta.url));
const COMPACT = hook('recall-compact.mjs');
const NOTE = 'restore-drops-functions';
const PROMPT = 'why do functions disappear after a graph restore';

let root: string;
let sid: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-recall-seen-'));
  sid = `test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(path.join(root, 'app/models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app/models/graph.py'), 'class Graph: pass\n');
  appendRecord(root, {
    id: NOTE, type: 'lesson', op: 'put', kind: 'absence',
    title: 'Version restore silently drops function assignments',
    body: 'restore_state never re-creates functions_x_graphs rows.',
    anchors: [{ path: 'app/models/graph.py', hash: 'sha256:000000000000' }],
  });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(seenPath(sid), { force: true });
});

function run(file: string, input: Record<string, unknown>): string {
  const r = spawnSync('node', [file], { input: JSON.stringify(input), encoding: 'utf8', timeout: 15000 });
  expect(r.status).toBe(0);
  return r.stdout;
}

const HOSTS = [
  { name: 'claude', recall: hook('kb-recall.mjs'), compact: { hook_event_name: 'PreCompact', trigger: 'manual' } },
  { name: 'codex', recall: hook('codex-kb-recall.mjs'), compact: { hook_event_name: 'PostCompact', trigger: 'auto', turn_id: 't1' } },
  { name: 'cursor', recall: hook('cursor-kb-recall.mjs'), compact: { hook_event_name: 'preCompact', trigger: 'auto', is_first_compaction: true } },
];

describe.each(HOSTS)('recall dedup across a compaction ($name)', ({ recall, compact }) => {
  const prompt = () => run(recall, { session_id: sid, cwd: root, prompt: PROMPT });

  it('shown → hidden → compaction hook → shown again', () => {
    expect(prompt()).toContain(NOTE);
    expect(prompt()).not.toContain(NOTE);
    run(COMPACT, { session_id: sid, cwd: root, ...compact });
    expect(prompt()).toContain(NOTE);
    expect(prompt()).not.toContain(NOTE);
    expect(fs.readFileSync(path.join(root, '.coldstart', 'kb-hook.log'), 'utf8'))
      .toMatch(new RegExp(`compaction \\(${compact.hook_event_name}.*session=${sid}: cleared 1 seen ids`));
  });

  it('a note this session wrote is not injected until a compaction', () => {
    logMetric(root, 'capture', { event: 'write', id: NOTE, type: 'lesson', op: 'put', session: sid });
    expect(prompt()).not.toContain(NOTE);
    run(COMPACT, { session_id: sid, cwd: root, ...compact });
    expect(prompt()).toContain(NOTE);
  });

  it("another session's write does not hide the note", () => {
    logMetric(root, 'capture', { event: 'write', id: NOTE, type: 'lesson', op: 'put', session: 'someone-else' });
    expect(prompt()).toContain(NOTE);
  });
});

describe('recall-compact.mjs is fail-open', () => {
  it('exits 0 silently on empty, malformed, or session-less input', () => {
    for (const input of ['', 'not json', '{}']) {
      const r = spawnSync('node', [COMPACT], { input, encoding: 'utf8', timeout: 5000 });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    }
  });

  it('keys on conversation_id when session_id is absent (Cursor)', () => {
    run(COMPACT, { conversation_id: sid, cwd: root, hook_event_name: 'preCompact' });
    expect(JSON.parse(fs.readFileSync(seenPath(sid), 'utf8')).ids).toEqual([]);
  });
});
