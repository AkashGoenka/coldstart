/**
 * Reading a file through the SHELL is reading a file.
 *
 * Two surfaces got this wrong in different ways, and both are pinned here.
 *
 * 1. The PostToolUse nudge listed `cat` inside SEARCH_RE and defined a read as
 *    `tool === "Read"`. So an agent working through the shell — the auto-mode
 *    default — was told it was "spiralling" for reading files: three `cat`s of
 *    three different files fired the anti-grep-spiral nudge.
 *
 * 2. Neither surface saw script-mediated reads at all. Across 2961 local
 *    transcripts agents issued ~5000 inline-interpreter calls (`node -e`,
 *    `python3 -c`, heredocs) against 23932 Read-tool calls — the shell is not a
 *    side channel, it is half the traffic.
 *
 * The fix splits one question into two, because the two consumers ask different
 * things:
 *   INTENT      (nudge)    — was content put in front of the agent at all?
 *   ATTRIBUTION (capture)  — and of WHICH named file?
 * A script reading a computed path (`open(sys.argv[1])`) answers yes to the
 * first and nothing to the second. Collapsing them is what over-attributes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractEvidence, bashContentRead } from '../hooks/evidence.mjs';
import nudge from '../hooks/nudge-handler.mjs';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-shellread-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const f of ['src/a.ts', 'src/b.ts', 'src/c.ts', 'package.json', 'lock.json', 'out.json'])
    fs.writeFileSync(path.join(root, f), '{}\n');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A transcript of result-confirmed Bash calls. */
function transcript(cmds: string[]): string {
  return cmds
    .flatMap((command, i) => [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }] } }),
    ])
    .join('\n');
}
const tiers = (cmd: string) => {
  const out: Record<string, string> = {};
  for (const [f, r] of extractEvidence(transcript([cmd]), root) as Map<string, any>)
    out[f] = r.edits ? 'edit' : r.reads ? 'read' : r.gs ? 'gs' : 'mention';
  return out;
};

/** Drive the nudge through a session and report the first spiral message. */
function spiralAfter(cmds: string[]): string | null {
  const session_id = `t${Math.random().toString(36).slice(2)}`;
  let first: string | null = null;
  for (const command of cmds) {
    const r: any = nudge({ session_id, tool_name: 'Bash', tool_input: { command }, tool_response: 'output', cwd: root });
    const text = r?.hookSpecificOutput?.additionalContext;
    if (text && /this is the spiral/.test(text) && !first) first = command;
  }
  return first;
}
const FIND = 'coldstart find alpha beta';

describe('shell reads are reads, not searches (nudge)', () => {
  it('three cats of three files do NOT read as a grep spiral', () => {
    expect(spiralAfter([FIND, 'cat src/a.ts', 'cat src/b.ts', 'cat src/c.ts'])).toBeNull();
  });

  it('inline scripts in any language count as reading', () => {
    expect(spiralAfter([
      FIND,
      `node -e 'console.log(require("fs").readFileSync("package.json","utf8"))'`,
      `python3 -c 'print(open("src/a.ts").read())'`,
      `ruby -e 'puts File.read("src/b.ts")'`,
    ])).toBeNull();
  });

  it('windowed and structured readers count too', () => {
    expect(spiralAfter([FIND, `sed -n '1,80p' src/a.ts`, 'head -40 src/b.ts', 'jq .name package.json'])).toBeNull();
  });

  it('CONTROL — a real grep spiral still fires', () => {
    expect(spiralAfter([FIND, 'grep -rn foo src/', 'rg bar src/', 'grep -rn baz src/'])).not.toBeNull();
  });

  it('CONTROL — cat piped into grep is still a search: the grep is the operative half', () => {
    expect(spiralAfter([FIND, 'cat src/a.ts | grep x', 'cat src/b.ts | grep y', 'cat src/c.ts | grep z'])).not.toBeNull();
  });
});

