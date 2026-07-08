import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain-JS hook module, no types
import nudge from '../hooks/cursor-nudge-handler.mjs';
// @ts-expect-error plain-JS hook module, no types
import preguard from '../hooks/cursor-preguard-handler.mjs';
import { appendRecord } from '../src/kb/raw-log.js';

const ELICIT = fileURLToPath(new URL('../hooks/cursor-kb-elicit.mjs', import.meta.url));
const RECALL = fileURLToPath(new URL('../hooks/cursor-kb-recall.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/cursor-hooks/', import.meta.url));

let root: string;
let sid: string;
let seq = 0;
const stateFile = () => `/tmp/find_nudge_${sid}.json`;
const gen = () => `gen-${process.pid}-${seq}-${Math.random().toString(36).slice(2, 8)}`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-cursor-hooks-'));
  sid = `cursor-hook-${process.pid}-${++seq}`;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(stateFile(), { force: true });
  // per-turn capture markers this test may have written
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.startsWith('coldstart-cursor-kb-') && f.includes(String(process.pid))) {
      fs.rmSync(path.join(os.tmpdir(), f), { force: true });
    }
  }
});

/** Copy a fixture transcript into the temp root with __ROOT__ resolved. */
function transcript(name: string): string {
  const target = path.join(root, name);
  const source = fs.readFileSync(path.join(FIXTURES, name), 'utf8').replaceAll('__ROOT__', root);
  fs.writeFileSync(target, source);
  return target;
}

function run(script: string, payload: Record<string, unknown>): string {
  return execFileSync('node', [script], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000,
  });
}

describe('Cursor navigation hook contracts', () => {
  it('postToolUse registers a successful Shell find and preToolUse denies its reordered repeat', () => {
    // A Shell `coldstart find` (Cursor's terminal tool is "Shell", not "Bash").
    expect(nudge({
      session_id: sid, tool_name: 'Shell',
      tool_input: { command: 'coldstart find graph restore' },
      tool_output: 'src/app.py: restoreGraph',
    })).toBeNull();

    // Reordered terms → same canonical key → denied, in Cursor's envelope.
    const denied = preguard({
      session_id: sid, tool_name: 'Shell',
      tool_input: { command: 'coldstart find restore graph' },
    });
    expect(denied?.permission).toBe('deny');
    expect(denied?.agent_message).toContain('ALREADY run');
  });

  it('an MCP coldstart find is deduped against the CLI find (surface-agnostic)', () => {
    expect(nudge({
      session_id: sid, tool_name: 'mcp_coldstart_find',
      tool_input: { query: 'graph restore' },
      tool_output: 'src/app.py',
    })).toBeNull();
    const denied = preguard({
      session_id: sid, tool_name: 'Shell',
      tool_input: { command: 'coldstart find graph restore' },
    });
    expect(denied?.permission).toBe('deny');
  });

  it('malformed or unrelated input fails open', () => {
    expect(preguard({})).toBeNull();
    expect(nudge({ session_id: sid, tool_name: 'Read', tool_input: {} })).toBeNull();
  });
});

describe('Cursor transcript capture', () => {
  it('stop captures only the CURRENT turn (turn-scoped via turn_ended)', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.py'), 'def restoreGraph(): pass\n');
    fs.writeFileSync(path.join(root, 'src/old.py'), 'x = 1\n');
    fs.writeFileSync(path.join(root, 'src/helper.py'), 'def restoreGraph(): pass\n');
    const output = run(ELICIT, {
      session_id: sid, generation_id: gen(), loop_count: 0, workspace_roots: [root],
      transcript_path: transcript('main-transcript.jsonl'), hook_event_name: 'stop',
    });
    const result = JSON.parse(output);
    expect(result.followup_message).toContain('src/app.py');   // turn 2 Read
    expect(result.followup_message).toContain('src/helper.py'); // turn 2 Shell grep path
    expect(result.followup_message).not.toContain('src/old.py'); // turn 1 — excluded
  });

  it('subagentStop uses agent_transcript_path rather than the main transcript', () => {
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib/util.ts'), 'export const useful = true;\n');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.py'), 'def restoreGraph(): pass\n');
    const output = run(ELICIT, {
      session_id: sid, generation_id: gen(), loop_count: 0, workspace_roots: [root],
      transcript_path: transcript('main-transcript.jsonl'),
      agent_transcript_path: transcript('subagent-transcript.jsonl'),
      hook_event_name: 'subagentStop', subagent_id: `agent-${seq}`,
    });
    const result = JSON.parse(output);
    expect(result.followup_message).toContain('lib/util.ts');
    expect(result.followup_message).not.toContain('src/app.py');
  });

  it('loop_count > 0 fails open (never loops on its own followup_message)', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.py'), 'y\n');
    const output = run(ELICIT, {
      session_id: sid, generation_id: gen(), loop_count: 1, workspace_roots: [root],
      transcript_path: transcript('main-transcript.jsonl'), hook_event_name: 'stop',
    });
    expect(output.trim()).toBe('');
  });

  it('missing transcript fails open', () => {
    const output = run(ELICIT, {
      session_id: sid, generation_id: gen(), loop_count: 0, workspace_roots: [root],
      transcript_path: null, hook_event_name: 'stop',
    });
    expect(output.trim()).toBe('');
  });
});

describe('Cursor notebook recall', () => {
  it('beforeSubmitPrompt injects matching notes and arms the navigation state', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.py'), 'def restoreGraph(): pass\n');
    appendRecord(root, {
      id: 'restore-flow', type: 'lesson', op: 'put', kind: 'rule',
      title: 'Graph restore ownership', body: 'restoreGraph owns graph restore.',
      anchors: [{ path: 'src/app.py' }],
    });
    const output = run(RECALL, {
      session_id: sid, workspace_roots: [root],
      hook_event_name: 'beforeSubmitPrompt', prompt: 'Where does graph restore happen?',
    });
    expect(output).toContain('additional_context');
    expect(JSON.parse(fs.readFileSync(stateFile(), 'utf8')).seen_find).toBe(true);
  });
});
