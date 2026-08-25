/**
 * Guards the one invariant every Windows bug in this area violated:
 *
 *   an ABSOLUTE path is OS-native; a FILE ID is always forward-slash.
 *
 * Treating the first as the second is silent — the comparison just goes false,
 * the code takes its "not found" branch, and a whole feature disappears with no
 * error anywhere. That is how Rails edges, Laravel edges, Go workspace
 * resolution, npm workspace discovery and ALL hook evidence collection were
 * dead on Windows simultaneously, for months, while CI stayed green on ubuntu.
 *
 * Two halves, mirroring tests/windows-hide-coverage.test.ts:
 *   1. behavioural — the helpers do the right thing for Windows-shaped input
 *   2. static      — no new `rootDir + '/'` / `lastIndexOf('/')`-on-an-absolute
 *                    can be added back without this failing
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import { toPosixRelative, isInside, findSegmentParent } from '../src/indexer/paths.js';
import { walkDirectory } from '../src/indexer/walker.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('walkDirectory — a root that is not already canonical', () => {
  // The walker canonicalises every FILE with fs.promises.realpath, so it must
  // canonicalise the ROOT the same way. When it did not, a root reached
  // through a link (or, on the Windows CI runner, an 8.3 short path like
  // C:\Users\RUNNER~1\...) produced ids that climbed out of the repo:
  //   ../../../../../runneradmin/AppData/Local/Temp/cs-delsym-uvezwu/src/a.ts
  // Nothing threw. Every id was simply wrong, so nothing downstream matched.
  it('still yields repo-relative ids when the root is reached through a link', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-linkroot-')));
    const real = path.join(base, 'real');
    const link = path.join(base, 'link');
    fs.mkdirSync(path.join(real, 'src'), { recursive: true });
    fs.writeFileSync(path.join(real, 'src', 'a.ts'), 'export const a = 1;\n');
    try {
      // 'junction' so this works on Windows without developer mode; ignored
      // on POSIX, where a plain dir symlink needs no privilege.
      fs.symlinkSync(real, link, 'junction');
    } catch {
      return; // links unavailable in this environment — nothing to assert
    }
    try {
      const walked = await walkDirectory({ rootDir: link, excludes: [], includes: [] });
      expect(walked.map((w) => w.relativePath)).toEqual(['src/a.ts']);
      // Stated under the root we asked about, not silently re-anchored to the
      // link's target: ids and absolute paths must both be built from the one
      // root the caller passed, because the resolvers use that root too.
      expect(walked[0].absolutePath).toBe(path.join(link, 'src', 'a.ts'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('path helpers — behavioural', () => {
  it('toPosixRelative yields a forward-slash id from an OS-native absolute', () => {
    const root = path.join(REPO, 'fixture-root');
    const file = path.join(root, 'app', 'Models', 'User.php');
    expect(toPosixRelative(file, root)).toBe('app/Models/User.php');
  });

  it('toPosixRelative splits on the platform separator, so a POSIX filename containing a backslash survives', () => {
    // `weird\name.ts` is a LEGAL single filename on POSIX. The old
    // `.replace(/\\/g, '/')` would have split it into two fake segments.
    const root = path.join(REPO, 'fixture-root');
    const file = path.join(root, 'src', 'weird\\name.ts');
    const id = toPosixRelative(file, root);
    if (process.platform === 'win32') {
      expect(id).toBe('src/weird/name.ts'); // genuinely a separator here
    } else {
      expect(id).toBe('src/weird\\name.ts'); // one filename, preserved
    }
  });

  it('isInside accepts the root itself and real descendants', () => {
    const root = path.join(REPO, 'fixture-root');
    expect(isInside(root, root)).toBe(true);
    expect(isInside(path.join(root, 'a', 'b.ts'), root)).toBe(true);
  });

  it('isInside rejects a sibling that merely shares a name prefix', () => {
    // The `rootDir + '/'` string form got this wrong on every platform.
    const root = path.join(REPO, 'fixture-root');
    expect(isInside(path.join(REPO, 'fixture-root-backup', 'a.ts'), root)).toBe(false);
    expect(isInside(path.join(REPO, 'elsewhere', 'a.ts'), root)).toBe(false);
  });

  it('findSegmentParent locates a convention dir from forward-slash ids', () => {
    const root = path.join(REPO, 'fixture-root');
    const files = [{ relativePath: 'app/Models/User.php' }];
    expect(findSegmentParent(files, root, 'app')).toBe(root);
    expect(findSegmentParent(files, root, 'nope')).toBeNull();
  });

  it('findSegmentParent handles a nested app root', () => {
    const root = path.join(REPO, 'fixture-root');
    const files = [{ relativePath: 'backend/app/Models/User.php' }];
    expect(findSegmentParent(files, root, 'app')).toBe(path.join(root, 'backend'));
  });
});

describe('walker/indexed-file keep relativePath forward-slash', () => {
  it('baseIndexedFile normalises relativePath even when handed an OS-native one', async () => {
    const { baseIndexedFile } = await import('../src/indexer/indexed-file.js');
    const native = ['app', 'Models', 'User.php'].join(path.sep);
    const base = baseIndexedFile(
      'app/Models/User.php',
      path.join(REPO, native),
      native,
      'php',
      // Only the fields baseIndexedFile copies straight through are needed.
      { exports: [], hasDefaultExport: false, imports: [], hash: '', lineCount: 0,
        tokenEstimate: 0, symbols: [] } as never,
    );
    expect(base.relativePath).toBe('app/Models/User.php');
  });
});

// ---------------------------------------------------------------------------
// Static half — the regression that actually matters
// ---------------------------------------------------------------------------

/** Source files that legitimately manipulate FILE IDS (always `/`) with `/`. */
const ID_ONLY_FILES = new Set([
  'src/graph/dump.ts',            // keys are file ids
  'src/server/find.ts',           // `rel` is a file id
  'src/server/tools.ts',          // symbol names, not paths
  'src/indexer/paths.ts',         // documents the bad patterns in comments
  'src/init.ts',                  // CLI flag parsing (`--flag=value`)
]);

