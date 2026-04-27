import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { IndexedFile, Edge, Language } from '../../types.js';
import { resolveGeneric } from './generic.js';
import { resolveJava } from './java.js';
import { resolveRuby } from './ruby.js';
import { resolveGo } from './go.js';
import { resolveRust } from './rust.js';
import { resolvePython } from './python.js';

// ---------------------------------------------------------------------------
// tsconfig path alias loader (shared across all resolvers)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Language dispatch
// ---------------------------------------------------------------------------

type ResolverFn = (
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  aliasMap: Map<string, string>,
) => Promise<string | null>;

function getResolver(language: Language): ResolverFn {
  switch (language) {
    case 'java':   return resolveJava;
    case 'ruby':   return resolveRuby;
    case 'go':     return resolveGo;
    case 'rust':   return resolveRust;
    case 'python': return resolvePython;
    default:       return resolveGeneric;
  }
}

// ---------------------------------------------------------------------------
// Public API (same contract as the old resolver.ts)
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
  const aliasMap = await loadTsConfigPaths(rootDir);

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
