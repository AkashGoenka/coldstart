import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * kb-elicit.mjs v5 contract (2026-07-17): the always-fire gate is GONE.
 * Stops feed per-file evidence records into the trigger state machine; most
 * stops exit silently. Fires are descent/cap (non-blocking: pending
 * file for kb-recall to deliver) or head-drift (blocking). SubagentStop
 * stays a one-shot block. Tested by spawning the real hook with fixture
 * transcripts, exactly as Claude Code would.
 */
const HOOK = fileURLToPath(new URL('../hooks/kb-elicit.mjs', import.meta.url));

let root: string;
let transcript: string;
let sid = '';
let n = 0;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-elicit-'));
  transcript = path.join(root, 'transcript.jsonl');
  sid = `elicit-test-${process.pid}-${++n}`;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.includes(sid)) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
  }
});

let toolId = 0;
/** assistant tool_use line + its confirming tool_result (v5 drops unconfirmed calls). */
function turn(tools: Array<{ name: string; input: Record<string, unknown> }>): string[] {
  const uses = tools.map((t) => ({ type: 'tool_use', id: `t${++toolId}`, name: t.name, input: t.input }));
  return [
    JSON.stringify({ type: 'assistant', message: { content: uses } }),
    ...uses.map((u) => JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: u.id, is_error: false }] },
    })),
  ];
}

/** Append lines to the session transcript and invoke one Stop. */
function stop(lines: string[], opts: { event?: string; aid?: string; transcriptPath?: string } = {}): string {
  const tp = opts.transcriptPath ?? transcript;
  fs.appendFileSync(tp, lines.length ? lines.join('\n') + '\n' : '');
  const payload = JSON.stringify({
    session_id: sid,
    agent_id: opts.aid,
    cwd: root,
    transcript_path: transcript,
    ...(opts.aid ? { agent_transcript_path: tp } : {}),
    hook_event_name: opts.event ?? 'Stop',
  });
  return execFileSync('node', [HOOK], { input: payload, encoding: 'utf8', timeout: 30000 });
}

function pendingFile(): string {
  return path.join(os.tmpdir(), `coldstart-kb-pending-${sid}.json`);
}

function seed(files: string[]): void {
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), 'x = 1\n');
  }
}

