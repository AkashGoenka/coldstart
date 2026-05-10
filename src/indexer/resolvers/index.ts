import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import type { IndexedFile, Edge, Language } from '../../types.js';
import { DEFAULT_EXCLUDES } from '../../constants.js';
import { resolveGeneric } from './generic.js';
import { resolveJava, resolveKotlin } from './java.js';
import { resolveRuby } from './ruby.js';
import { resolveGo } from './go.js';
import { resolveRust } from './rust.js';
import { resolvePython } from './python.js';
import { resolvePHP } from './php.js';
import { resolveCpp } from './cpp.js';
import { resolveCSharp } from './csharp.js';

// ---------------------------------------------------------------------------
// tsconfig path alias loader — follows `extends` chains, collects all targets
// ---------------------------------------------------------------------------

interface TsConfig {
  paths?: Record<string, string[]>;
  baseUrl?: string;
}

interface ResolvedTsConfig {
  paths: Record<string, string[]>;
  baseUrl?: string; // absolute path
}

async function loadTsConfigFile(
  configPath: string,
  visited: Set<string>,
): Promise<ResolvedTsConfig> {
  const result: ResolvedTsConfig = { paths: {} };
  if (visited.has(configPath)) return result;
  visited.add(configPath);

  try {
    const raw = await readFile(configPath, 'utf-8');
    const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const cfg = JSON.parse(stripped) as {
      compilerOptions?: TsConfig;
      extends?: string | string[];
    };
    const configDir = dirname(configPath);

    // Follow extends chain first — child config overrides parent
    const extendsField = cfg.extends;
    if (extendsField) {
      const extendsList = Array.isArray(extendsField) ? extendsField : [extendsField];
      for (const ext of extendsList) {
        const withJson = ext.endsWith('.json') ? ext : ext + '.json';
        const extPath = resolve(configDir, withJson);
        try {
          const parent = await loadTsConfigFile(extPath, visited);
          for (const [k, v] of Object.entries(parent.paths)) result.paths[k] = v;
          if (parent.baseUrl) result.baseUrl = parent.baseUrl;
        } catch {
          // ignore missing or malformed extended config
        }
      }
    }

    // Child overrides parent
    const compOpts = cfg.compilerOptions;
    if (compOpts?.baseUrl) result.baseUrl = resolve(configDir, compOpts.baseUrl);
    if (compOpts?.paths) {
      for (const [alias, targets] of Object.entries(compOpts.paths)) {
        result.paths[alias] = targets;
      }
    }
  } catch {
    // ignore missing or malformed tsconfig
  }

  return result;
}

async function loadTsConfigPaths(rootDir: string): Promise<Map<string, string[]>> {
  const aliasMap = new Map<string, string[]>();

  // Discover every tsconfig.json/jsconfig.json under rootDir, not just the
  // top-level one — repos often nest the actual project (e.g. <repo>/<clone>/tsconfig.json).
  // For each tsconfig, paths resolve relative to its own dir (or its explicit baseUrl).
  const tscPaths = await findConfigFiles(
    rootDir,
    new Set(['tsconfig.json', 'jsconfig.json']),
  );

  for (const tscPath of tscPaths) {
    try {
      const resolved = await loadTsConfigFile(tscPath, new Set());
      if (!Object.keys(resolved.paths).length) continue;
      const tsconfigDir = dirname(tscPath);
      const baseDir = resolved.baseUrl ?? tsconfigDir;

      for (const [alias, targets] of Object.entries(resolved.paths)) {
        const aliasKey = alias.replace(/\/\*$/, '');
        const resolvedTargets = targets.map(t => resolve(baseDir, t.replace(/\/\*$/, '')));
        const existing = aliasMap.get(aliasKey);
        // Merge — multiple tsconfigs may define the same alias pointing into
        // their own clone. Resolution tries each target until one matches.
        aliasMap.set(aliasKey, existing ? [...existing, ...resolvedTargets] : resolvedTargets);
      }
    } catch {
      // ignore
    }
  }

  return aliasMap;
}

// ---------------------------------------------------------------------------
// Workspace package discovery (npm/yarn/pnpm)
// ---------------------------------------------------------------------------

async function expandWorkspacePattern(rootDir: string, pattern: string): Promise<string[]> {
  if (pattern.startsWith('!')) return []; // negation patterns
  if (!pattern.includes('*')) return [join(rootDir, pattern)]; // literal path

  // Patterns can have a wildcard in any segment: "shared/*", "*-app", "packages/*/lib".
  // Walk segment-by-segment, expanding `*` segments by listing matching subdirs.
  const segments = pattern.split('/');
  let dirs: string[] = [rootDir];

  for (const seg of segments) {
    if (!seg.includes('*')) {
      dirs = dirs.map(d => join(d, seg));
      continue;
    }
    // Convert glob segment to a regex (only `*` is supported here)
    const regex = new RegExp('^' + seg.split('*').map(escapeRegex).join('.*') + '$');
    const next: string[] = [];
    for (const d of dirs) {
      try {
        const entries = await readdir(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && regex.test(e.name)) next.push(join(d, e.name));
        }
      } catch { /* skip */ }
    }
    dirs = next;
  }

  return dirs;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk rootDir looking for files whose basenames are in the `targets` set.
 * Skips DEFAULT_EXCLUDES, hidden dirs, and symlinks. Bounded depth as a safety rail.
 */
