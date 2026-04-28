import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

/**
 * Go resolver: resolves module-local import paths using go.mod.
 *
 * Go imports are module paths, not file paths:
 *   import "github.com/org/repo/pkg/foo"
 *
 * Resolution:
 *   1. Parse go.mod to get the module name (e.g. "github.com/org/repo")
 *   2. If the import starts with the module name, strip it to get the local path
 *      ("github.com/org/repo/pkg/foo" → "pkg/foo")
 *   3. A Go package is a directory — find any .go file directly in that directory
 *
 * Imports not starting with the module name are third-party → return null.
 */

// Cache module name per rootDir (string key, not WeakMap — rootDir is a string)
const goModCache = new Map<string, string | null>();

async function getGoModuleName(rootDir: string): Promise<string | null> {
  if (goModCache.has(rootDir)) return goModCache.get(rootDir)!;
  try {
    const content = await readFile(join(rootDir, 'go.mod'), 'utf-8');
    const match = content.match(/^module\s+(\S+)/m);
    const name = match?.[1] ?? null;
    goModCache.set(rootDir, name);
    return name;
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
  _aliasMap: Map<string, string>,
): Promise<string | null> {
  const moduleName = await getGoModuleName(rootDir);
  if (!moduleName) return null;

  // Only resolve module-local imports
  if (!specifier.startsWith(moduleName)) return null;

  // Strip module prefix to get local directory path
  const localPath = specifier === moduleName
    ? ''
    : specifier.slice(moduleName.length + 1); // +1 for the slash

  const dirMap = buildGoDirMap(fileIdSet);
  return dirMap.get(localPath) ?? null;
}
