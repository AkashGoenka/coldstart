import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain-JS hook module, no types
import nudge from '../hooks/codex-nudge-handler.mjs';
// @ts-expect-error plain-JS hook module, no types
import preguard from '../hooks/codex-preguard-handler.mjs';
import { appendRecord } from '../src/kb/raw-log.js';

const ELICIT = fileURLToPath(new URL('../hooks/codex-kb-elicit.mjs', import.meta.url));
const RECALL = fileURLToPath(new URL('../hooks/codex-kb-recall.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/codex-hooks/', import.meta.url));

let root: string;
let sid: string;
let seq = 0;
const stateFile = () => `/tmp/find_nudge_${sid}.json`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-codex-hooks-'));
  sid = `codex-hook-${process.pid}-${++seq}`;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(stateFile(), { force: true });
});

function rollout(name: string): string {
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

describe('Codex navigation hook contracts', () => {
  it('PostToolUse registers a successful find and PreToolUse denies its exact repeat', () => {
    const input = {
      session_id: sid,
      turn_id: 'turn-1',
      tool_name: 'Bash',
      tool_input: { command: 'coldstart find graph restore' },
      tool_response: 'src/app.py: restoreGraph',
    };
    expect(nudge(input)).toBeNull();
    const denied = preguard({ ...input, tool_response: undefined });
    expect(denied?.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(denied?.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('malformed or unrelated input fails open', () => {
    expect(preguard({})).toBeNull();
    expect(nudge({ session_id: sid, tool_name: 'spawn_agent', tool_input: {} })).toBeNull();
  });
});

describe('Codex rollout capture', () => {
  it('main Stop parses files from a Codex rollout transcript', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.py'), 'def restoreGraph(): pass\n');
    const output = run(ELICIT, {
      session_id: sid, turn_id: `main-${process.pid}-${seq}`, cwd: root,
      transcript_path: rollout('main-rollout.jsonl'), hook_event_name: 'Stop',
      stop_hook_active: false,
    });
    const result = JSON.parse(output);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('src/app.py');
  });

  it('SubagentStop uses agent_transcript_path rather than the parent rollout', () => {
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib/util.ts'), 'export const useful = true;\n');
    const output = run(ELICIT, {
      session_id: sid, turn_id: `sub-${process.pid}-${seq}`, cwd: root,
      transcript_path: rollout('main-rollout.jsonl'),
      agent_transcript_path: rollout('subagent-rollout.jsonl'),
      hook_event_name: 'SubagentStop', agent_id: `agent-${seq}`,
      stop_hook_active: false,
    });
    const result = JSON.parse(output);
    expect(result.reason).toContain('lib/util.ts');
    expect(result.reason).not.toContain('src/app.py');
  });

  it('missing transcript data fails open', () => {
    const output = run(ELICIT, {
      session_id: sid, turn_id: `empty-${process.pid}-${seq}`, cwd: root,
      transcript_path: null, hook_event_name: 'Stop', stop_hook_active: false,
    });
    expect(output.trim()).toBe('');
  });
});

describe('Codex notebook recall', () => {
  it('injects matching notes and arms the Codex navigation state', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.py'), 'def restoreGraph(): pass\n');
    appendRecord(root, {
      id: 'restore-flow', type: 'lesson', op: 'put', kind: 'rule',
      title: 'Graph restore ownership', body: 'restoreGraph owns graph restore.',
      anchors: [{ path: 'src/app.py' }],
    });
    const output = run(RECALL, {
      session_id: sid, turn_id: 'recall-turn', cwd: root,
      hook_event_name: 'UserPromptSubmit', prompt: 'Where does graph restore happen?',
    });
    expect(output).toContain('additionalContext');
    expect(JSON.parse(fs.readFileSync(stateFile(), 'utf8')).seen_find).toBe(true);
  });
});
