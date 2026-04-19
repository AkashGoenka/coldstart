#!/usr/bin/env node
/**
 * coldstart-mcp — Local MCP server for AI agent codebase navigation.
 *
 * Usage:
 *   coldstart-mcp --root /path/to/project
 *   coldstart-mcp --root . --exclude vendor --quiet
 *   coldstart-mcp --root . --no-cache
 */
import { resolve, basename, extname } from 'node:path';
import { walkDirectory } from './indexer/walker.js';
import { parseFile, buildFileId } from './indexer/parser.js';
import { resolveImports } from './indexer/resolver.js';
import { buildGraph, computeDepth } from './indexer/graph.js';
import { buildFileDomains } from './indexer/tokenize.js';
import { getGitHead } from './indexer/git.js';
import { loadCachedIndex, saveCachedIndex } from './cache/disk-cache.js';
import { startMCPServer } from './server/mcp.js';
import { ARCH_ROLE_PATTERNS } from './constants.js';
import type { CodebaseIndex, IndexedFile, SymbolEdge, ArchRole } from './types.js';

// ---------------------------------------------------------------------------
// Argument parsing (no external deps)
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]): {
  root: string;
  excludes: string[];
  includes: string[];
  cacheDir?: string;
  quiet: boolean;
  noCache: boolean;
} {
  const args = argv.slice(2);
  let root = '.';
  const excludes: string[] = [];
  const includes: string[] = [];
  let cacheDir: string | undefined;
  let quiet = false;
  let noCache = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--root':
        root = args[++i] ?? root;
        break;
      case '--exclude':
        excludes.push(args[++i] ?? '');
        break;
      case '--include':
        includes.push(args[++i] ?? '');
        break;
      case '--cache-dir':
        cacheDir = args[++i];
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--no-cache':
        noCache = true;
        break;
    }
  }

  return { root, excludes, includes, cacheDir, quiet, noCache };
}

// ---------------------------------------------------------------------------
// Logging (to stderr so stdout stays clean for MCP)
// ---------------------------------------------------------------------------
function log(quiet: boolean, ...args: unknown[]): void {
  if (!quiet) process.stderr.write(args.join(' ') + '\n');
}

