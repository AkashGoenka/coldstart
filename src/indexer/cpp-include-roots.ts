import { dirname, join, resolve, isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';

/**
 * Shared CMakeLists.txt discovery used by the C++ resolver.
 *
 * Walks up from a file's directory to find ancestor CMakeLists.txt files,
 * then parses them for include_directories() and target_include_directories()
 * to build a list of include roots. Results are cached by CMakeLists directory.
 *
 * Each file walks up from its own directory; ancestor CMakeLists are collected
 * and chained — a file in src/lib/ will inherit roots from src/ and rootDir's
 * CMakeLists if they exist.
 */

interface CppIncludeRootsInfo {
  cmakelists_dir: string;
  roots: string[];
}

// Cache by CMakeLists directory
const includeRootsCache = new Map<string, CppIncludeRootsInfo | null>();
// Per-startDir: found CMakeLists directories in walk order (nearest first)
const startDirToCmakeLists = new Map<string, string[]>();

async function readFileOpt(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8'); } catch { return null; }
}

/**
 * Extract absolute include root paths from a CMakeLists.txt file.
 * Handles include_directories() and target_include_directories().
 * Variables: ${CMAKE_CURRENT_SOURCE_DIR}, ${CMAKE_SOURCE_DIR}/${PROJECT_SOURCE_DIR},
 * ${CMAKE_CURRENT_BINARY_DIR}/${CMAKE_BINARY_DIR} (skipped).
 * Generator expressions like $<BUILD_INTERFACE:...> are simplified naively.
 */
function extractIncludeRoots(
  cmakelists_path: string,
  content: string,
  rootDir: string,
): string[] {
  const cmake_dir = dirname(cmakelists_path);
  const roots: Set<string> = new Set();

  const expandPath = (raw: string): string | null => {
    let expanded = raw;

    // Strip generator expressions $<...> — extract the content as best-effort
    expanded = expanded.replace(/\$<BUILD_INTERFACE:([^>]*)>/g, '$1');
    expanded = expanded.replace(/\$<INSTALL_INTERFACE:([^>]*)>/g, '$1');
    expanded = expanded.replace(/\$<CONFIG:.*?>/g, ''); // strip config-specific markers
    expanded = expanded.replace(/\$<[^>]*>/g, ''); // strip any remaining generator expressions

    // CMAKE_CURRENT_SOURCE_DIR == directory containing this CMakeLists.txt
    expanded = expanded.replace(/\$\{CMAKE_CURRENT_SOURCE_DIR\}/g, cmake_dir);
    // CMAKE_SOURCE_DIR == root of topmost project()
    expanded = expanded.replace(/\$\{CMAKE_SOURCE_DIR\}/g, rootDir);
    // PROJECT_SOURCE_DIR == dir of the nearest enclosing project() call.
    // Vendored deps almost always declare their own project(), so for a nested
    // CMakeLists this resolves to its own dir (e.g. bitcoin's vendored leveldb
    // uses ${PROJECT_SOURCE_DIR}/include relative to src/leveldb/). For the host
    // top-level CMakeLists this also reduces to cmake_dir == rootDir, so the
    // simple cmake_dir mapping is correct in the common case.
    expanded = expanded.replace(/\$\{PROJECT_SOURCE_DIR\}/g, cmake_dir);

    // Skip generated directories
    if (expanded.includes('${CMAKE_CURRENT_BINARY_DIR}') ||
        expanded.includes('${CMAKE_BINARY_DIR}')) {
      return null;
    }

    // If still has variables, skip
    if (expanded.includes('${')) return null;

    expanded = expanded.trim();
    if (!expanded) return null;

    // Resolve relative paths
    if (!isAbsolute(expanded)) {
      expanded = resolve(cmake_dir, expanded);
    }

    // Bound to rootDir
    if (!expanded.startsWith(rootDir + '/') && expanded !== rootDir) {
      return null;
    }

    return expanded;
  };

  // include_directories(<paths>)
  const include_dirs_re = /include_directories\s*\(([\s\S]*?)\)/g;
  let m: RegExpExecArray | null;
  while ((m = include_dirs_re.exec(content)) !== null) {
    const paths_str = m[1];
    // Split by whitespace/newlines, filter out quotes and empty strings
    const paths = paths_str
      .split(/[\s\n]+/)
      .map(p => p.replace(/^"|"$|^'|'$/g, '').trim())
      .filter(p => p);
    for (const path of paths) {
      const expanded = expandPath(path);
      if (expanded) roots.add(expanded);
    }
  }

  // target_include_directories(<target> [SYSTEM] [BEFORE|AFTER] <PUBLIC|PRIVATE|INTERFACE> <paths> [<PUBLIC|...> <paths>]...)
  // A single call can mix multiple visibility groups, so we tokenize the whole
  // body and treat any non-keyword token after we've seen a visibility marker
  // as a path. The leading token is the target name and is always skipped.
  const KEYWORDS = new Set(['PUBLIC', 'PRIVATE', 'INTERFACE', 'SYSTEM', 'BEFORE', 'AFTER']);
  const target_dirs_re = /target_include_directories\s*\(([\s\S]*?)\)/g;
  while ((m = target_dirs_re.exec(content)) !== null) {
    const tokens = m[1]
      .split(/[\s\n]+/)
      .map(p => p.replace(/^"|"$|^'|'$/g, '').trim())
      .filter(p => p);
    let sawVisibility = false;
    for (let i = 1; i < tokens.length; i++) { // skip [0] = target name
      const tok = tokens[i];
      if (KEYWORDS.has(tok)) { sawVisibility = true; continue; }
      if (!sawVisibility) continue; // tokens before any visibility keyword are non-path arguments
      const expanded = expandPath(tok);
      if (expanded) roots.add(expanded);
    }
  }

  return Array.from(roots);
}

async function getCppIncludeRootsForCmake(
  cmakelists_dir: string,
  rootDir: string,
): Promise<string[] | null> {
  if (includeRootsCache.has(cmakelists_dir)) {
    const cached = includeRootsCache.get(cmakelists_dir);
    return cached ? cached.roots : null;
  }

  try {
    const content = await readFileOpt(join(cmakelists_dir, 'CMakeLists.txt'));
    if (!content) {
      includeRootsCache.set(cmakelists_dir, null);
      return null;
    }

    const roots = extractIncludeRoots(join(cmakelists_dir, 'CMakeLists.txt'), content, rootDir);
    const info: CppIncludeRootsInfo = { cmakelists_dir, roots };
    includeRootsCache.set(cmakelists_dir, info);
    return roots;
  } catch {
    includeRootsCache.set(cmakelists_dir, null);
    return null;
  }
}

/**
 * Walk up from startDir to find all ancestor CMakeLists.txt files, collect their
 * include roots, and return them in order (nearest CMakeLists' roots first).
 * Caches the list of CMakeLists dirs per startDir to avoid repeated walk-ups.
 */
export async function getCppIncludeRoots(
  startDir: string,
  rootDir: string,
): Promise<string[]> {
  if (startDirToCmakeLists.has(startDir)) {
    const cmake_dirs = startDirToCmakeLists.get(startDir)!;
    const allRoots: string[] = [];
    for (const cmake_dir of cmake_dirs) {
      const roots = await getCppIncludeRootsForCmake(cmake_dir, rootDir);
      if (roots) allRoots.push(...roots);
    }
    return allRoots;
  }

  const cmake_dirs: string[] = [];
  let dir = startDir;
  for (let i = 0; i < 64; i++) {
    const cmake_path = join(dir, 'CMakeLists.txt');
    const content = await readFileOpt(cmake_path);
    if (content !== null) {
      cmake_dirs.push(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  startDirToCmakeLists.set(startDir, cmake_dirs);

  const allRoots: string[] = [];
  for (const cmake_dir of cmake_dirs) {
    const roots = await getCppIncludeRootsForCmake(cmake_dir, rootDir);
    if (roots) allRoots.push(...roots);
  }

  return allRoots;
}
