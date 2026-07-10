import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain-JS hook module, no types
import handle from '../hooks/nudge-handler.mjs';
import { appendRecord } from '../src/kb/raw-log.js';

/**
 * Spiral-detector arming (post-cluster-10 q23 fix): the seen_find gate stays
 * (the hook must not nag sessions that never touch coldstart), but every
 * coldstart surface now arms it — find (pre-existing), gs, kb calls, and a
 * kb-recall injection (the hook pre-seeds the state file). A note-implanted
 * session that skips `find` because the note handed it the files ran 21
 * greps with the detectors dark in q23.
 */
let sid: string;
const stateFile = () => `/tmp/find_nudge_${sid}.json`;

beforeEach(() => {
  sid = `nudge-arm-${process.pid}-${Math.floor(performance.now() * 1000)}`;
});
afterEach(() => {
  fs.rmSync(stateFile(), { force: true });
});

function bash(command: string, out: string) {
  return handle({
    session_id: sid,
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout: out, stderr: '' },
  });
}

/** Three greps, each surfacing a NOVEL file (so 3b's confined-check stays out
 * of the way and the generic streak detector is what fires — or doesn't). */
function grepStreak(prefix: string) {
  let last: ReturnType<typeof handle> = null;
  for (let i = 1; i <= 3; i++) {
    last = bash(`grep -rn "token${i}" arches/`, `arches/${prefix}_${i}.py:1: token${i}`);
  }
  return last;
}

describe('spiral-detector arming', () => {
  it('gate holds: with no coldstart usage at all, a 3-grep streak stays silent', () => {
    expect(grepStreak('cold')).toBeNull();
  });

  it('a coldstart gs call arms the detectors: the streak nudge fires', () => {
    bash('coldstart gs arches/app/models/models.py', 'symbols: LoadStaging');
    const res = grepStreak('gs');
    expect(res?.hookSpecificOutput?.additionalContext).toContain('this is the spiral');
  });

  it('a coldstart kb call arms the detectors', () => {
    bash('node /x/coldstart/dist/index.js kb search "LoadStaging model"', '- **loadstaging** …');
    const res = grepStreak('kb');
    expect(res?.hookSpecificOutput?.additionalContext).toContain('this is the spiral');
  });

  it('a kb call is not itself counted as spiral search, even piped to cat', () => {
    bash('coldstart kb search "graph restore" | cat', '- **restore** …');
    bash('grep -rn "a" arches/', 'arches/kbpipe_1.py:1: a');
    const res = bash('grep -rn "b" arches/', 'arches/kbpipe_2.py:1: b');
    // streak is only 2 (the kb call did not increment it) → no nudge yet
    expect(res).toBeNull();
  });

  it('a pre-seeded state file (what kb-recall writes on injection) arms the detectors', () => {
    fs.writeFileSync(stateFile(), JSON.stringify({ seen_find: true }));
    const res = grepStreak('seed');
    expect(res?.hookSpecificOutput?.additionalContext).toContain('this is the spiral');
  });
});

