import { dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { tryResolveBase } from './shared.js';

/**
 * Ruby resolver: handles relative requires and load-path requires.
 *
 * `require_relative` paths are prefixed with `./` by the Ruby extractor.
 *
 * For bare `require 'foo'`, Ruby searches a load path. We approximate by
 * walking up from the file's directory; at each ancestor try the conventional
 * Rails load-path roots (lib/, app/, spec/, test/) plus any Gemfile-declared
 * path gems' lib/ directory. This handles repos where the Rails project lives
 * in a subdirectory of rootDir, multi-project repos, and engines with their
 * own Gemfile.
 *
 * Gemfile path gems: `gem 'name', path: '../some/gem'` entries map
 * `require 'name'` (and `require 'name/module'`) to the gem's lib/ directory.
 */

const RUBY_LOAD_ROOTS = ['lib', 'app', 'spec', 'test'];

// Caches keyed by the discovered Gemfile directory.
const gemPathsByDir = new Map<string, Map<string, string>>();
const startDirToGemfileDir = new Map<string, string | null>();

async function findGemfileDir(startDir: string, rootDir: string): Promise<string | null> {
  if (startDirToGemfileDir.has(startDir)) return startDirToGemfileDir.get(startDir)!;
  let dir = startDir;
  for (let i = 0; i < 64; i++) {
    try {
      await readFile(join(dir, 'Gemfile'), 'utf-8');
      startDirToGemfileDir.set(startDir, dir);
      return dir;
    } catch { /* not here */ }
    if (dir === rootDir) break;
    const parent = dirname(dir);
    if (parent === dir || !parent.startsWith(rootDir)) break;
    dir = parent;
  }
  startDirToGemfileDir.set(startDir, null);
  return null;
}

async function loadGemPaths(gemfileDir: string): Promise<Map<string, string>> {
  const cached = gemPathsByDir.get(gemfileDir);
  if (cached) return cached;
  const pathMap = new Map<string, string>();
  try {
    const content = await readFile(join(gemfileDir, 'Gemfile'), 'utf-8');
    const re = /gem\s+['"]([^'"]+)['"]\s*,[^#\n]*\bpath:\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      pathMap.set(m[1], join(gemfileDir, m[2], 'lib'));
    }
  } catch { /* no Gemfile */ }
  gemPathsByDir.set(gemfileDir, pathMap);
  return pathMap;
}

export async function resolveRuby(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const base = resolve(dirname(fromFile), specifier);
    return tryResolveBase(base, fileIdSet, rootDir);
  }

  // Walk up from file dir; at each ancestor, try Rails load-path roots.
  let dir = dirname(fromFile);
  for (let i = 0; i < 64; i++) {
    for (const loadRoot of RUBY_LOAD_ROOTS) {
      const base = join(dir, loadRoot, specifier);
      const result = tryResolveBase(base, fileIdSet, rootDir);
      if (result) return result;
    }
    if (dir === rootDir) break;
    const parent = dirname(dir);
    if (parent === dir || !parent.startsWith(rootDir)) break;
    dir = parent;
  }

  // Gemfile path gems: find the nearest Gemfile and resolve against it.
  const gemfileDir = await findGemfileDir(dirname(fromFile), rootDir);
  if (gemfileDir) {
    const gemPaths = await loadGemPaths(gemfileDir);
    for (const [gemName, libDir] of gemPaths) {
      if (specifier === gemName || specifier.startsWith(gemName + '/')) {
        const result = tryResolveBase(join(libDir, specifier), fileIdSet, rootDir);
        if (result) return result;
      }
    }
  }

  return null;
}
