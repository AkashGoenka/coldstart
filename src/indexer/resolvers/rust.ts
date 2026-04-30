import { dirname, resolve, join, relative } from 'node:path';
import { fileExists } from './shared.js';

/**
 * Rust resolver: maps `mod` declarations to sibling .rs files or mod.rs dirs.
 * `mod foo` in `src/lib.rs` maps to `src/foo.rs` or `src/foo/mod.rs`.
 */
export async function resolveRust(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  const base = resolve(dirname(fromFile), specifier);

  const rsFile = base + '.rs';
  if (await fileExists(rsFile)) {
    const rel = relative(rootDir, rsFile).replace(/\\/g, '/');
    if (fileIdSet.has(rel)) return rel;
  }

  const modRs = join(base, 'mod.rs');
  if (await fileExists(modRs)) {
    const rel = relative(rootDir, modRs).replace(/\\/g, '/');
    if (fileIdSet.has(rel)) return rel;
  }

  return null;
}