describe('attribution — which file did the script actually name (capture)', () => {
  it('only the read call’s own argument is a read; other tokens stay mentions', () => {
    // 50.6% of real inline reads carry surplus path tokens like this.
    const t = tiers(`node -e 'JSON.parse(require("fs").readFileSync("lock.json"))' && cp package.json out.json`);
    expect(t['lock.json']).toBe('read');
    expect(t['package.json']).toBe('mention');
    expect(t['out.json']).toBe('mention');
  });

  it('a computed path attributes nothing, yet still clears the spiral', () => {
    const cmd = `python3 -c 'import sys; print(open(sys.argv[1]).read())' src/a.ts`;
    expect(bashContentRead(cmd)).toBe(true); // intent: content was surfaced
    expect(tiers(cmd)['src/a.ts']).toBe('mention'); // attribution: nothing named
  });

  it('an inline script that WRITES is an edit, not a read', () => {
    expect(tiers(`node -e 'require("fs").writeFileSync("out.json","{}")'`)['out.json']).toBe('edit');
  });

  it('running a script is not reading it, and grep hits are not reads', () => {
    expect(tiers('node src/a.ts')['src/a.ts']).toBe('mention');
    expect(tiers('grep -rn TIER src/b.ts')['src/b.ts']).toBe('mention');
  });

  it('a script body full of ; and | is not shattered into shell segments', () => {
    // The old splitter cut on the script's OWN punctuation, so the fragment
    // holding the path stopped being the fragment holding readFileSync.
    const t = tiers(`node -e 'const l=JSON.parse(require("fs").readFileSync("lock.json")); for (const p of ["a","b"]) { console.log(p); }'`);
    expect(t['lock.json']).toBe('read');
  });
});

/**
 * All three hosts, both surfaces.
 *
 * The detection tables live in one place, but each host reaches them by a
 * different route — Cursor's nudge delegates to the Codex handler through
 * adaptCursorInput (Shell→Bash), and each host has its OWN transcript walker
 * (extractEvidence / extractCursorEvidence / extractCodexEvidence). A fix
 * applied to Claude's path alone would leave two hosts still calling `cat` a
 * grep spiral, silently. These pin all six combinations.
 */
describe('shell reads are understood on every host', () => {
  const READS = [
    'cat src/a.ts',
    `node -e 'console.log(require("fs").readFileSync("package.json","utf8"))'`,
    `python3 -c 'print(open("src/b.ts").read())'`,
  ];
  const GREPS = ['grep -rn foo src/', 'rg bar src/', 'grep -rn baz src/'];

  /** Run a host's own nudge entry over a command list; did the spiral fire? */
  async function spiralFired(host: 'claude' | 'codex' | 'cursor', cmds: string[]) {
    const mod: any =
      host === 'claude' ? await import('../hooks/nudge-handler.mjs')
      : host === 'codex' ? await import('../hooks/codex-nudge-handler.mjs')
      : await import('../hooks/cursor-nudge-handler.mjs');
    const session_id = `h${Math.random().toString(36).slice(2)}`;
    let fired = false;
    for (const command of cmds) {
      const payload = host === 'cursor'
        ? { session_id, tool_name: 'Shell', tool_input: { command }, tool_output: 'o', workspace_roots: [root] }
        : { session_id, tool_name: 'Bash', tool_input: { command }, tool_response: 'o', cwd: root };
      const r: any = mod.default(payload);
      const text = r?.hookSpecificOutput?.additionalContext ?? r?.additional_context;
      if (text && /this is the spiral/.test(text)) fired = true;
    }
    return fired;
  }

  for (const host of ['claude', 'codex', 'cursor'] as const) {
    it(`${host}: shell reads clear the spiral, real greps still trip it`, async () => {
      expect(await spiralFired(host, [FIND, ...READS])).toBe(false);
      expect(await spiralFired(host, [FIND, ...GREPS])).toBe(true);
    });
  }

  it('capture: every host walker tiers the same shell reads as reads', async () => {
    const { extractCursorEvidence, extractCodexEvidence } = await import('../hooks/evidence.mjs');
    const cursorT = READS.map((command, i) =>
      JSON.stringify({ role: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Shell', input: { command } }] } })).join('\n');
    const codexT = READS.flatMap((command, i) => [
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'exec', call_id: `c${i}`, arguments: JSON.stringify({ cmd: command }) } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: `c${i}`, output: 'ok' } })]).join('\n');

    const want = ['src/a.ts', 'package.json', 'src/b.ts'];
    for (const ev of [
      extractEvidence(transcript(READS), root) as Map<string, any>,
      extractCursorEvidence(cursorT, root) as Map<string, any>,
      extractCodexEvidence(codexT, root) as Map<string, any>,
    ]) {
      expect(want.filter((f) => (ev.get(f)?.reads || 0) > 0)).toEqual(want);
    }
  });
});
