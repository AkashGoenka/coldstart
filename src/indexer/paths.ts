/**
 * Separator-correct helpers for the one distinction this indexer lives or dies
 * by: an ABSOLUTE path is OS-native (`D:\repo\src\a.ts` on Windows), while a
 * FILE ID is always forward-slash and relative to the repo root (`src/a.ts`).
 *
 * Every Windows bug in #149's follow-up was the same mistake — treating an
 * absolute path as if it were already a file id, then slicing it with `/`:
 *
 *     f.path.lastIndexOf('/app/')          // never matches on Windows
 *     absPath.startsWith(rootDir + '/')    // always false on Windows
 *
 * Both are silent: the code takes the "not found" branch and a whole feature
 * (Rails edges, Laravel edges, Go workspace resolution) disappears with no
 * error. Route absolute-path work through here instead of hand-rolling it.
 */
import { relative, resolve, sep, isAbsolute } from 'node:path';

/**
 * OS-native absolute path → forward-slash id relative to `rootDir`.
 *
 * Splits on the platform separator rather than regex-replacing every
 * backslash: on POSIX a backslash is a legal filename character, so
 * `.replace(/\\/g, '/')` would corrupt `weird\name.ts`. `sep` is `\` on
 * Windows (where `relative()` only ever emits `\`) and `/` on POSIX, so this
 * is correct on both without a platform branch.
 */
export function toPosixRelative(absolutePath: string, rootDir: string): string {
  return relative(rootDir, absolutePath).split(sep).join('/');
}

/**
 * Is `absPath` inside `rootDir` (or `rootDir` itself)?
 *
 * The string form (`absPath.startsWith(rootDir + '/')`) is wrong twice over:
 * it hardcodes the separator, and it treats `/repo-backup` as being inside
 * `/repo`. `relative()` handles both, plus the Windows cross-drive case —
 * `relative('D:\\a', 'C:\\b')` returns an ABSOLUTE `C:\b`, which the
 * `isAbsolute` guard rejects.
 */
export function isInside(absPath: string, rootDir: string): boolean {
  const rel = relative(rootDir, absPath);
  if (rel === '') return true; // the root itself
  if (isAbsolute(rel)) return false; // different Windows drive
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * The OS-native absolute directory CONTAINING a `<segment>/` directory, found
 * by scanning file ids — e.g. the Rails/Laravel app root, the dir holding
 * `app/`. Returns null when no indexed file lives under such a directory.
 *
 * Matching happens on the forward-slash id and the result is rebuilt with
 * `resolve`, so the caller gets a path it can hand straight to `fs` on either
 * platform.
 */
export function findSegmentParent(
  files: Array<{ relativePath: string }>,
  rootDir: string,
  segment: string,
): string | null {
  for (const f of files) {
    const parts = f.relativePath.split('/');
    const at = parts.lastIndexOf(segment);
    if (at < 0) continue;
    return resolve(rootDir, ...parts.slice(0, at));
  }
  return null;
}