describe('kb-recall pre-seeds the nudge state on injection', () => {
  const HOOK = fileURLToPath(new URL('../hooks/kb-recall.mjs', import.meta.url));
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-recallarm-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function runRecall(prompt: string) {
    const payload = JSON.stringify({ session_id: sid, cwd: root, prompt });
    return execFileSync('node', [HOOK], { input: payload, encoding: 'utf8', timeout: 30000 });
  }

  it('injection writes seen_find=true to the handler state file; no-hit leaves it absent', () => {
    fs.mkdirSync(path.join(root, 'app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'app/models.py'), 'class LoadStaging: pass\n');
    appendRecord(root, {
      id: 'loadstaging-trap', type: 'lesson', op: 'put', kind: 'absence',
      title: 'LoadStaging nodegroup cascade behavior on graph restore',
      body: 'nodegroup FK rows are guarded, not deleted.',
      anchors: [{ path: 'app/models.py' }],
    });

    const miss = runRecall('completely unrelated frontend css question zzz');
    expect(miss.trim()).toBe('');
    expect(fs.existsSync(stateFile())).toBe(false);

    const hit = runRecall('Where is the LoadStaging nodegroup cascade handled on graph restore?');
    expect(hit).toContain('additionalContext');
    // the framing must pair the note with a companion find (anti-under-search)
    expect(hit).toContain('coldstart find');
    const st = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    expect(st.seen_find).toBe(true);
  });
});

describe('checkpoint (detector 4) gates on genuine writes', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-ckpt-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const call = (tool_name: string, tool_input: Record<string, unknown>) =>
    handle({ session_id: sid, cwd: dir, tool_name, tool_input, tool_response: 'x' });

  it('fires after 12 read/search calls with no write in the window', () => {
    let res: ReturnType<typeof handle> = null;
    for (let i = 0; i < 12; i++) res = call('Read', { file_path: `${dir}/f${i}.py` });
    expect(res?.hookSpecificOutput?.additionalContext).toContain('Checkpoint');
  });

  it('is suppressed when a structured write (Edit) lands in the window', () => {
    for (let i = 0; i < 11; i++) call('Read', { file_path: `${dir}/f${i}.py` });
    const res = call('Edit', { file_path: `${dir}/f.py` });
    expect(res).toBeNull();
  });

  it('is suppressed when a Bash write (sed -i) the structured signal misses lands in the window', () => {
    for (let i = 0; i < 11; i++) call('Read', { file_path: `${dir}/f${i}.py` });
    const res = handle({
      session_id: sid, cwd: dir, tool_name: 'Bash',
      tool_input: { command: `sed -i 's/a/b/' ${dir}/f.py` }, tool_response: '',
    });
    expect(res).toBeNull();
  });

  it('git ground-truth suppresses it for a write NO tool call revealed', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'tracked.py'), 'a\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });

    // Window 1: 12 pure reads → checkpoint fires, clean baseline captured.
    let res: ReturnType<typeof handle> = null;
    for (let i = 0; i < 12; i++) res = call('Read', { file_path: `${dir}/r${i}.py` });
    expect(res?.hookSpecificOutput?.additionalContext).toContain('Checkpoint');

    // A write that arrives through NO tool call the hook can see (e.g. an editor
    // save, an MCP writer) — only git knows the tree changed.
    fs.appendFileSync(path.join(dir, 'tracked.py'), 'b\n');

    // Window 2: 12 more pure reads → git sees the change → checkpoint suppressed.
    for (let i = 0; i < 12; i++) res = call('Read', { file_path: `${dir}/s${i}.py` });
    expect(res).toBeNull();
  });

  it('a HEAD move (commit / branch switch) does NOT spuriously suppress it', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'f.py'), 'a\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });

    // Window 1: 12 pure reads on a clean tree → checkpoint fires, baseline captured.
    let res: ReturnType<typeof handle> = null;
    for (let i = 0; i < 12; i++) res = call('Read', { file_path: `${dir}/r${i}.py` });
    expect(res?.hookSpecificOutput?.additionalContext).toContain('Checkpoint');

    // HEAD moves + the tree changes through NO agent tool call (a commit made
    // out of band, then a fresh dirty edit) — exactly the branch-switch/manual
    // case that would otherwise read as a spurious write.
    fs.appendFileSync(path.join(dir, 'f.py'), 'b\n');
    execFileSync('git', ['commit', '-qm', 'oob', '-a'], { cwd: dir });
    fs.appendFileSync(path.join(dir, 'f.py'), 'c\n');

    // Window 2: 12 pure reads, agent wrote nothing. HEAD moved since the baseline
    // → the git diff is distrusted → the (empty) fast write signal governs → fires.
    for (let i = 0; i < 12; i++) res = call('Read', { file_path: `${dir}/s${i}.py` });
    expect(res?.hookSpecificOutput?.additionalContext).toContain('Checkpoint');
  });
});
