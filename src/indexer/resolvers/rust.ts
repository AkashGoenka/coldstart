import { dirname, resolve, join } from 'node:path';
import { toFileId } from './shared.js';

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

  const rsId = toFileId(base + '.rs', rootDir);
  if (fileIdSet.has(rsId)) return rsId;

  const modRsId = toFileId(join(base, 'mod.rs'), rootDir);
  if (fileIdSet.has(modRsId)) return modRsId;

  return null;
}
