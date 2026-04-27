import { access } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

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

export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Given a base path (no extension, or already has one), try:
 *   1. Exact match if base already has an extension
 *   2. Each entry in RESOLVABLE_EXTENSIONS appended to base
 *   3. Each INDEX_FILES entry inside base as a directory
 * Returns a rootDir-relative path if found in fileIdSet, else null.
 */
export async function tryResolveBase(
  base: string,
  fileIdSet: Set<string>,
  rootDir: string,
): Promise<string | null> {
  if (extname(base) && await fileExists(base)) {
    const rel = relative(rootDir, base).replace(/\\/g, '/');
    if (fileIdSet.has(rel)) return rel;
  }

  for (const ext of RESOLVABLE_EXTENSIONS) {
    const candidate = base + ext;
    if (await fileExists(candidate)) {
      const rel = relative(rootDir, candidate).replace(/\\/g, '/');
      if (fileIdSet.has(rel)) return rel;
    }
  }

  for (const idx of INDEX_FILES) {
    const candidate = join(base, idx);
    if (await fileExists(candidate)) {
      const rel = relative(rootDir, candidate).replace(/\\/g, '/');
      if (fileIdSet.has(rel)) return rel;
    }
  }

  return null;
}
