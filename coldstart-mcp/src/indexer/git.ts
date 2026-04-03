import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run `git log` to extract co-change relationships between files.
 *
 * Returns Map<fileA, Map<fileB, normalizedScore>>.
 * Score = commits_together / max(commits_A, commits_B).
 *
 * Returns empty map if git is unavailable or directory is not a repo.
 */
export async function analyzeGitCoChange(
  rootDir: string,
  maxCommits = 100,
): Promise<Map<string, Map<string, number>>> {
  let output: string;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--name-only', '--pretty=format:COMMIT', `-n${maxCommits}`],
      { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 },
    );
    output = stdout;
  } catch {
    // Not a git repo, git not installed, or other error
    return new Map();
  }

  // -------------------------------------------------------------------------
  // Parse git log output
  // Each "COMMIT" line is a separator; following lines are file paths.
  // -------------------------------------------------------------------------
  const commits: string[][] = [];
  let current: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'COMMIT') {
      if (current.length > 0) commits.push(current);
      current = [];
    } else if (trimmed.length > 0) {
      current.push(trimmed);
    }
  }
  if (current.length > 0) commits.push(current);

  // -------------------------------------------------------------------------
  // Count co-occurrences and individual file commit counts
  // -------------------------------------------------------------------------
  const coCount = new Map<string, Map<string, number>>();
  const fileCount = new Map<string, number>();

  for (const files of commits) {
    for (const f of files) {
      fileCount.set(f, (fileCount.get(f) ?? 0) + 1);
    }

    // Only consider commits with 2–50 files (very large commits are noise)
    if (files.length < 2 || files.length > 50) continue;

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = files[i];
        const b = files[j];
        if (!coCount.has(a)) coCount.set(a, new Map());
        if (!coCount.has(b)) coCount.set(b, new Map());
        coCount.get(a)!.set(b, (coCount.get(a)!.get(b) ?? 0) + 1);
        coCount.get(b)!.set(a, (coCount.get(b)!.get(a) ?? 0) + 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Normalize scores
  // -------------------------------------------------------------------------
  const result = new Map<string, Map<string, number>>();

  for (const [a, peers] of coCount) {
    const countA = fileCount.get(a) ?? 1;
    const normalized = new Map<string, number>();
    for (const [b, together] of peers) {
      const countB = fileCount.get(b) ?? 1;
      normalized.set(b, together / Math.max(countA, countB));
    }
    result.set(a, normalized);
  }

  return result;
}

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
