import { join } from 'node:path';

/**
 * C# resolver: maps a `using` namespace to any .cs file in the corresponding
 * directory.
 *
 * `using Serilog.Core.Pipeline` — namespace-as-path: convert dots to slashes
 * and look for any `.cs` file under <source-root>/Serilog/Core/Pipeline/.
 *
 * Unlike Java where one class = one file, a C# namespace is spread across
 * many files. We pick any file in the directory as a representative — that's
 * sufficient for graph-level "this import points at this part of the repo".
 *
 * Source roots are discovered by suffix-matching `.cs` paths against a small
 * set of layout markers (project-name dir is also accepted).
 */

const ROOT_MARKERS = ['/src/', '/source/', '/lib/'];

interface CSharpIndex {
  // dirPath (rootDir-relative, forward slashes) → any .cs fileId in that dir
  dirToFile: Map<string, string>;
  // Discovered source roots (rootDir-relative, may be empty string for repo root)
  roots: string[];
}

const indexCache = new WeakMap<Set<string>, CSharpIndex>();

function buildIndex(fileIdSet: Set<string>): CSharpIndex {
  const cached = indexCache.get(fileIdSet);
  if (cached) return cached;
  const dirToFile = new Map<string, string>();
  const roots = new Set<string>();
  for (const id of fileIdSet) {
    if (!id.endsWith('.cs')) continue;
    const slash = id.lastIndexOf('/');
    const dirPath = slash >= 0 ? id.slice(0, slash) : '';
    if (!dirToFile.has(dirPath)) dirToFile.set(dirPath, id);

    // Discover roots — strip the longest ROOT_MARKER occurrence
    let rootFound = false;
    for (const marker of ROOT_MARKERS) {
      const idx = id.indexOf(marker);
      if (idx === -1) continue;
      roots.add(id.slice(0, idx + marker.length));
      rootFound = true;
      break;
    }
    if (!rootFound) {
      // Layout without `src/`: take everything up to the first dir segment as a root candidate
      const firstSlash = id.indexOf('/');
      if (firstSlash > 0) roots.add(id.slice(0, firstSlash + 1));
    }
  }
  roots.add('');
  const result: CSharpIndex = { dirToFile, roots: Array.from(roots) };
  indexCache.set(fileIdSet, result);
  return result;
}

export async function resolveCSharp(
  specifier: string,
  _fromFile: string,
  fileIdSet: Set<string>,
  _rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  const { dirToFile, roots } = buildIndex(fileIdSet);
  const nsPath = specifier.replace(/\./g, '/');

  for (const root of roots) {
    const dirKey = (root ? join(root, nsPath) : nsPath).replace(/\\/g, '/').replace(/\/$/, '');
    const file = dirToFile.get(dirKey);
    if (file) return file;
  }

  // Suffix fallback — find any dir whose path ends with the namespace path.
  // Useful for layouts the marker-based root discovery missed.
  const suffix = '/' + nsPath;
  for (const [dir, file] of dirToFile) {
    if (dir === nsPath || dir.endsWith(suffix)) return file;
  }

  return null;
}
