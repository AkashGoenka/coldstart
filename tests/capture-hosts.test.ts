import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// @ts-expect-error plain .mjs module
import { extractCursorEvidence, extractCodexEvidence, segmentStatsCursor } from '../hooks/evidence.mjs';

/**
 * v5 capture on the Cursor and Codex hosts (parity port 2026-07-17).
 *
 * Cursor: per-turn stops → the FULL trigger machine, pending-file delivery via
 * beforeSubmitPrompt. Its transcript has NO tool_result records (verified on
 * real transcripts), so evidence is call-level with stat-existence checks.
 *
 * Codex: Stop fires ONCE at session exit (TUI) / by construction (exec), so
 * capture is one-shot blocking — but with v5 evidence tiers (result-confirmed
 * via call_id pairing) and the v5 checklist payload.
 */

const CURSOR_HOOK = fileURLToPath(new URL('../hooks/cursor-kb-elicit.mjs', import.meta.url));
const CODEX_HOOK = fileURLToPath(new URL('../hooks/codex-kb-elicit.mjs', import.meta.url));
const CURSOR_RECALL = fileURLToPath(new URL('../hooks/cursor-kb-recall.mjs', import.meta.url));

let root: string;
let sid = '';
let n = 0;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-hosts-'));
  sid = `hosts-test-${process.pid}-${++n}`;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.includes(sid)) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
  }
});

function seed(files: string[]): void {
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), 'x = 1\n');
  }
}

// --- Cursor transcript fixtures (shape verified on real transcripts) -----------
function cursorTurn(tools: Array<{ name: string; input: Record<string, unknown> }>, text = ''): string[] {
  const content: unknown[] = [];
  if (text) content.push({ type: 'text', text });
  for (const t of tools) content.push({ type: 'tool_use', name: t.name, input: t.input });
  return [JSON.stringify({ role: 'assistant', message: { content } }), JSON.stringify({ type: 'turn_ended' })];
}

describe('extractCursorEvidence (call-level, stat-checked — no tool_results exist)', () => {
  it('Read=read, Write=edit, Shell classifies, Grep is a mention', () => {
    seed(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const t = [
      ...cursorTurn([
        { name: 'Read', input: { path: path.join(root, 'src/a.ts') } },
        { name: 'Write', input: { path: path.join(root, 'src/b.ts') } },
        { name: 'Shell', input: { command: 'cat src/c.ts' } },
        { name: 'Grep', input: { pattern: 'foo', path: path.join(root, 'src/a.ts') } },
      ]),
    ].join('\n');
    const ev = extractCursorEvidence(t, root);
    expect(ev.get('src/a.ts').reads).toBe(1);
    expect(ev.get('src/a.ts').mentions).toBe(1); // the Grep
    expect(ev.get('src/b.ts').edits).toBe(1);
    expect(ev.get('src/c.ts').reads).toBe(1);
  });

  it('claims for paths that do not exist on disk contribute nothing (the no-result compensation)', () => {
    seed(['src/real.ts']);
    const t = cursorTurn([
      { name: 'Read', input: { path: path.join(root, 'src/ghost.ts') } },
      { name: 'Read', input: { path: path.join(root, 'src/real.ts') } },
    ]).join('\n');
    const ev = extractCursorEvidence(t, root);
    expect(ev.get('src/ghost.ts')).toBeUndefined();
    expect(ev.get('src/real.ts').reads).toBe(1);
  });

  it('segmentStatsCursor flags prose-heavy tool-light turns as synthesis', () => {
    const chatty = cursorTurn([], 'w'.repeat(2000)).join('\n');
    expect(segmentStatsCursor(chatty).synthesis).toBe(true);
    const busy = cursorTurn([
      { name: 'Read', input: { path: '/x/a.ts' } },
      { name: 'Read', input: { path: '/x/b.ts' } },
      { name: 'Read', input: { path: '/x/c.ts' } },
    ], 'short').join('\n');
    expect(segmentStatsCursor(busy).synthesis).toBe(false);
  });
});

// --- Codex rollout fixtures (shape verified on real rollouts) ------------------
let callId = 0;
function codexExec(cmd: string, confirmed = true): string[] {
  const id = `call_${++callId}`;
  const input = `const r = await tools.exec_command(${JSON.stringify({ cmd })}); text(r)`;
  const lines = [JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: id, input } })];
  if (confirmed) {
    lines.push(JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: [{ type: 'input_text', text: 'ok' }] } }));
  }
  return lines;
}
function codexPatch(file: string): string[] {
  const id = `call_${++callId}`;
  const input = `*** Begin Patch\n*** Update File: ${file}\n@@\n-a\n+b\n*** End Patch`;
  return [
    JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: id, input } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: [{ type: 'input_text', text: 'Done' }] } }),
  ];
}