async function findConfigFiles(
  rootDir: string,
  targets: Set<string>,
  maxDepth = 8,
): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (DEFAULT_EXCLUDES.has(entry.name)) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && targets.has(entry.name)) {
        found.push(fullPath);
      }
    }
  }
  await walk(rootDir, 0);
  return found;
}

async function loadWorkspacePackages(rootDir: string): Promise<Map<string, string[]>> {
  const packageMap = new Map<string, string[]>();

  // Find every package.json and pnpm-workspace.yaml under rootDir.
  // Each one with a workspaces declaration acts as a workspace root for its own subtree.
  // This handles monorepos where rootDir isn't the workspace root (e.g. user runs on
  // a parent directory containing `aurora/package.json` but no top-level package.json).
  const configPaths = await findConfigFiles(
    rootDir,
    new Set(['package.json', 'pnpm-workspace.yaml']),
  );

  // (workspaceRootDir, patterns[]) pairs — patterns are relative to workspaceRootDir
  const decls: Array<{ dir: string; patterns: string[] }> = [];

  for (const path of configPaths) {
    const baseName = path.slice(path.lastIndexOf('/') + 1);
    if (baseName === 'package.json') {
      try {
        const raw = await readFile(path, 'utf-8');
        const pkg = JSON.parse(raw);
        const ws = pkg.workspaces;
        const patterns: string[] = [];
        if (Array.isArray(ws)) patterns.push(...ws);
        else if (Array.isArray(ws?.packages)) patterns.push(...ws.packages); // yarn classic
        if (patterns.length > 0) decls.push({ dir: dirname(path), patterns });
      } catch { /* malformed package.json — skip */ }
    } else {
      // pnpm-workspace.yaml
      try {
        const yaml = await readFile(path, 'utf-8');
        const patterns: string[] = [];
        for (const line of yaml.split('\n')) {
          const m = line.match(/^\s+-\s+['"]?([^'"#\s]+)['"]?/);
          if (m && !m[1].startsWith('!')) patterns.push(m[1]);
        }
        if (patterns.length > 0) decls.push({ dir: dirname(path), patterns });
      } catch { /* skip */ }
    }
  }

  for (const { dir, patterns } of decls) {
    for (const pattern of patterns) {
      const memberDirs = await expandWorkspacePattern(dir, pattern);
      for (const memberDir of memberDirs) {
        try {
          const raw = await readFile(join(memberDir, 'package.json'), 'utf-8');
          const pkg = JSON.parse(raw);
          if (typeof pkg.name === 'string') packageMap.set(pkg.name, [memberDir]);
        } catch { /* no package.json in this workspace dir */ }
      }
    }
  }

  return packageMap;
}

async function buildAliasMap(rootDir: string): Promise<Map<string, string[]>> {
  const [workspaceMap, tsconfigMap] = await Promise.all([
    loadWorkspacePackages(rootDir),
    loadTsConfigPaths(rootDir),
  ]);
  // Merge: tsconfig entries override workspace entries (more explicit)
  return new Map([...workspaceMap, ...tsconfigMap]);
}

// ---------------------------------------------------------------------------
// Language dispatch
// ---------------------------------------------------------------------------

type ResolverFn = (
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  aliasMap: Map<string, string[]>,
) => Promise<string | null>;

function getResolver(language: Language): ResolverFn {
  switch (language) {
    case 'java':   return resolveJava;
    case 'kotlin': return resolveKotlin;
    case 'ruby':   return resolveRuby;
    case 'go':     return resolveGo;
    case 'rust':   return resolveRust;
    case 'python': return resolvePython;
    case 'php':    return resolvePHP;
    case 'cpp':    return resolveCpp;
    case 'csharp': return resolveCSharp;
    default:       return resolveGeneric;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
  const aliasMap = await buildAliasMap(rootDir);

  const edges: Edge[] = [];
  const unresolved: Array<{ from: string; specifier: string }> = [];

  const BATCH = 50;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    await Promise.all(batch.map(async (file) => {
      const resolver = getResolver(file.language);
      for (const specifier of file.imports) {
        const resolved = await resolver(specifier, file.path, fileIdSet, rootDir, aliasMap);
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
