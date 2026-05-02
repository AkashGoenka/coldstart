import { dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { tryResolveBase } from './shared.js';

/**
 * Ruby resolver: handles both relative and load-path requires.
 *
 * `require_relative` paths are prefixed with `./` by the Ruby extractor,
 * so they arrive here already marked as relative.
 *
 * Non-relative specifiers (bare `require 'foo'`) try Ruby's conventional
 * load path roots before giving up — external gems will simply not resolve.
 *
 * Gemfile path gems: `gem 'name', path: '../some/gem'` entries are parsed
 * so that `require 'name'` and `require 'name/module'` resolve against the
 * gem's lib/ directory.
 */

const RUBY_LOAD_ROOTS = ['lib', 'app', 'spec', 'test'];

// Cache: rootDir → Map<gemName, absoluteLibDir>
const gemfileCache = new Map<string, Map<string, string>>();

async function loadGemfilePaths(rootDir: string): Promise<Map<string, string>> {
  if (gemfileCache.has(rootDir)) return gemfileCache.get(rootDir)!;
  const pathMap = new Map<string, string>();
  try {
    const content = await readFile(join(rootDir, 'Gemfile'), 'utf-8');
    // Match: gem 'name', ..., path: '../some/path' (single or double quotes)
    const re = /gem\s+['"]([^'"]+)['"]\s*,[^#\n]*\bpath:\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      pathMap.set(m[1], join(rootDir, m[2], 'lib'));
    }
  } catch { /* no Gemfile */ }
  gemfileCache.set(rootDir, pathMap);
  return pathMap;
}

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

  // Conventional load path roots
  for (const loadRoot of RUBY_LOAD_ROOTS) {
    const base = join(rootDir, loadRoot, specifier);
    const result = tryResolveBase(base, fileIdSet, rootDir);
    if (result) return result;
  }

  // Gemfile path gem resolution: require 'gem_name' or require 'gem_name/module'
  const gemPaths = await loadGemfilePaths(rootDir);
  for (const [gemName, libDir] of gemPaths) {
    if (specifier === gemName || specifier.startsWith(gemName + '/')) {
      const result = tryResolveBase(join(libDir, specifier), fileIdSet, rootDir);
      if (result) return result;
    }
  }

  const base = join(rootDir, specifier);
  return tryResolveBase(base, fileIdSet, rootDir);
}