describe('extractCodexEvidence (result-confirmed via call_id pairing)', () => {
  it('exec_command shell reads classify; unconfirmed calls drop; rg hits stay mentions', () => {
    seed(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const t = [
      ...codexExec(`sed -n '1,40p' src/a.ts`),
      ...codexExec(`cat src/b.ts`, false), // no output record → contributes nothing
      ...codexExec(`rg -n "foo" src/c.ts`),
    ].join('\n');
    const ev = extractCodexEvidence(t, root);
    expect(ev.get('src/a.ts').reads).toBe(1);
    expect(ev.get('src/b.ts')).toBeUndefined();
    expect(ev.get('src/c.ts').mentions).toBe(1);
    expect(ev.get('src/c.ts').reads).toBe(0);
  });

  it('apply_patch is edit-tier for the patched files', () => {
    seed(['src/mod.ts']);
    const ev = extractCodexEvidence(codexPatch('src/mod.ts').join('\n'), root);
    expect(ev.get('src/mod.ts').edits).toBe(1);
  });
});

// --- Hook-level: Cursor trigger + pending delivery -----------------------------
function cursorStop(transcript: string, lines: string[], opts: { event?: string; aid?: string; ownTranscript?: string; loopCount?: number; gen?: string } = {}): string {
  fs.appendFileSync(opts.ownTranscript ?? transcript, lines.length ? lines.join('\n') + '\n' : '');
  const payload = JSON.stringify({
    session_id: sid,
    workspace_roots: [root],
    transcript_path: transcript,
    ...(opts.ownTranscript ? { agent_transcript_path: opts.ownTranscript, subagent_id: opts.aid } : {}),
    hook_event_name: opts.event ?? 'stop',
    loop_count: opts.loopCount ?? 0,
    generation_id: opts.gen ?? `${sid}-g${++n}`,
  });
  return execFileSync('node', [CURSOR_HOOK], { input: payload, encoding: 'utf8', timeout: 30000 });
}

describe('cursor-kb-elicit v5 trigger', () => {
  it('arms on volume, fires descent into a pending file; the stop is never blocked', () => {
    const files = ['src/a1.py', 'src/a2.py', 'src/a3.py', 'src/a4.py', 'src/a5.py', 'src/b1.py', 'src/b2.py', 'src/b3.py', 'src/b4.py'];
    seed(files);
    const transcript = path.join(root, 'conv.jsonl');
    fs.writeFileSync(transcript, '');
    const asReads = (fl: string[]) => fl.flatMap((f) => cursorTurn([{ name: 'Read', input: { path: path.join(root, f) } }]));
    expect(cursorStop(transcript, asReads(files.slice(0, 5))).trim()).toBe('');
    expect(cursorStop(transcript, asReads(files.slice(5))).trim()).toBe('');
    expect(cursorStop(transcript, []).trim()).toBe('');
    expect(cursorStop(transcript, []).trim()).toBe(''); // descent fire — still silent stdout
    const pf = path.join(os.tmpdir(), `coldstart-kb-pending-${sid}.json`);
    expect(fs.existsSync(pf)).toBe(true);
    const pending = JSON.parse(fs.readFileSync(pf, 'utf8'));
    expect(pending.reason).toBe('descent');
    expect(pending.payload).toContain('Notebook capture point');
    expect(pending.payload).toContain('src/a1.py');
  });

  it('hook-continuation turns (loop_count>0) never advance the trigger', () => {
    seed(['src/x.py']);
    const transcript = path.join(root, 'conv.jsonl');
    fs.writeFileSync(transcript, '');
    const out = cursorStop(transcript, cursorTurn([{ name: 'Read', input: { path: path.join(root, 'src/x.py') } }]), { loopCount: 1 });
    expect(out.trim()).toBe('');
    expect(fs.existsSync(path.join(os.tmpdir(), `coldstart-cursor-kb-${sid}-main.json`))).toBe(false);
  });

  it('subagentStop block-fires via followup_message with the restate-deliverable tail', () => {
    seed(['src/zebra.py']);
    const transcript = path.join(root, 'conv.jsonl');
    fs.writeFileSync(transcript, '');
    const own = path.join(root, 'sub.jsonl');
    fs.writeFileSync(own, '');
    const out = cursorStop(transcript, cursorTurn([{ name: 'Read', input: { path: path.join(root, 'src/zebra.py') } }]),
      { event: 'subagentStop', aid: 'sub7', ownTranscript: own });
    const res = JSON.parse(out);
    expect(res.followup_message).toContain('src/zebra.py');
    expect(res.followup_message).toContain('spawned as a subagent');
  });
});

describe('cursor-kb-recall pending delivery', () => {
  it('delivers a pending capture via additional_context even with no notebook', () => {
    fs.writeFileSync(path.join(os.tmpdir(), `coldstart-kb-pending-${sid}.json`),
      JSON.stringify({ ts: Date.now(), reason: 'descent', payload: 'CAPTURE-PAYLOAD-MARKER' }));
    const out = execFileSync('node', [CURSOR_RECALL], {
      input: JSON.stringify({ session_id: sid, workspace_roots: [root], prompt: 'next task please' }),
      encoding: 'utf8', timeout: 30000,
    });
    const res = JSON.parse(out);
    expect(res.additional_context).toContain('CAPTURE-PAYLOAD-MARKER');
    // consumed on delivery
    expect(fs.existsSync(path.join(os.tmpdir(), `coldstart-kb-pending-${sid}.json`))).toBe(false);
  });
});

// --- Hook-level: Codex one-shot v5 ---------------------------------------------
describe('codex-kb-elicit v5 one-shot', () => {
  it('fires the v5 checklist as a block at the session\'s single Stop; mentions are out', () => {
    seed(['src/core.py', 'src/util.py', 'src/seen.py']);
    const transcript = path.join(root, 'rollout.jsonl');
    fs.writeFileSync(transcript, [
      ...codexExec(`sed -n '1,80p' src/core.py`),
      ...codexPatch('src/util.py'),
      ...codexExec(`rg -l "foo" src/seen.py`),
    ].join('\n') + '\n');
    const out = execFileSync('node', [CODEX_HOOK], {
      input: JSON.stringify({ session_id: sid, cwd: root, transcript_path: transcript, hook_event_name: 'Stop' }),
      encoding: 'utf8', timeout: 30000,
    });
    const res = JSON.parse(out);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('Notebook capture point');
    expect(res.reason).toContain('DECIDE FIRST');
    expect(res.reason).toContain('src/core.py');
    expect(res.reason).toContain('src/util.py');
    expect(res.reason).not.toContain('src/seen.py'); // rg hit = mention, never offered
    // second Stop (resumed thread, nothing new) → silent
    const out2 = execFileSync('node', [CODEX_HOOK], {
      input: JSON.stringify({ session_id: sid, cwd: root, transcript_path: transcript, hook_event_name: 'Stop' }),
      encoding: 'utf8', timeout: 30000,
    });
    expect(out2.trim()).toBe('');
  });
});

// --- SPIKE: checklist override -------------------------------------------------
// @ts-expect-error plain .mjs module
import { buildCapturePayload } from '../hooks/capture-payload.mjs';

describe('checklist override spike (.coldstart/checklist.md)', () => {
  const entries = [{ path: 'src/a.py', tier: 'read', notes: [], noConsumers: false }];

  it('override replaces the shipped checklist; placeholders substitute', () => {
    fs.mkdirSync(path.join(root, '.coldstart'), { recursive: true });
    fs.writeFileSync(path.join(root, '.coldstart', 'checklist.md'),
      'MY HOUSE RULES for {{ROOT}}\n\n{{WORKLIST}}\n\nwrite via {{CLI}} session {{SID}}\n');
    const p = buildCapturePayload({ root, cli: '/cli.js', sid: 'sess1', entries, envelope: 'inject' });
    expect(p).toContain('MY HOUSE RULES for ' + root);
    expect(p).toContain('src/a.py');
    expect(p).toContain('write via /cli.js session sess1');
    expect(p).not.toContain('DECIDE FIRST'); // shipped body replaced
    expect(p).toContain('Notebook capture point'); // envelope mechanics stay
  });

  it('an override that drops {{WORKLIST}} still gets the worklist (load-bearing)', () => {
    fs.mkdirSync(path.join(root, '.coldstart'), { recursive: true });
    fs.writeFileSync(path.join(root, '.coldstart', 'checklist.md'), 'terse rules only\n');
    const p = buildCapturePayload({ root, cli: '/cli.js', sid: 's', entries, envelope: 'block' });
    expect(p).toContain('terse rules only');
    expect(p).toContain('WORKLIST');
    expect(p).toContain('src/a.py');
  });

  it('no override → shipped checklist unchanged', () => {
    const p = buildCapturePayload({ root, cli: '/cli.js', sid: 's', entries, envelope: 'block' });
    expect(p).toContain('DECIDE FIRST');
    expect(p).toContain('file-single is the DEFAULT');
  });
});