describe('kb-elicit v5 trigger', () => {
  it('a first-stop read NEVER fires — evidence is recorded, the stop is allowed', () => {
    seed(['src/app.py']);
    const out = stop(turn([{ name: 'Read', input: { file_path: path.join(root, 'src/app.py'), offset: 10, limit: 40 } }]));
    expect(out.trim()).toBe(''); // silent tick
    const marker = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `coldstart-kb-${sid}-main.json`), 'utf8'));
    expect(marker.files['src/app.py'].reads).toBe(1);
    expect(fs.existsSync(pendingFile())).toBe(false);
  });

  it('arm on volume, fire on descent → pending file for next-prompt delivery, stop never blocked', () => {
    const files = ['src/a1.py', 'src/a2.py', 'src/a3.py', 'src/a4.py', 'src/a5.py', 'src/b1.py', 'src/b2.py', 'src/b3.py', 'src/b4.py'];
    seed(files);
    // stop 1: 5 reads → active, under threshold
    expect(stop(files.slice(0, 5).map((f) => turn([{ name: 'Read', input: { file_path: path.join(root, f) } }])).flat()).trim()).toBe('');
    // stop 2: 4 more → armed
    expect(stop(files.slice(5).map((f) => turn([{ name: 'Read', input: { file_path: path.join(root, f) } }])).flat()).trim()).toBe('');
    // stops 3-4: quiet → descent
    expect(stop([]).trim()).toBe('');
    const out4 = stop([]);
    expect(out4.trim()).toBe(''); // NON-blocking: no stdout even on fire
    expect(fs.existsSync(pendingFile())).toBe(true);
    const pending = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
    expect(pending.reason).toBe('descent');
    expect(pending.payload).toContain('Notebook capture point');
    expect(pending.payload).toContain('src/a1.py');
    expect(pending.payload).toContain('DECIDE FIRST');
    expect(pending.payload).toContain('WORKLIST');
    expect(pending.payload).toContain('FLOWS');
    expect(pending.payload).toContain('continue with the user\'s request');
  });

  it('mention-only contact (grep/scripts) records nothing and can never arm', () => {
    seed(['lib/util.ts']);
    const out = stop(turn([{ name: 'Bash', input: { command: `grep -rn "foo" lib/util.ts && node lib/util.ts` } }]));
    expect(out.trim()).toBe('');
    const marker = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `coldstart-kb-${sid}-main.json`), 'utf8'));
    expect(marker.files['lib/util.ts']).toBeUndefined(); // mentions are filtered before the trigger
  });

  it('bash reads count; nonexistent shell tokens are ignored; .coldstartignore\'d files are out', () => {
    seed(['lib/util.ts', 'package.json']);
    const out = stop(turn([{ name: 'Bash', input: { command: `cat lib/util.ts package.json && sed -n '1,5p' lib/missing.ts` } }]));
    expect(out.trim()).toBe('');
    const marker = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `coldstart-kb-${sid}-main.json`), 'utf8'));
    expect(marker.files['lib/util.ts'].reads).toBe(1);
    expect(marker.files['lib/missing.ts']).toBeUndefined();
    expect(marker.files['package.json']).toBeUndefined(); // default-ignored
  });

  it('.coldstart/ internals never count', () => {
    fs.mkdirSync(path.join(root, '.coldstart'), { recursive: true });
    fs.writeFileSync(path.join(root, '.coldstart/kb-hook.log'), 'log\n');
    const out = stop(turn([{ name: 'Read', input: { file_path: path.join(root, '.coldstart/kb-hook.log') } }]));
    expect(out.trim()).toBe('');
    const marker = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `coldstart-kb-${sid}-main.json`), 'utf8'));
    expect(Object.keys(marker.files)).toEqual([]);
  });

  it('manual git commit (HEAD drift) fires a BLOCKING capture with the ≥2-file floor', () => {
    seed(['src/one.py', 'src/two.py']);
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q']);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base']);
    // stop 1: two files read; HEAD fingerprint recorded
    expect(stop([
      ...turn([{ name: 'Read', input: { file_path: path.join(root, 'src/one.py') } }]),
      ...turn([{ name: 'Read', input: { file_path: path.join(root, 'src/two.py') } }]),
    ]).trim()).toBe('');
    // manual commit outside the transcript
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'manual']);
    // stop 2: drift observed → instant blocking fire
    const out = stop([]);
    const res = JSON.parse(out);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('src/one.py');
    expect(res.reason).toContain('then stop');
  });

  it('a /compact-shrunk transcript is reprocessed, not silently skipped', () => {
    const before = Array.from({ length: 10 }, (_, i) => `src/before${i}.py`);
    seed([...before, 'src/after.py']);
    const markerPath = path.join(os.tmpdir(), `coldstart-kb-${sid}-main.json`);
    // stop 1: a long turn grows the transcript well past a handful of lines.
    expect(stop(before.map((f) => turn([{ name: 'Read', input: { file_path: path.join(root, f) } }])).flat()).trim()).toBe('');
    const bigLineCount = JSON.parse(fs.readFileSync(markerPath, 'utf8')).lineCount;
    expect(bigLineCount).toBeGreaterThan(15);
    // /compact replaces the transcript with a much SHORTER compacted version —
    // its length is now well below the stored offset.
    fs.writeFileSync(transcript, JSON.stringify({ type: 'summary', summary: 'compacted' }) + '\n');
    // stop 2: a real edit lands in the post-compact transcript.
    expect(stop(turn([{ name: 'Edit', input: { file_path: path.join(root, 'src/after.py') } }])).trim()).toBe('');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    // Without the shrink guard, slice(bigLineCount) is empty and this edit is lost.
    expect(marker.files['src/after.py']?.edits).toBe(1);
  });

  it('a fresh marker meeting a LARGE pre-existing transcript baselines instead of cap-firing a blob', () => {
    // Resume scenario: the OS cleared the tmp marker between days, but the on-disk
    // transcript still holds the whole prior session. A fresh marker reprocessing
    // it from line 0 would treat all history as this-turn work and cap-fire a blob.
    seed(['src/hist0.py']); // only the file edited after attach needs to exist
    const histTurns = Array.from({ length: 210 }, (_, i) =>
      turn([{ name: 'Read', input: { file_path: path.join(root, `src/hist${i}.py`) } }])).flat();
    fs.writeFileSync(transcript, histTurns.join('\n') + '\n');
    expect(histTurns.length).toBeGreaterThan(400);
    const markerPath = path.join(os.tmpdir(), `coldstart-kb-${sid}-main.json`);
    expect(fs.existsSync(markerPath)).toBe(false); // fresh: no marker on disk

    const out = stop([]); // process the already-large transcript
    expect(out.trim()).toBe('');                    // baseline → silent, NO blob fire
    expect(fs.existsSync(pendingFile())).toBe(false);
    const baselined = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    expect(baselined.lineCount).toBeGreaterThan(400); // offset snapped to the end
    expect(Object.keys(baselined.files)).toEqual([]); // nothing recorded — watch from here

    // Real work AFTER the attach is captured normally (baseline didn't wedge it).
    fs.appendFileSync(transcript,
      turn([{ name: 'Edit', input: { file_path: path.join(root, 'src/hist0.py') } }]).join('\n') + '\n');
    stop([]);
    const after = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    expect(after.files['src/hist0.py']?.edits).toBe(1);
  });

  it('a genuine first Stop with a small transcript still records evidence (not baselined)', () => {
    // Guard the guard: a real new session's first turn is tiny and must process.
    seed(['src/small.py']);
    const out = stop(turn([{ name: 'Read', input: { file_path: path.join(root, 'src/small.py') } }]));
    expect(out.trim()).toBe('');
    const marker = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `coldstart-kb-${sid}-main.json`), 'utf8'));
    expect(marker.files['src/small.py']?.reads).toBe(1); // recorded, NOT baselined away
  });
});

