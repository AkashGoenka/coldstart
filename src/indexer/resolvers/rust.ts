import { dirname, resolve, join } from 'node:path';
import { toFileId } from './shared.js';
import { findRustWorkspace } from '../rust-workspace.js';

/**
 * Rust resolver:
 *   1. Mod declarations — `mod foo` → sibling `./foo.rs` or `./foo/mod.rs`.
 *   2. Cross-crate `use` paths — `use tokio::sync::Mutex` → resolve to a file
 *      in the tokio crate, located via the workspace Cargo.toml.
 *
 * External-crate uses (those whose leading segment isn't a workspace member)
 * are filtered out at parse time by the Rust extractor, so they never reach
 * this resolver. See src/indexer/extractors/rust.ts.
 */
export async function resolveRust(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  // Single-segment specifier → mod declaration or bare `extern crate X`.
  // Try sibling-file resolution first; only fall through to workspace lookup
  // if that misses.
  if (!specifier.includes('::')) {
    const base = resolve(dirname(fromFile), specifier);
    const rsId = toFileId(base + '.rs', rootDir);
    if (fileIdSet.has(rsId)) return rsId;
    const modRsId = toFileId(join(base, 'mod.rs'), rootDir);
    if (fileIdSet.has(modRsId)) return modRsId;
  }

  const segments = specifier.split('::').filter(s => s.length > 0);
  if (segments.length === 0) return null;

  const ws = await findRustWorkspace(dirname(fromFile));
  if (!ws) return null;
  const crate = ws.crates.get(segments[0]);
  if (!crate) return null;

  // Last path segment is usually a symbol (e.g. `Mutex` in `tokio::sync::Mutex`),
  // not a file. Try progressively less-specific paths so we land on the deepest
  // file that actually exists.
  const rest = segments.slice(1);
  for (let depth = rest.length; depth >= 0; depth--) {
    if (depth === 0) {
      const libId = toFileId(join(crate.srcRoot, 'lib.rs'), rootDir);
      if (fileIdSet.has(libId)) return libId;
      const mainId = toFileId(join(crate.srcRoot, 'main.rs'), rootDir);
      if (fileIdSet.has(mainId)) return mainId;
    } else {
      const subPath = rest.slice(0, depth).join('/');
      const rsId = toFileId(join(crate.srcRoot, subPath + '.rs'), rootDir);
      if (fileIdSet.has(rsId)) return rsId;
      const modId = toFileId(join(crate.srcRoot, subPath, 'mod.rs'), rootDir);
      if (fileIdSet.has(modId)) return modId;
    }
  }
  return null;
}