// ---------------------------------------------------------------------------
// Full indexing pipeline
// ---------------------------------------------------------------------------
async function buildIndex(
  rootDir: string,
  excludes: string[],
  includes: string[],
  quiet: boolean,
): Promise<CodebaseIndex> {
  const start = Date.now();

  // 1. Walk
  log(quiet, '[coldstart] Walking filesystem...');
  const walkedFiles = await walkDirectory({ rootDir, excludes, includes });
  log(quiet, `[coldstart] Found ${walkedFiles.length} source files`);

  // 2. Parse
  log(quiet, '[coldstart] Parsing files...');
  const indexedFiles: IndexedFile[] = [];
  const langCount: Record<string, number> = {};

  const allSymbolEdges: SymbolEdge[] = [];

  await Promise.all(
    walkedFiles.map(async (wf) => {
      try {
        const id = buildFileId(wf.relativePath);
        const parsed = await parseFile(wf.absolutePath, wf.language, id);
        if (!parsed) return;

        const file: IndexedFile = {
          id,
          path: wf.absolutePath,
          relativePath: wf.relativePath,
          language: wf.language,
          domains: buildFileDomains(wf.relativePath, parsed.exports),
          exports: parsed.exports,
          hasDefaultExport: parsed.hasDefaultExport,
          imports: parsed.imports,
          hash: parsed.hash,
          lineCount: parsed.lineCount,
          tokenEstimate: parsed.tokenEstimate,
          isEntryPoint: parsed.isEntryPoint,
          archRole: parsed.archRole,
          importedByCount: 0,
          transitiveImportedByCount: 0,
          isBarrel: false,
          depth: Infinity,
          symbols: parsed.symbols,
        };
        indexedFiles.push(file);
        langCount[wf.language] = (langCount[wf.language] ?? 0) + 1;
      } catch (err) {
        log(quiet, `[coldstart] Error parsing ${wf.relativePath}: ${err}`);
      }
    }),
  );

  // 3. Resolve imports → edges
  log(quiet, '[coldstart] Resolving imports...');
  const { edges, unresolved } = await resolveImports(indexedFiles, rootDir);
  log(quiet, `[coldstart] Resolved ${edges.length} edges (${unresolved.length} unresolved)`);

  // 4. Build graph
  log(quiet, '[coldstart] Building graph...');
  const nodeIds = indexedFiles.map(f => f.id);
  const { outEdges, inEdges } = buildGraph(nodeIds, edges);

  // 5. Depth from entry points
  const entryPointIds = indexedFiles.filter(f => f.isEntryPoint).map(f => f.id);
  const depthMap = computeDepth(entryPointIds, outEdges);

  // Attach importedByCount and depth back to files
  for (const file of indexedFiles) {
    file.importedByCount = inEdges.get(file.id)?.length ?? 0;
    file.depth = depthMap.get(file.id) ?? Infinity;
  }

  // Reclassify entry points: barrel files (index.ts etc.) that are heavily imported
  // are not real entry points — real entry points have 0 or 1 importers
  for (const file of indexedFiles) {
    if (file.isEntryPoint && (inEdges.get(file.id)?.length ?? 0) > 1) {
      file.isEntryPoint = false;
      if (file.archRole === 'entry') {
        const pathLower = file.relativePath.toLowerCase();
        file.archRole = 'unknown' as ArchRole;
        for (const { pattern, role } of ARCH_ROLE_PATTERNS) {
          if (pattern.test(pathLower)) {
            file.archRole = role as ArchRole;
            break;
          }
        }
      }
    }
  }

  // Build symbol-level edges from all TS/JS files
  for (const file of indexedFiles) {
    for (const sym of file.symbols) {
      // exports: file → symbol
      if (sym.isExported) {
        allSymbolEdges.push({ from: file.id, to: sym.id, type: 'exports' });
      }
      // calls: symbol → symbol/name
      for (const callee of sym.calls) {
        allSymbolEdges.push({ from: sym.id, to: callee, type: 'calls' });
      }
      // extends: symbol → name
      if (sym.extendsName) {
        allSymbolEdges.push({ from: sym.id, to: sym.extendsName, type: 'extends' });
      }
      // implements: symbol → name
      for (const iface of sym.implementsNames) {
        allSymbolEdges.push({ from: sym.id, to: iface, type: 'implements' });
      }
    }
  }

  // 6. Barrel detection (must run before tokenDocFreq so barrels are excluded)
  for (const file of indexedFiles) {
    const fname = basename(file.relativePath, extname(file.relativePath)).toLowerCase();
    file.isBarrel = (
      fname === 'index' &&
      file.importedByCount > 1 &&
      (outEdges.get(file.id)?.length ?? 0) > 0 &&
      file.exports.length > 0
    );
    file.transitiveImportedByCount = file.importedByCount;
  }

  // 7. Token document frequency (skip barrels — their re-exported tokens inflate IDF)
  const tokenDocFreq = new Map<string, number>();
  for (const file of indexedFiles) {
    if (file.isBarrel) continue;
    for (const token of new Set(file.domains)) {
      tokenDocFreq.set(token, (tokenDocFreq.get(token) ?? 0) + 1);
    }
  }

  // 8. Git head
  const gitHead = await getGitHead(rootDir);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(quiet, `[coldstart] Indexed ${indexedFiles.length} files in ${elapsed}s`);
  log(quiet, `[coldstart] Languages: ${Object.entries(langCount).map(([l, c]) => `${l}(${c})`).join(', ')}`);

  const filesMap = new Map<string, IndexedFile>(indexedFiles.map(f => [f.id, f]));

  // Inflate transitiveImportedByCount through barrel files
  for (const file of indexedFiles) {
    if (!file.isBarrel) continue;
    for (const childId of outEdges.get(file.id) ?? []) {
      const child = filesMap.get(childId);
      if (child) child.transitiveImportedByCount += file.importedByCount;
    }
  }

  const index: CodebaseIndex = {
    rootDir,
    files: filesMap,
    edges,
    symbolEdges: allSymbolEdges,
    outEdges,
    inEdges,
    tokenDocFreq,
    indexedAt: Date.now(),
    gitHead,
  };

  return index;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Check for 'init' subcommand — prints MCP config and agent rules for manual setup
  if (process.argv[2] === 'init') {
    const { runInit } = await import('./init.js');
    runInit();
    return;
  }

  const { root, excludes, includes, cacheDir, quiet, noCache } = parseArgs(process.argv);
  const rootDir = resolve(root);

  log(quiet, `[coldstart] Starting — root: ${rootDir}`);

  let index: CodebaseIndex | null = null;

  // Try cache first
  if (!noCache) {
    index = await loadCachedIndex(rootDir, cacheDir);
    if (index) {
      // Invalidate cache if git HEAD has changed (branch switch, new commit)
      const currentHead = await getGitHead(rootDir);
      if (currentHead && index.gitHead && currentHead !== index.gitHead) {
        log(quiet, '[coldstart] Git HEAD changed, rebuilding index...');
        index = null;
      } else {
        log(quiet, '[coldstart] Loaded from cache');
      }
    }
  }

  // Build fresh index if needed
  if (!index) {
    index = await buildIndex(rootDir, excludes, includes, quiet);
    if (!noCache) {
      try {
        await saveCachedIndex(index, cacheDir);
        log(quiet, '[coldstart] Index saved to cache');
      } catch (err) {
        log(quiet, `[coldstart] Warning: could not save cache: ${err}`);
      }
    }
  }

  // Start MCP server
  log(quiet, '[coldstart] MCP server ready');
  await startMCPServer(index);
}

main().catch(err => {
  process.stderr.write(`[coldstart] Fatal error: ${err}\n`);
  process.exit(1);
});
