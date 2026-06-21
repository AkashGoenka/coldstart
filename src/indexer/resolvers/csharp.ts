import { join } from 'node:path';

/**
 * C# resolver: maps a `using Foo.Bar` directive to a representative .cs file
 * that *declares* namespace `Foo.Bar`.
 *
 * Preferred path is the AST-declared namespace (`pkgById`): each .cs file's
 * `namespace Foo.Bar` declaration (parsed by the extractor) is indexed, and a
 * `using` resolves to any file whose declared namespace matches. This is
 * layout-independent — C# namespaces routinely diverge from the directory tree
 * (a `RootNamespace` in the .csproj, files moved without renaming the folder),
 * so guessing the namespace from the path silently fails on those repos.
 *
 * Fallback (files without a known namespace, or no pkgById): the old
 * namespace-as-path heuristic — `using Serilog.Core.Pipeline` → look for any
 * .cs file under a `Serilog/Core/Pipeline/` directory. On conventional repos
 * where the namespace mirrors the folders, the two agree exactly, so the
 * fallback never regresses a conventional layout.
 *
 * Unlike Java where one class = one file, a C# namespace spans many files; we
 * return one representative — sufficient for graph-level "this import points at
 * this part of the repo".
 */

const ROOT_MARKERS = ['/src/', '/source/', '/lib/'];

interface CSharpIndex {
  // dirPath (rootDir-relative, forward slashes) → any .cs fileId in that dir
  dirToFile: Map<string, string>;
  // Discovered source roots (rootDir-relative, may be empty string for repo root)
  roots: string[];
  // Declared namespace → a representative .cs fileId declaring it (AST-anchored)
  byNamespace: Map<string, string>;
}

// Memoized on (fileIdSet identity, pkgById identity). pkgById changes per resolve
// cycle, so a stale path-only index can't leak into a later cycle.
const indexCache = new WeakMap<Set<string>, { idx: CSharpIndex; pkgById?: Map<string, string> }>();

function buildIndex(fileIdSet: Set<string>, pkgById?: Map<string, string>): CSharpIndex {
  const cached = indexCache.get(fileIdSet);
  if (cached && cached.pkgById === pkgById) return cached.idx;
  const dirToFile = new Map<string, string>();
  const byNamespace = new Map<string, string>();
  const roots = new Set<string>();
  for (const id of fileIdSet) {
    if (!id.endsWith('.cs')) continue;
    const slash = id.lastIndexOf('/');
    const dirPath = slash >= 0 ? id.slice(0, slash) : '';
    if (!dirToFile.has(dirPath)) dirToFile.set(dirPath, id);

    // AST-anchored: index the file's declared namespace (first-write-wins).
    const ns = pkgById?.get(id);
    if (ns && !byNamespace.has(ns)) byNamespace.set(ns, id);

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
  const result: CSharpIndex = { dirToFile, roots: Array.from(roots), byNamespace };
  indexCache.set(fileIdSet, { idx: result, pkgById });
  return result;
}

export async function resolveCSharp(
  specifier: string,
  _fromFile: string,
  fileIdSet: Set<string>,
  _rootDir: string,
  _aliasMap: Map<string, string[]>,
  pkgById?: Map<string, string>,
): Promise<string | null> {
  const { dirToFile, roots, byNamespace } = buildIndex(fileIdSet, pkgById);

  // AST-anchored: a file declaring exactly this namespace.
  const declared = byNamespace.get(specifier);
  if (declared) return declared;

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
