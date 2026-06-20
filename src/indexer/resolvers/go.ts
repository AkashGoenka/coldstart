import { join, dirname, isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';
import { MAX_DIR_WALK_DEPTH } from './shared.js';

/**
 * Go resolver: resolves module-local import paths using go.mod / go.work.
 *
 * Go imports are module paths, not file paths:
 *   import "github.com/org/repo/pkg/foo"
 *
 * Resolution:
 *   1. From the importing file's directory, walk up to find go.work or go.mod.
 *      go.mod / go.work may live at the file's package, or any ancestor —
 *      including dirs above rootDir, or below rootDir, or split across modules
 *      in a multi-module repo. Per-file walk-up handles all of these uniformly.
 *   2. If go.work is found first, use its `use` directives — each declared
 *      module's name → directory enables cross-module resolution.
 *   3. Otherwise use the file's nearest go.mod: module name + replace directives.
 *   4. A Go package is a directory — find any .go file directly in that dir.
 *
 * Imports not matching the file's module / workspace and not covered by a
 * replace directive are third-party → return null.
 */

interface GoModInfo {
  moduleName: string;
  replaceMap: Map<string, string>; // module path → local directory (absolute)
  modDir: string;
}

interface GoWorkInfo {
  workDir: string;
  // Sorted by descending name length for longest-prefix matching
  modules: Array<{ name: string; dir: string }>;
}

// Caches keyed by the discovered config dir (NOT by rootDir or fromFile),
// so multiple files in the same module share parsed state.
const modInfoCache = new Map<string, GoModInfo | null>();
const workInfoCache = new Map<string, GoWorkInfo | null>();
// Per-startDir lookup result, to avoid repeated walk-ups for files in the
// same package directory.
const startDirToModDir = new Map<string, string | null>();
const startDirToWorkDir = new Map<string, string | null>();

async function findUpwards(startDir: string, filename: string): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < MAX_DIR_WALK_DEPTH; i++) {
    try {
      await readFile(join(dir, filename), 'utf-8');
      return dir;
    } catch { /* not here, walk up */ }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

async function findModDirFor(startDir: string): Promise<string | null> {
  if (startDirToModDir.has(startDir)) return startDirToModDir.get(startDir)!;
  const modDir = await findUpwards(startDir, 'go.mod');
  startDirToModDir.set(startDir, modDir);
  return modDir;
}

async function findWorkDirFor(startDir: string): Promise<string | null> {
  if (startDirToWorkDir.has(startDir)) return startDirToWorkDir.get(startDir)!;
  const workDir = await findUpwards(startDir, 'go.work');
  startDirToWorkDir.set(startDir, workDir);
  return workDir;
}

async function getGoModInfo(modDir: string): Promise<GoModInfo | null> {
  if (modInfoCache.has(modDir)) return modInfoCache.get(modDir)!;
  try {
    const content = await readFile(join(modDir, 'go.mod'), 'utf-8');
    const moduleMatch = content.match(/^module\s+(\S+)/m);
    if (!moduleMatch) { modInfoCache.set(modDir, null); return null; }
    const moduleName = moduleMatch[1];

    const replaceMap = new Map<string, string>();
    const replaceRe = /^replace\s+(\S+)(?:\s+\S+)?\s+=>\s+(\S+)/gm;
    let m: RegExpExecArray | null;
    while ((m = replaceRe.exec(content)) !== null) {
      const newPath = m[2];
      if (newPath.startsWith('./') || newPath.startsWith('../')) {
        replaceMap.set(m[1], join(modDir, newPath));
      }
    }

    const info: GoModInfo = { moduleName, replaceMap, modDir };
    modInfoCache.set(modDir, info);
    return info;
  } catch {
    modInfoCache.set(modDir, null);
    return null;
  }
}

async function getGoWorkInfo(workDir: string): Promise<GoWorkInfo | null> {
  if (workInfoCache.has(workDir)) return workInfoCache.get(workDir)!;
  try {
    const content = await readFile(join(workDir, 'go.work'), 'utf-8');
    const modules: Array<{ name: string; dir: string }> = [];
    const useRe = /^use\s+(\S+)/gm;
    let m: RegExpExecArray | null;
    while ((m = useRe.exec(content)) !== null) {
      const useDir = isAbsolute(m[1]) ? m[1] : join(workDir, m[1]);
      try {
        const modContent = await readFile(join(useDir, 'go.mod'), 'utf-8');
        const nameMatch = modContent.match(/^module\s+(\S+)/m);
        if (nameMatch) modules.push({ name: nameMatch[1], dir: useDir });
      } catch { /* skip inaccessible modules */ }
    }
    modules.sort((a, b) => b.name.length - a.name.length);
    const info: GoWorkInfo = { workDir, modules };
    workInfoCache.set(workDir, info);
    return info;
  } catch {
    workInfoCache.set(workDir, null);
    return null;
  }
}

// Cache per fileIdSet: directory path → first .go file in that directory
const goDirCache = new WeakMap<Set<string>, Map<string, string>>();

function buildGoDirMap(fileIdSet: Set<string>): Map<string, string> {
  if (goDirCache.has(fileIdSet)) return goDirCache.get(fileIdSet)!;
  const map = new Map<string, string>();
  for (const fileId of fileIdSet) {
    if (!fileId.endsWith('.go')) continue;
    const lastSlash = fileId.lastIndexOf('/');
    const dirPath = lastSlash >= 0 ? fileId.slice(0, lastSlash) : '';
    if (!map.has(dirPath)) map.set(dirPath, fileId);
  }
  goDirCache.set(fileIdSet, map);
  return map;
}

export async function resolveGo(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  const dirMap = buildGoDirMap(fileIdSet);
  const startDir = dirname(fromFile);

  // go.work takes priority — multi-module workspace resolution
  const workDir = await findWorkDirFor(startDir);
  if (workDir) {
    const workInfo = await getGoWorkInfo(workDir);
    if (workInfo) {
      for (const { name, dir } of workInfo.modules) {
        if (specifier !== name && !specifier.startsWith(name + '/')) continue;
        const suffix = specifier.slice(name.length).replace(/^\//, '');
        const absPath = suffix ? join(dir, suffix) : dir;
        if (!absPath.startsWith(rootDir + '/') && absPath !== rootDir) continue;
        const relPath = absPath.slice(rootDir.length + 1).replace(/\\/g, '/');
        const result = dirMap.get(relPath);
        if (result) return result;
      }
      return null; // go.work governs this file but specifier didn't match any module
    }
  }

  // Single-module: nearest go.mod above the file
  const modDir = await findModDirFor(startDir);
  if (!modDir) return null;
  const info = await getGoModInfo(modDir);
  if (!info) return null;

  const tryResolveAbs = (absPath: string): string | null => {
    if (!absPath.startsWith(rootDir + '/') && absPath !== rootDir) return null;
    const relPath = absPath.slice(rootDir.length + 1).replace(/\\/g, '/');
    return dirMap.get(relPath) ?? null;
  };

  // Module-local import
  if (specifier === info.moduleName || specifier.startsWith(info.moduleName + '/')) {
    const suffix = specifier === info.moduleName
      ? ''
      : specifier.slice(info.moduleName.length + 1);
    const absCandidate = suffix ? join(info.modDir, suffix) : info.modDir;
    return tryResolveAbs(absCandidate);
  }

  // Replace-directive local import
  for (const [oldPath, localDir] of info.replaceMap) {
    if (specifier !== oldPath && !specifier.startsWith(oldPath + '/')) continue;
    const suffix = specifier.slice(oldPath.length).replace(/^\//, '');
    const absCandidate = suffix ? join(localDir, suffix) : localDir;
    const result = tryResolveAbs(absCandidate);
    if (result) return result;
  }

  return null;
}
