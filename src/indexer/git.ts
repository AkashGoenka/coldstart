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
