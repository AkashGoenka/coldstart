import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

/**
 * Go resolver: resolves module-local import paths using go.mod.
 *
 * Go imports are module paths, not file paths:
 *   import "github.com/org/repo/pkg/foo"
 *
 * Resolution:
 *   1. Parse go.mod to get the module name and any replace directives
 *   2. If the import starts with the module name, strip it to get the local path
 *   3. Check replace directives — local replacements (=> ./path or => ../path)
 *      are also in-repo and resolvable
 *   4. A Go package is a directory — find any .go file directly in that directory
 *
 * Imports not starting with the module name and not covered by a replace
 * directive are third-party → return null.
 */

interface GoModInfo {
  moduleName: string;
  replaceMap: Map<string, string>; // module path → local directory (absolute)
}

// ---------------------------------------------------------------------------
// go.work support — multi-module workspaces
// ---------------------------------------------------------------------------

interface GoWorkInfo {
  // Sorted by descending name length for longest-prefix matching
  modules: Array<{ name: string; dir: string }>;
}

const goWorkCache = new Map<string, GoWorkInfo | null>();

async function getGoWorkInfo(rootDir: string): Promise<GoWorkInfo | null> {
  if (goWorkCache.has(rootDir)) return goWorkCache.get(rootDir)!;
  let content: string;
  try {
    content = await readFile(join(rootDir, 'go.work'), 'utf-8');
  } catch {
    goWorkCache.set(rootDir, null);
    return null;
  }

  const modules: Array<{ name: string; dir: string }> = [];
  const useRe = /^use\s+(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(content)) !== null) {
    const useDir = join(rootDir, m[1]);
    try {
      const modContent = await readFile(join(useDir, 'go.mod'), 'utf-8');
      const nameMatch = modContent.match(/^module\s+(\S+)/m);
      if (nameMatch) modules.push({ name: nameMatch[1], dir: useDir });
    } catch { /* skip inaccessible modules */ }
  }

  modules.sort((a, b) => b.name.length - a.name.length);
  const info: GoWorkInfo = { modules };
  goWorkCache.set(rootDir, info);
  return info;
}

const goModCache = new Map<string, GoModInfo | null>();

async function getGoModInfo(rootDir: string): Promise<GoModInfo | null> {
  if (goModCache.has(rootDir)) return goModCache.get(rootDir)!;
  try {
    const content = await readFile(join(rootDir, 'go.mod'), 'utf-8');
    const moduleMatch = content.match(/^module\s+(\S+)/m);
    if (!moduleMatch) { goModCache.set(rootDir, null); return null; }
    const moduleName = moduleMatch[1];

    // Parse replace directives: "replace A [vX] => B [vY]"
    // Only capture local (relative) replacements — they're in this repo.
    const replaceMap = new Map<string, string>();
    const replaceRe = /^replace\s+(\S+)(?:\s+\S+)?\s+=>\s+(\S+)/gm;
    let m: RegExpExecArray | null;
    while ((m = replaceRe.exec(content)) !== null) {
      const oldPath = m[1];
      const newPath = m[2];
      if (newPath.startsWith('./') || newPath.startsWith('../')) {
        replaceMap.set(oldPath, join(rootDir, newPath));
      }
    }

    const info: GoModInfo = { moduleName, replaceMap };
    goModCache.set(rootDir, info);
    return info;
  } catch {
    goModCache.set(rootDir, null);
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
  _fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  const dirMap = buildGoDirMap(fileIdSet);

  // go.work multi-module resolution takes priority
  const workInfo = await getGoWorkInfo(rootDir);
  if (workInfo) {
    for (const { name, dir } of workInfo.modules) {
      if (specifier !== name && !specifier.startsWith(name + '/')) continue;
      const suffix = specifier.slice(name.length).replace(/^\//, '');
      const absPath = suffix ? join(dir, suffix) : dir;
      const relPath = absPath.slice(rootDir.length + 1).replace(/\\/g, '/');
      const result = dirMap.get(relPath);
      if (result) return result;
    }
    return null; // go.work present but no module matched → external
  }

  // Fall back to single go.mod at root
  const info = await getGoModInfo(rootDir);
  if (!info) return null;

  // Module-local import
  if (specifier.startsWith(info.moduleName)) {
    const localPath = specifier === info.moduleName
      ? ''
      : specifier.slice(info.moduleName.length + 1);
    return dirMap.get(localPath) ?? null;
  }

  // Replace-directive local import
  for (const [oldPath, localDir] of info.replaceMap) {
    if (specifier === oldPath || specifier.startsWith(oldPath + '/')) {
      const suffix = specifier.slice(oldPath.length).replace(/^\//, '');
      const absCandidate = suffix ? join(localDir, suffix) : localDir;
      const candidate = absCandidate.slice(rootDir.length + 1).replace(/\\/g, '/');
      return dirMap.get(candidate) ?? null;
    }
  }

  return null;
}
