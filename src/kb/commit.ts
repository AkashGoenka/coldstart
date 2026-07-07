/**
 * kb commit — deliberate publish (design doc §Git strategy, 2026-07-06).
 *
 * Note-writing cadence (every session) doesn't match commit cadence
 * (feature-ready), so notebook changes NEVER ride along inside feature
 * commits. This is the one sanctioned path to git: stage and commit ONLY the
 * notebook's committed surface — the `.raw` source-of-truth logs plus the
 * skeleton files — leaving the developer's index and working tree otherwise
 * untouched (a pathspec'd `git commit -- <paths>` commits those paths
 * regardless of what else is staged, and leaves that other staged work
 * staged).
 *
 * Derived files (notes/ md, .metrics/) are gitignored by initSkeleton and
 * never publishable. A repo whose owner chose not to commit notes (the whole
 * notebook gitignored) gets a clear "nothing to publish" instead of -f
 * heroics — publishing is opt-in, never forced past an ignore rule.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { notebookDir, loadAll } from './store.js';

/** Repo-relative pathspecs of the notebook's committed surface. */
function publishPaths(root: string): string[] {
  const nb = notebookDir(root);
  return [join(nb, '.raw'), join(nb, 'okf.yaml'), join(nb, '.gitignore')];
}

export interface KbCommitResult {
  kind: 'committed' | 'nothing' | 'error';
  message: string;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function kbCommit(root: string, message?: string): KbCommitResult {
  try {
    git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { kind: 'error', message: 'kb commit: not a git repository — nothing to publish to.' };
  }

  const paths = publishPaths(root);

  // Stage the notebook surface. `git add` respects .gitignore, so a repo
  // that opted out of committing notes stages nothing here.
  try {
    git(root, ['add', '--', ...paths]);
  } catch (e) {
    // Pathspec matching nothing (fresh repo, no notebook) and ignored paths
    // (the repo opted out of committing notes) both fall through to the
    // emptiness check below; anything else is a real git failure.
    const msg = String((e as { stderr?: string }).stderr ?? e);
    if (!/did not match any files|ignored by one of your \.gitignore/.test(msg)) {
      return { kind: 'error', message: `kb commit: git add failed — ${msg.trim()}` };
    }
  }

  // Anything actually staged under the notebook?
  let staged = '';
  try {
    staged = git(root, ['diff', '--cached', '--name-only', '--', ...paths]);
  } catch { /* treated as nothing staged */ }
  if (!staged.trim()) {
    return {
      kind: 'nothing',
      message:
        'kb commit: nothing to publish — no notebook changes since the last commit. ' +
        '(If the whole notebook is gitignored, this repo has opted out of sharing notes; ' +
        'remove the ignore rule to publish.)',
    };
  }

  let noteCount = 0;
  try { noteCount = loadAll(root).notes.length; } catch { /* count is cosmetic */ }
  const msg = message?.trim() || `kb: publish notebook notes${noteCount ? ` (${noteCount} notes)` : ''}`;

  try {
    // Pathspec'd commit: commits ONLY these paths, even when other work is
    // staged — and leaves that other staged work exactly as it was.
    git(root, ['commit', '-m', msg, '--', ...paths]);
    const head = git(root, ['rev-parse', '--short', 'HEAD']).trim();
    const files = staged.trim().split('\n').length;
    return { kind: 'committed', message: `kb commit: published ${files} notebook file${files === 1 ? '' : 's'} → ${head} ("${msg}")` };
  } catch (e) {
    const msgOut = String((e as { stderr?: string; stdout?: string }).stderr ?? '') + String((e as { stdout?: string }).stdout ?? '');
    return { kind: 'error', message: `kb commit: git commit failed — ${msgOut.trim() || e}` };
  }
}
