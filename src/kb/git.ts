/**
 * Git provenance for the notebook — freshness = provenance, not verdicts.
 *
 * The append path stamps each record (and its verified anchors) with the repo's
 * HEAD at write time; later readers render "what happened to this path since
 * the note was written" (git log / diffstat) instead of a binary staleness
 * verdict. Everything here is best-effort: no git binary, not a repo, or a
 * repo with no commits all degrade to `undefined`, and the sha tripwire in
 * freshness.ts remains the whole story (also the non-git-repo story).
 */
import { execFileSync } from 'node:child_process';

/** Current HEAD as 12 hex, or undefined when unavailable (non-git repo, no
 *  commits yet, no git binary). Never throws. */
export function gitHeadSha(root: string): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return /^[0-9a-f]{40}/.test(out) ? out.slice(0, 12) : undefined;
  } catch {
    return undefined;
  }
}
