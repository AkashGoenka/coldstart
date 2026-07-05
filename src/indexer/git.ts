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
