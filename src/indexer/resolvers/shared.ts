import { join, relative, extname } from 'node:path';

// TypeScript ESM: `from './foo.js'` may resolve to `foo.ts` on disk.
const JS_TO_TS: Record<string, string[]> = {
  '.js':  ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

export const RESOLVABLE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs',
  '.cpp', '.c', '.h', '.hpp',
  '.rb', '.php', '.swift', '.kt', '.dart',
];

export const INDEX_FILES = [
  'index.ts', 'index.tsx', 'index.js', 'index.jsx',
  'index.mjs', 'index.cjs', 'index.py', 'index.go',
  '__init__.py', 'mod.rs',
];

/** Converts an absolute path to a normalized forward-slash file ID relative to rootDir. */
export function toFileId(absolutePath: string, rootDir: string): string {
  return relative(rootDir, absolutePath).replace(/\\/g, '/');
}

/**
 * Given a base path (no extension, or already has one), try to find a match
 * in fileIdSet using only in-memory lookups — no filesystem I/O.
 *
 *   1. Exact match if base already has an extension
 *   1b. JS→TS substitution: `foo.js` → `foo.ts` / `foo.tsx` (TypeScript ESM)
 *   2. Each entry in RESOLVABLE_EXTENSIONS appended to base (no-extension path)
 *   3. Each INDEX_FILES entry inside base as a directory
 *
 * Returns a rootDir-relative forward-slash path if found in fileIdSet, else null.
 */
export function tryResolveBase(
  base: string,
  fileIdSet: Set<string>,
  rootDir: string,
): string | null {
  const ext = extname(base);
  const id = toFileId(base, rootDir);

  if (ext) {
    if (fileIdSet.has(id)) return id;
    // TypeScript ESM: `from './foo.js'` may be indexed as `foo.ts`
    const tsAlts = JS_TO_TS[ext];
    if (tsAlts) {
      const stem = id.slice(0, -ext.length);
      for (const alt of tsAlts) {
        const altId = stem + alt;
        if (fileIdSet.has(altId)) return altId;
      }
    }
    return null; // has an extension — don't append more
  }

  for (const e of RESOLVABLE_EXTENSIONS) {
    const candidate = id + e;
    if (fileIdSet.has(candidate)) return candidate;
  }

  for (const idx of INDEX_FILES) {
    const candidate = id + '/' + idx;
    if (fileIdSet.has(candidate)) return candidate;
  }

  return null;
}
