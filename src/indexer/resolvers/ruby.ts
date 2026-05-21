import { dirname, resolve, join, basename, relative, sep } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tryResolveBase } from './shared.js';
import { buildFileId } from '../parser.js';

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

// ---------------------------------------------------------------------------
// Rails autoload constant resolution (v1: constants + render)
// ---------------------------------------------------------------------------

/** underscore conversion matching ActiveSupport::Inflector */
function underscore(s: string): string {
  return s
    .replace(/::/g, '/')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/** Walk dir tree collecting files (used once per app root) */
async function walkRbFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith('.rb')) files.push(p);
    }
  }
  await walk(dir);
  return files;
}

/** Build FQCN index: snake_case_path → fileId (relative to rootDir). Built once per Rails app. */
export async function buildRailsFqcnIndex(
  appRoot: string,
  fileIdSet: Set<string>,
  rootDir: string,
): Promise<Map<string, string>> {
  const idx = new Map<string, string>();

  // Discover autoload roots: app/<category>/, app/<category>/concerns/, and optionally lib/
  const appDir = join(appRoot, 'app');
  if (!existsSync(appDir)) return idx;

  const autoloadRoots: string[] = [];
  try {
    const entries = await readdir(appDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (name === 'views' || name === 'javascript' || name === 'assets') continue;
      autoloadRoots.push(join(appDir, name));
      // concerns/ is a sub-root
      const concerns = join(appDir, name, 'concerns');
      if (existsSync(concerns)) autoloadRoots.push(concerns);
    }
  } catch { /* no app/ */ }

  // Optional: lib/ — check config/application.rb for autoload_lib or autoload_paths
  const libRoot = join(appRoot, 'lib');
  if (existsSync(libRoot)) {
    try {
      const appConfig = await readFile(join(appRoot, 'config', 'application.rb'), 'utf-8');
      if (/config\.autoload(?:_lib|_paths)/.test(appConfig)) {
        autoloadRoots.push(libRoot);
      }
    } catch { /* no config, skip lib */ }
  }

  // Index each root
  for (const root of autoloadRoots) {
    const rbFiles = await walkRbFiles(root);
    for (const f of rbFiles) {
      let rel = f.slice(root.length + 1).slice(0, -3); // relative path without .rb
      // Strip concerns/ segment if present (Visibility in app/models/concerns → "visibility", not "concerns/visibility")
      if (rel.startsWith('concerns' + sep) || rel.startsWith('concerns/')) {
        rel = rel.slice('concerns/'.length);
      }
      const key = rel.split(sep).join('/');
      // First root wins (app/models before app/models/concerns, etc.)
      if (!idx.has(key)) {
        const fileId = buildFileId(relative(rootDir, f));
        if (fileIdSet.has(fileId)) idx.set(key, fileId);
      }
    }
  }

  return idx;
}

/** Resolve a constant FQCN to a fileId using the Rails autoload index */
export function resolveRailsConstant(
  fqcn: string,
  fqcnIndex: Map<string, string>,
): string | null {
  const key = underscore(fqcn);
  return fqcnIndex.get(key) ?? null;
}

/**
 * Resolve an ordered candidate group (innermost-nesting first, bare last) to a
 * fileId, taking the first candidate that maps to a real file. Mirrors Ruby's
 * lexical constant lookup. Returns the matched FQCN so callers can label the edge.
 */
export function resolveRailsConstantCandidates(
  candidates: string[],
  fqcnIndex: Map<string, string>,
): { fileId: string; fqcn: string } | null {
  for (const fqcn of candidates) {
    const fileId = fqcnIndex.get(underscore(fqcn));
    if (fileId) return { fileId, fqcn };
  }
  return null;
}

