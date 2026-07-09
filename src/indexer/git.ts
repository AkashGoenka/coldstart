import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Get the current HEAD commit hash. Returns '' if unavailable.
 */
export async function getGitHead(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

const GIT_BUF = 64 * 1024 * 1024;

/**
 * Repo-relative paths changed between `fromHead` and the current HEAD.
 * `--no-renames` so a rename yields BOTH sides (delete + add) — the index
 * needs the old path removed and the new one added. null = git couldn't
 * answer (not a repo, fromHead unknown after gc/rebase, no git binary);
 * callers fall back to a filesystem walk.
 */
export async function getGitChangedFiles(rootDir: string, fromHead: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      'git', ['diff', '--name-only', '--no-renames', '-z', fromHead, 'HEAD'],
      { cwd: rootDir, maxBuffer: GIT_BUF },
    );
    return stdout.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Byte-exact (R100) renames between `fromHead` and the current HEAD, as
 * `[oldPath, newPath]` pairs. Only 100%-identical moves — a rename+edit is
 * R<100 and deliberately excluded (its content changed, so freshness flags it
 * regardless; we never chase git's similarity heuristic). `--diff-filter=R`
 * makes every record a rename, so the `-z` stream is triples of
 * `status \0 old \0 new`. null = git couldn't answer (not a repo, `fromHead`
 * unreachable after gc/rebase, no git binary) → caller leaves the note inactive.
 */
export async function getGitExactRenames(rootDir: string, fromHead: string): Promise<Array<[string, string]> | null> {
  try {
    const { stdout } = await execFileAsync(
      'git', ['diff', '--name-status', '-M100%', '--diff-filter=R', '-z', fromHead, 'HEAD'],
      { cwd: rootDir, maxBuffer: GIT_BUF },
    );
    const toks = stdout.split('\0').filter((t) => t.length);
    const out: Array<[string, string]> = [];
    // Each rename record is a triple: status ("R100"), old path, new path.
    for (let i = 0; i + 2 < toks.length + 1; i += 3) {
      if (toks[i + 1] && toks[i + 2]) out.push([toks[i + 1], toks[i + 2]]);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Repo-relative paths that are NEW vs HEAD — untracked (`??`) or added (`A`).
 * The candidate pool for an unstaged working-tree move, which git cannot pair
 * (it shows ` D old` + `?? new`); the caller hashes these and exact-matches the
 * vanished anchor's recorded sha256. null = git couldn't answer.
 */
export async function getGitNewFiles(rootDir: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      'git', ['status', '--porcelain', '--no-renames', '-uall', '-z'],
      { cwd: rootDir, maxBuffer: GIT_BUF },
    );
    const out: string[] = [];
    for (const entry of stdout.split('\0')) {
      if (entry.length <= 3) continue;
      const xy = entry.slice(0, 2);
      if (xy === '??' || xy.includes('A')) out.push(entry.slice(3));
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Repo-relative paths dirty vs HEAD (modified/staged/untracked). `-uall`
 * lists files inside untracked directories individually. null = git
 * couldn't answer.
 */
export async function getGitDirtyFiles(rootDir: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      'git', ['status', '--porcelain', '--no-renames', '-uall', '-z'],
      { cwd: rootDir, maxBuffer: GIT_BUF },
    );
    // -z: NUL-separated `XY path` records (no rename `-> ` forms with --no-renames).
    const out: string[] = [];
    for (const entry of stdout.split('\0')) {
      if (entry.length > 3) out.push(entry.slice(3));
    }
    return out;
  } catch {
    return null;
  }
}