describe('kb-elicit SubagentStop (one-shot, still blocking)', () => {
  it('block-fires on the sub\'s own reads with the restate-deliverable tail', () => {
    seed(['src/zebra_loader.py']);
    const aid = 'agent42';
    const subDir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    const subTranscript = path.join(subDir, `agent-${aid}.jsonl`);
    fs.writeFileSync(transcript, ''); // parent transcript exists but is empty
    const out = stop(turn([{ name: 'Read', input: { file_path: path.join(root, 'src/zebra_loader.py') } }]),
      { event: 'SubagentStop', aid, transcriptPath: subTranscript });
    const res = JSON.parse(out);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('src/zebra_loader.py');
    expect(res.reason).toContain('spawned as a subagent');
    // second SubagentStop with nothing new → silent
    const out2 = stop([], { event: 'SubagentStop', aid, transcriptPath: subTranscript });
    expect(out2.trim()).toBe('');
  });

  it('block-fires on the sub\'s reads even when transcript is at nested path (workflows/...)', () => {
    seed(['src/nested_agent_work.py']);
    const aid = 'agent_nested_123';
    const nestedSubDir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents', 'workflows', 'wf_test');
    fs.mkdirSync(nestedSubDir, { recursive: true });
    const nestedSubTranscript = path.join(nestedSubDir, `agent-${aid}.jsonl`);
    fs.writeFileSync(transcript, ''); // parent transcript exists but is empty

    // Invoke the hook with a payload that does NOT include agent_transcript_path.
    // This forces the recursive derivation logic to run.
    fs.appendFileSync(nestedSubTranscript,
      turn([{ name: 'Read', input: { file_path: path.join(root, 'src/nested_agent_work.py') } }]).join('\n') + '\n');
    const payload = JSON.stringify({
      session_id: sid,
      agent_id: aid,
      cwd: root,
      transcript_path: transcript,
      // Intentionally NOT setting agent_transcript_path here — forces derivation
      hook_event_name: 'SubagentStop',
    });
    const out = execFileSync('node', [HOOK], { input: payload, encoding: 'utf8', timeout: 30000 });

    const res = JSON.parse(out);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('src/nested_agent_work.py');
    expect(res.reason).toContain('spawned as a subagent');
  });

  it('silently skip a SubagentStop from a compaction agent (acompact-*)', () => {
    seed(['src/some_file.py']);
    const aid = 'acompact_abc123def456';
    const subDir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    const subTranscript = path.join(subDir, `agent-${aid}.jsonl`);
    fs.writeFileSync(transcript, '');
    // Create the transcript file even though it shouldn't be processed
    fs.writeFileSync(subTranscript,
      turn([{ name: 'Read', input: { file_path: path.join(root, 'src/some_file.py') } }]).join('\n') + '\n');

    const payload = JSON.stringify({
      session_id: sid,
      agent_id: aid,
      cwd: root,
      transcript_path: transcript,
      agent_transcript_path: subTranscript,
      hook_event_name: 'SubagentStop',
    });
    const out = execFileSync('node', [HOOK], { input: payload, encoding: 'utf8', timeout: 30000 });

    // Should exit silently with no stdout
    expect(out.trim()).toBe('');

    // Verify no capture file was created
    expect(fs.existsSync(pendingFile())).toBe(false);
  });
});
