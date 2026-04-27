#!/usr/bin/env node
/**
 * coldstart-mcp — Local MCP server for AI agent codebase navigation.
 *
 * Usage:
 *   coldstart-mcp --root /path/to/project
 *   coldstart-mcp --root . --exclude vendor --quiet
 *   coldstart-mcp --root . --no-cache
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkDirectory } from './indexer/walker.js';
import { parseFile, buildFileId } from './indexer/parser.js';
import { resolveImports } from './indexer/resolvers/index.js';
import { buildGraph } from './indexer/graph.js';
import { buildFileDomains, isTestPath } from './indexer/tokenize.js';
import { buildSymbolEdges } from './indexer/symbol-edges.js';
import { getGitHead } from './indexer/git.js';
import { loadCachedIndex, saveCachedIndex } from './cache/disk-cache.js';
import { startMCPServer } from './server/mcp.js';
import { IndexManager } from './index-manager.js';
import type { CodebaseIndex, IndexedFile, SymbolEdge, DomainToken } from './types.js';

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
          importedByCount: 0,
          transitiveImportedByCount: 0,
          isBarrel: false,
          isTestFile: isTestPath(wf.relativePath),
          symbols: parsed.symbols,
          reexportRatio: parsed.reexportRatio,
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

  // 5. Attach importedByCount back to files
  for (const file of indexedFiles) {
    file.importedByCount = inEdges.get(file.id)?.length ?? 0;
  }

  // Build symbol-level edges (exports, calls with cross-file resolution, extends, implements)
  const filesMap = new Map<string, IndexedFile>(indexedFiles.map(f => [f.id, f]));
  const allSymbolEdgesBuilt = buildSymbolEdges(indexedFiles, outEdges, filesMap);
  allSymbolEdges.push(...allSymbolEdgesBuilt);

  // 6. Barrel detection: AST-based for TS/JS (reexportRatio), no heuristic for others
  for (const file of indexedFiles) {
    if (file.language === 'typescript' || file.language === 'javascript') {
      file.isBarrel = (
        (file.reexportRatio ?? 0) > 0.5 &&
        file.importedByCount > 1 &&
        file.exports.length > 0
      );
    }
    file.transitiveImportedByCount = file.importedByCount;
  }

  // Strip symbol-sourced tokens from barrel domains to prevent re-exported symbol pollution
  for (const file of indexedFiles) {
    if (!file.isBarrel) continue;
    const domains = file.domains as DomainToken[];
    file.domains = domains
      .map(dt => ({ token: dt.token, sources: dt.sources.filter(s => s !== 'symbol') }))
      .filter(dt => dt.sources.length > 0);
  }

  // 7. Token document frequency (skip barrels; skip import-only tokens — they inflate IDF)
  const tokenDocFreq = new Map<string, number>();
  for (const file of indexedFiles) {
    if (file.isBarrel) continue;
    const domains = file.domains as DomainToken[];
    const seen = new Set<string>();
    for (const dt of domains) {
      if (seen.has(dt.token)) continue;
      seen.add(dt.token);
      tokenDocFreq.set(dt.token, (tokenDocFreq.get(dt.token) ?? 0) + 1);
    }
  }

  // 8. Git head
  const gitHead = await getGitHead(rootDir);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(quiet, `[coldstart] Indexed ${indexedFiles.length} files in ${elapsed}s`);
  log(quiet, `[coldstart] Languages: ${Object.entries(langCount).map(([l, c]) => `${l}(${c})`).join(', ')}`);

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

  const { root: cliRoot, excludes, includes, cacheDir, quiet, noCache } = parseArgs(process.argv);
  
  let manager: IndexManager | null = null;

  await startMCPServer(
    async (clientRoots: string[]) => {
      let finalRoot = resolve(cliRoot);
      if (clientRoots && clientRoots.length > 0) {
        const uri = clientRoots[0];
        finalRoot = uri.startsWith('file://') ? fileURLToPath(uri) : resolve(uri);
      }

      log(quiet, `[coldstart] Starting — root: ${finalRoot}`);

      let index: CodebaseIndex | null = null;

      // Try cache first
      if (!noCache) {
        index = await loadCachedIndex(finalRoot, cacheDir);
        if (index) {
          // Invalidate cache if git HEAD has changed
          const currentHead = await getGitHead(finalRoot);
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
        index = await buildIndex(finalRoot, excludes, includes, quiet);
        if (!noCache) {
          try {
            await saveCachedIndex(index, cacheDir);
            log(quiet, '[coldstart] Index saved to cache');
          } catch (err) {
            log(quiet, `[coldstart] Warning: could not save cache: ${err}`);
          }
        }
      }

      manager = new IndexManager(
        index,
        () => buildIndex(finalRoot, excludes, includes, quiet),
        cacheDir,
        noCache,
        quiet,
      );

      log(quiet, '[coldstart] MCP server ready');
      manager.startWatching();
    },
    () => {
      if (!manager) {
        throw new Error("IndexManager is not yet initialized");
      }
      return manager.getContext();
    }
  );

  // Ensure watcher is stopped on process exit
  process.on('exit', () => manager?.stopWatching());
  process.on('SIGINT', () => { manager?.stopWatching(); process.exit(0); });
  process.on('SIGTERM', () => { manager?.stopWatching(); process.exit(0); });
}

main().catch(err => {
  process.stderr.write(`[coldstart] Fatal error: ${err}\n`);
  process.exit(1);
});
