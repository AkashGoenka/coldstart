import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import type { IndexedFile, Edge, Language } from '../../types.js';
import { resolveGeneric } from './generic.js';
import { resolveJava } from './java.js';
import { resolveRuby } from './ruby.js';
import { resolveGo } from './go.js';
import { resolveRust } from './rust.js';
import { resolvePython } from './python.js';
import { resolvePHP } from './php.js';
import { resolveCpp } from './cpp.js';

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

  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const tscPath = join(rootDir, name);
    try {
      const resolved = await loadTsConfigFile(tscPath, new Set());
      if (!Object.keys(resolved.paths).length) continue;
      const baseDir = resolved.baseUrl ?? rootDir;

      for (const [alias, targets] of Object.entries(resolved.paths)) {
        const aliasKey = alias.replace(/\/\*$/, '');
        const resolvedTargets = targets.map(t => resolve(baseDir, t.replace(/\/\*$/, '')));
        aliasMap.set(aliasKey, resolvedTargets);
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
  if (pattern.endsWith('/*')) {
    // e.g. "shared/*" → list all direct subdirectories of rootDir/shared
    const baseDir = join(rootDir, pattern.slice(0, -2));
    try {
      const entries = await readdir(baseDir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => join(baseDir, e.name));
    } catch {
      return [];
    }
  }
  if (pattern.includes('*')) return []; // complex globs — skip without a glob library
  return [join(rootDir, pattern)]; // literal path
}

async function loadWorkspacePackages(rootDir: string): Promise<Map<string, string[]>> {
  const packageMap = new Map<string, string[]>();
  const patterns: string[] = [];

  // npm / yarn: package.json workspaces field
  try {
    const raw = await readFile(join(rootDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) patterns.push(...ws);
    else if (Array.isArray(ws?.packages)) patterns.push(...ws.packages); // yarn classic
  } catch { /* no package.json */ }

  // pnpm: pnpm-workspace.yaml — parse without a yaml library
  try {
    const yaml = await readFile(join(rootDir, 'pnpm-workspace.yaml'), 'utf-8');
    for (const line of yaml.split('\n')) {
      const m = line.match(/^\s+-\s+['"]?([^'"#\s]+)['"]?/);
      if (m && !m[1].startsWith('!')) patterns.push(m[1]);
    }
  } catch { /* no pnpm-workspace.yaml */ }

  for (const pattern of patterns) {
    const dirs = await expandWorkspacePattern(rootDir, pattern);
    for (const dir of dirs) {
      try {
        const raw = await readFile(join(dir, 'package.json'), 'utf-8');
        const pkg = JSON.parse(raw);
        if (typeof pkg.name === 'string') packageMap.set(pkg.name, [dir]);
      } catch { /* no package.json in this workspace dir */ }
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
    case 'ruby':   return resolveRuby;
    case 'go':     return resolveGo;
    case 'rust':   return resolveRust;
    case 'python': return resolvePython;
    case 'php':    return resolvePHP;
    case 'cpp':    return resolveCpp;
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
