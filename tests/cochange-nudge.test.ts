import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
// @ts-expect-error plain-JS hook module, no types
import { coChangeNudge, resetEditTrack, coChangePath } from '../hooks/cochange-nudge.mjs';
import { coChangePath as srcCoChangePath } from '../src/indexer/cochange.js';

let root: string;
let home: string;
let sid: string;
let seq = 0;
const prevHome = process.env.COLDSTART_HOME;

/** Write a cochange.json sidecar where the hook will look for it. */
function sidecar(partners: Record<string, Array<[string, number]>>, touched: Record<string, number>) {
  const p = coChangePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ v: 1, builtAt: Date.now(), head: 'x', commitsScanned: 10, partners, touched }));
}

const edit = (file: string, tool = 'Edit', key = 'file_path') =>
  coChangeNudge({ tool_name: tool, cwd: root, tool_input: { [key]: file } }, sid);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-cochange-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-home-'));
  process.env.COLDSTART_HOME = home;
  sid = `cochange-${process.pid}-${++seq}`;
});

afterEach(() => {
  resetEditTrack(sid);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.COLDSTART_HOME;
  else process.env.COLDSTART_HOME = prevHome;
});

describe('co-change edit nudge', () => {
  it('derives the same cochange.json path as the TS side (mirrored hash, no dist import)', () => {
    // The hook cannot import getCacheDir; it replicates the hash. This is the pin.
    expect(coChangePath(root)).toBe(srcCoChangePath(root));
  });

  it('rule 2: says nothing on the first file, fires once a second distinct file is edited', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 8]], 'src/b.ts': [['src/c.ts', 8]] }, { 'src/a.ts': 10, 'src/b.ts': 10, 'src/c.ts': 12 });
    expect(edit('src/a.ts')).toBeNull();
    const msg = edit('src/b.ts');
    expect(msg).toContain('src/c.ts');
    expect(msg).toContain('NOT a code dependency');
    expect(msg).toContain("isn't a complete list");
  });

  it('re-editing the SAME file never reaches the 2-file threshold', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 9]] }, { 'src/a.ts': 10, 'src/c.ts': 12 });
    expect(edit('src/a.ts')).toBeNull();
    expect(edit('src/a.ts')).toBeNull();
    expect(edit(path.join(root, 'src/a.ts'))).toBeNull(); // absolute form is the same file
  });

  it('applies the gate: weak ratio and single shared commit are both dropped', () => {
    sidecar(
      {
        'src/a.ts': [['src/weak.ts', 2], ['src/strong.ts', 8]], // 2/20 = 0.10, below 0.3
        'src/b.ts': [['src/once.ts', 1]],                       // below min shared
      },
      { 'src/a.ts': 20, 'src/b.ts': 20, 'src/weak.ts': 50, 'src/strong.ts': 50, 'src/once.ts': 5 },
    );
    edit('src/a.ts');
    const msg = edit('src/b.ts');
    expect(msg).toContain('src/strong.ts');
    expect(msg).not.toContain('src/weak.ts');
    expect(msg).not.toContain('src/once.ts');
  });

  it('rule 3: never names the same file twice, and never names a file already edited', () => {
    sidecar(
      { 'src/a.ts': [['src/c.ts', 9]], 'src/b.ts': [['src/c.ts', 9]], 'src/d.ts': [['src/c.ts', 9]] },
      { 'src/a.ts': 10, 'src/b.ts': 10, 'src/d.ts': 10, 'src/c.ts': 12 },
    );
    edit('src/a.ts');
    expect(edit('src/b.ts')).toContain('src/c.ts');
    expect(edit('src/d.ts')).toBeNull();   // c.ts already named — silence, not a repeat
    expect(edit('src/c.ts')).toBeNull();   // now edited too; nothing new to say
  });

  it('excludes test files on both sides', () => {
    sidecar(
      { 'src/a.ts': [['tests/a.test.ts', 9], ['src/c.ts', 9]], 'tests/b.test.ts': [['src/z.ts', 9]] },
      { 'src/a.ts': 10, 'tests/b.test.ts': 10, 'tests/a.test.ts': 10, 'src/c.ts': 10, 'src/z.ts': 10 },
    );
    expect(edit('tests/b.test.ts')).toBeNull(); // test seed never even counts as a file in play
    expect(edit('src/a.ts')).toBeNull();        // so this is still only the 1st real file
    const msg = edit('src/other.ts');
    expect(msg).toContain('src/c.ts');
    expect(msg).not.toContain('tests/a.test.ts');
  });

  it('accepts the Cursor payload shape (SearchReplace tool, `path` key)', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 9]], 'src/b.ts': [['src/c.ts', 9]] }, { 'src/a.ts': 10, 'src/b.ts': 10, 'src/c.ts': 12 });
    expect(edit('src/a.ts', 'SearchReplace', 'path')).toBeNull();
    expect(edit('src/b.ts', 'SearchReplace', 'path')).toContain('src/c.ts');
  });

  it('rule 1: reset clears the list, including a subagent stream on the same session', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 9]], 'src/b.ts': [['src/c.ts', 9]] }, { 'src/a.ts': 10, 'src/b.ts': 10, 'src/c.ts': 12 });
    // a subagent shares its parent's sid and is keyed <sid>_<aid>
    const subKey = `${sid}_agent7`;
    coChangeNudge({ tool_name: 'Edit', cwd: root, tool_input: { file_path: 'src/a.ts' } }, subKey);
    edit('src/a.ts');
    expect(edit('src/b.ts')).toContain('src/c.ts');

    resetEditTrack(sid);

    expect(edit('src/b.ts')).toBeNull();            // main stream back to one file in play
    expect(edit('src/a.ts')).toContain('src/c.ts'); // and c.ts is sayable again
    // the subagent's list went with it
    expect(coChangeNudge({ tool_name: 'Edit', cwd: root, tool_input: { file_path: 'src/b.ts' } }, subKey)).toBeNull();
  });

  // GC only. Elapsed time never clears a live list: UserPromptSubmit is the sole
  // task boundary, because a long auto-mode run edits for hours with no prompt.
  it('reset collects long-abandoned lists from OTHER sessions, but not live ones', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 9]] }, { 'src/a.ts': 10, 'src/c.ts': 12 });
    const other = `${sid}other`;   // a DIFFERENT session that merely shares a prefix
    const live = `${sid}live`;     // ditto, and still active
    coChangeNudge({ tool_name: 'Edit', cwd: root, tool_input: { file_path: 'src/a.ts' } }, other);
    coChangeNudge({ tool_name: 'Edit', cwd: root, tool_input: { file_path: 'src/a.ts' } }, live);
    const stale = path.join(os.tmpdir(), `coldstart_edits_${other}.json`);
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.utimesSync(stale, old / 1000, old / 1000);

    resetEditTrack(sid);

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(path.join(os.tmpdir(), `coldstart_edits_${live}.json`))).toBe(true);
    resetEditTrack(live);
  });

  it('stays silent when the repo has no sidecar, and on non-edit tools', () => {
    expect(edit('src/a.ts')).toBeNull();
    expect(edit('src/b.ts')).toBeNull();            // no cochange.json at all
    sidecar({ 'src/a.ts': [['src/c.ts', 9]] }, { 'src/a.ts': 10, 'src/c.ts': 12 });
    expect(coChangeNudge({ tool_name: 'Read', cwd: root, tool_input: { file_path: 'src/b.ts' } }, sid)).toBeNull();
  });

  /**
   * Editing through the SHELL counts as editing.
   *
   * The gate was keyed on tool NAMES (Edit/Write/MultiEdit/NotebookEdit/
   * SearchReplace), so an agent instructed to "make file changes with sed,
   * heredocs, or short scripts" — the auto-mode default — edited a whole task's
   * worth of related files and was never once asked what it forgot. Only
   * deterministic shell writes count: a redirect, tee, sed -i, or a write call
   * naming a literal path. A computed path stays silent by design.
   */
  const shellEdit = (command: string) =>
    coChangeNudge({ tool_name: 'Bash', cwd: root, tool_input: { command } }, sid);

  it('fires on shell-mediated edits: redirect, heredoc, sed -i', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 4]], 'src/b.ts': [['src/c.ts', 3]] }, { 'src/a.ts': 5, 'src/b.ts': 5 });
    expect(shellEdit("cat > src/a.ts <<'TS'\nexport const a = 1;\nTS")).toBeNull(); // rule 2
    expect(shellEdit('sed -i.bak "s/1/2/" src/b.ts')).toContain('src/c.ts');
  });

  it('one command that writes two files reaches the 2-file threshold by itself', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 4]], 'src/b.ts': [['src/c.ts', 3]] }, { 'src/a.ts': 5, 'src/b.ts': 5 });
    expect(shellEdit('sed -i "" "s/x/y/" src/a.ts && echo "z" > src/b.ts')).toContain('src/c.ts');
  });

  it('a heredoc tag is an arbitrary identifier, not a fixed vocabulary', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 4]], 'src/b.ts': [['src/c.ts', 3]] }, { 'src/a.ts': 5, 'src/b.ts': 5 });
    // PATCH / TS / MSG are all tags a real session used; a whitelist missed them.
    expect(shellEdit("cat > src/a.ts <<'PATCH'\nx\nPATCH")).toBeNull();
    expect(shellEdit("cat > src/b.ts <<'ANYTHING'\ny\nANYTHING")).toContain('src/c.ts');
  });

  it('reads, test runs and log redirects are not edits', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 4]], 'src/b.ts': [['src/c.ts', 3]] }, { 'src/a.ts': 5, 'src/b.ts': 5 });
    expect(shellEdit('cat src/a.ts')).toBeNull();
    expect(shellEdit('npm test 2>&1 | tail -5')).toBeNull();
    expect(shellEdit('grep -rn x src/a.ts > /dev/null')).toBeNull();
    // none of the above put a file in play, so a real edit is still only file #1
    expect(shellEdit('sed -i "" "s/x/y/" src/a.ts')).toBeNull();
  });

  it('a write to a COMPUTED path claims nothing rather than guessing', () => {
    sidecar({ 'src/a.ts': [['src/c.ts', 4]], 'src/b.ts': [['src/c.ts', 3]] }, { 'src/a.ts': 5, 'src/b.ts': 5 });
    expect(shellEdit('sed -i "" "s/x/y/" src/a.ts')).toBeNull();
    // src/b.ts appears only as a string the script reads into a variable.
    expect(shellEdit(`node -e 'const f="src/b.ts"; writeFileSync(f, s)'`)).toBeNull();
  });
});
