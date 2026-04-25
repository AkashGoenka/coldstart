import { readFile, access } from 'node:fs/promises';
import { join, dirname, resolve, extname, basename, relative } from 'node:path';
import type { IndexedFile, Edge, EdgeType, Language } from '../types.js';

// All resolvable extensions, in priority order
const RESOLVABLE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs',
  '.cpp', '.c', '.h', '.hpp',
  '.rb', '.php', '.swift', '.kt', '.dart',
];

const INDEX_FILES = [
  'index.ts', 'index.tsx', 'index.js', 'index.jsx',
  'index.mjs', 'index.cjs', 'index.py', 'index.go',
  '__init__.py', 'mod.rs',
];

interface TsConfig {
  paths?: Record<string, string[]>;
  baseUrl?: string;
}

async function loadTsConfigPaths(rootDir: string): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const tscPath = join(rootDir, name);
    try {
      const raw = await readFile(tscPath, 'utf-8');
      // Strip JSON comments (common in tsconfig)
      const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const cfg = JSON.parse(stripped) as { compilerOptions?: TsConfig };
      const compOpts = cfg.compilerOptions;
      if (!compOpts?.paths) continue;
      const baseUrl = compOpts.baseUrl ?? '.';
      for (const [alias, targets] of Object.entries(compOpts.paths)) {
        const aliasKey = alias.replace(/\/\*$/, '');
        const target = targets[0]?.replace(/\/\*$/, '') ?? '';
        paths.set(aliasKey, resolve(rootDir, baseUrl, target));
      }
    } catch {
      // ignore missing or malformed tsconfig
    }
  }
  return paths;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveSpecifier(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  aliasMap: Map<string, string>,
  language: Language,
): Promise<string | null> {
  // ---------------------------------------------------------------------------
  // 1. Skip clearly external packages
  // ---------------------------------------------------------------------------
  const isRelative = specifier.startsWith('.') || specifier.startsWith('/');
  if (!isRelative) {
    // Check if it matches any tsconfig path alias
    let matched = false;
    for (const [alias, target] of aliasMap) {
      if (specifier === alias || specifier.startsWith(alias + '/')) {
        specifier = target + specifier.slice(alias.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Language-specific: Go internal packages (no dots), Python relative imports
      if (language === 'go') {
        // Go module-internal import — try relative to rootDir
        const candidate = join(rootDir, specifier);
        if (await fileExists(candidate + '.go')) return relative(rootDir, candidate + '.go').replace(/\\/g, '/');
      }
      return null; // external package
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Build candidate base path
  // ---------------------------------------------------------------------------
  const fromDir = dirname(fromFile);
  const base = resolve(fromDir, specifier);

  // ---------------------------------------------------------------------------
  // 3. Try exact match (already has extension)
  // ---------------------------------------------------------------------------
  if (extname(base) && await fileExists(base)) {
    const rel = relative(rootDir, base).replace(/\\/g, '/');
    if (fileIdSet.has(rel)) return rel;
  }

  // ---------------------------------------------------------------------------
  // 4. Try appending extensions
  // ---------------------------------------------------------------------------
  for (const ext of RESOLVABLE_EXTENSIONS) {
    const candidate = base + ext;
    if (await fileExists(candidate)) {
      const rel = relative(rootDir, candidate).replace(/\\/g, '/');
      if (fileIdSet.has(rel)) return rel;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Try directory/index files
  // ---------------------------------------------------------------------------
  for (const idx of INDEX_FILES) {
    const candidate = join(base, idx);
    if (await fileExists(candidate)) {
      const rel = relative(rootDir, candidate).replace(/\\/g, '/');
      if (fileIdSet.has(rel)) return rel;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Python __init__.py
  // ---------------------------------------------------------------------------
  if (language === 'python') {
    const candidate = join(base, '__init__.py');
    if (await fileExists(candidate)) {
      const rel = relative(rootDir, candidate).replace(/\\/g, '/');
      if (fileIdSet.has(rel)) return rel;
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Rust: mod X → X.rs or X/mod.rs
  // ---------------------------------------------------------------------------
  if (language === 'rust') {
    const rsFile = base + '.rs';
    if (await fileExists(rsFile)) {
      const rel = relative(rootDir, rsFile).replace(/\\/g, '/');
      if (fileIdSet.has(rel)) return rel;
    }
    const modRs = join(base, 'mod.rs');
    if (await fileExists(modRs)) {
      const rel = relative(rootDir, modRs).replace(/\\/g, '/');
      if (fileIdSet.has(rel)) return rel;
    }
  }

  return null;
}

export interface ResolveResult {
  edges: Edge[];
  unresolved: Array<{ from: string; specifier: string }>;
}

/**
 * Resolve imports for a subset of files against an explicit fileIdSet.
 * Used by the incremental patch to resolve only changed files while
 * still being able to resolve against the full index's known file IDs.
 */
export async function resolveImportsForFiles(
  files: IndexedFile[],
  fileIdSet: Set<string>,
  rootDir: string,
): Promise<ResolveResult> {
  const aliasMap = await loadTsConfigPaths(rootDir);

  const edges: Edge[] = [];
  const unresolved: Array<{ from: string; specifier: string }> = [];

  const BATCH = 50;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    await Promise.all(batch.map(async (file) => {
      for (const specifier of file.imports) {
        const resolved = await resolveSpecifier(
          specifier,
          file.path,
          fileIdSet,
          rootDir,
          aliasMap,
          file.language,
        );
        if (resolved && resolved !== file.id) {
          edges.push({ from: file.id, to: resolved, type: 'import', specifier });
        } else if (!resolved) {
          unresolved.push({ from: file.id, specifier });
        }
      }
    }));
  }

  return { edges, unresolved };
}

/**
 * Resolve imports for all files in a project. Builds fileIdSet from the
 * passed files array. For incremental patching, use resolveImportsForFiles instead.
 */
export async function resolveImports(
  files: IndexedFile[],
  rootDir: string,
): Promise<ResolveResult> {
  const fileIdSet = new Set(files.map(f => f.id));
  return resolveImportsForFiles(files, fileIdSet, rootDir);
}