/**
 * Comment lines are not code. Several fixes deliberately QUOTE the pattern
 * they replaced so the next reader knows why the code looks the way it does —
 * flagging those would push people towards deleting the explanation.
 */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('no new POSIX-only absolute-path surgery', () => {
  it('nothing reconstructs a separator with `<root> + "/"`', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(REPO, 'src'))) {
      const rel = path.relative(REPO, file).split(path.sep).join('/');
      if (ID_ONLY_FILES.has(rel)) continue;
      const text = fs.readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (isComment(line)) return;
        // `rootDir + '/'`, `root + "/"` — the exact shape that made Go
        // workspace resolution and CMake include roots dead on Windows.
        if (/\b(root|rootDir|base|dir|appRoot)\s*\+\s*['"]\//.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, `use isInside()/toPosixRelative() from src/indexer/paths.ts instead:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('nothing slices an absolute path on a hardcoded slash', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(REPO, 'src'))) {
      const rel = path.relative(REPO, file).split(path.sep).join('/');
      if (ID_ONLY_FILES.has(rel)) continue;
      const text = fs.readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (isComment(line)) return;
        // `.path.lastIndexOf('/…')` / `.path.includes('/…')` — an absolute
        // path never contains a forward slash on Windows.
        if (/\.path\.(lastIndexOf|indexOf|includes|startsWith)\(['"]\//.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, `match on the file id (relativePath), not the absolute path:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('the state dir is reached through coldstartHome(), not homedir() directly', () => {
    // A direct `join(homedir(), '.coldstart', …)` cannot be redirected by a
    // test, which is how fixture lockfiles ended up in a real ~/.coldstart.
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(REPO, 'src'))) {
      const rel = path.relative(REPO, file).split(path.sep).join('/');
      if (rel === 'src/constants.ts') continue; // defines it
      const text = fs.readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (isComment(line)) return;
        if (/homedir\(\)\s*,\s*['"]\.coldstart/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, `use coldstartHome() from src/constants.ts:\n${offenders.join('\n')}`).toEqual([]);
  });
});
