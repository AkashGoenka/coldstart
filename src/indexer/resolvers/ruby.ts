import { dirname, resolve, join } from 'node:path';
import { tryResolveBase } from './shared.js';

/**
 * Ruby resolver: handles both relative and load-path requires.
 *
 * `require_relative` paths are prefixed with `./` by the Ruby extractor,
 * so they arrive here already marked as relative.
 *
 * Non-relative specifiers (bare `require 'foo'`) try Ruby's conventional
 * load path roots before giving up — external gems will simply not resolve.
 */

const RUBY_LOAD_ROOTS = ['lib', 'app', 'spec', 'test'];

export async function resolveRuby(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  const isRelative = specifier.startsWith('.') || specifier.startsWith('/');

  if (isRelative) {
    const base = resolve(dirname(fromFile), specifier);
    return tryResolveBase(base, fileIdSet, rootDir);
  }

  for (const loadRoot of RUBY_LOAD_ROOTS) {
    const base = join(rootDir, loadRoot, specifier);
    const result = await tryResolveBase(base, fileIdSet, rootDir);
    if (result) return result;
  }

  const base = join(rootDir, specifier);
  return tryResolveBase(base, fileIdSet, rootDir);
}
