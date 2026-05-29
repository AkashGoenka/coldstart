#!/usr/bin/env node
/**
 * coldstart-mcp — Local MCP server for AI agent codebase navigation.
 *
 * Usage:
 *   coldstart-mcp --root /path/to/project
 *   coldstart-mcp --root . --exclude vendor --quiet
 *   coldstart-mcp --root . --no-cache
 *   coldstart-mcp --root . --no-daemon    # bypass daemon (single-process stdio mode)
 *
 * Subcommands:
 *   coldstart-mcp init        # interactive setup for Claude Code / Cursor
 *   coldstart-mcp status      # list every running daemon and its health
 *
 * Internal (spawned automatically):
 *   coldstart-mcp --root . --daemon       # background index daemon
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkDirectory } from './indexer/walker.js';
import { parseFile, buildFileId } from './indexer/parser.js';
import { resolveImports } from './indexer/resolvers/index.js';
import { addRailsSyntheticEdges } from './indexer/rails-synthetic.js';
import { addLaravelSyntheticEdges } from './indexer/laravel-synthetic.js';
import { addCSharpSyntheticEdges } from './indexer/csharp-synthetic.js';
import { addDjangoSyntheticEdges } from './indexer/django-synthetic.js';
import { buildGraph } from './indexer/graph.js';
import { buildFileDomains, isTestPath } from './indexer/tokenize.js';
import { buildSymbolEdges } from './indexer/symbol-edges.js';
import { getGitHead } from './indexer/git.js';
import { loadCachedIndex, saveCachedIndex } from './cache/disk-cache.js';
import { startMCPServer } from './server/mcp.js';
import { startDaemonHttpServer } from './server/http-daemon.js';
import { startBridge } from './server/bridge.js';
import { IndexManager } from './index-manager.js';
import { readLock, writeLock, deleteLock, isDaemonAlive, getCurrentVersion, watchOwnLockfile } from './daemon-lock.js';
import { attachDaemonLogger } from './daemon-log.js';
import { migrateLegacyMcpConfig } from './migrate.js';
import type { CodebaseIndex, IndexedFile, SymbolEdge } from './types.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]): {
  root: string;
  rootExplicit: boolean;
  excludes: string[];
  includes: string[];
  cacheDir?: string;
  quiet: boolean;
  noCache: boolean;
  daemon: boolean;
  noDaemon: boolean;
  probe: boolean;
} {
  const args = argv.slice(2);
  let root = '.';
  let rootExplicit = false;
  const excludes: string[] = [];
  const includes: string[] = [];
  let cacheDir: string | undefined;
  let quiet = false;
  let noCache = false;
  let daemon = false;
  let noDaemon = false;
  let probe = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--root':
        root = args[++i] ?? root;
        rootExplicit = true;
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
      case '--daemon':
        daemon = true;
        break;
      case '--no-daemon':
        noDaemon = true;
        break;
      case '--probe':
        probe = true;
        break;
    }
  }

  return { root, rootExplicit, excludes, includes, cacheDir, quiet, noCache, daemon, noDaemon, probe };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(quiet: boolean, ...args: unknown[]): void {
  if (!quiet) process.stderr.write(args.join(' ') + '\n');
}

// ---------------------------------------------------------------------------
// Full indexing pipeline
// ---------------------------------------------------------------------------
export async function buildIndex(
  rootDir: string,
  excludes: string[],
  includes: string[],
  quiet: boolean,
): Promise<CodebaseIndex> {
  const start = Date.now();

  log(quiet, '[coldstart] Walking filesystem...');
  const walkedFiles = await walkDirectory({ rootDir, excludes, includes });
  log(quiet, `[coldstart] Found ${walkedFiles.length} source files`);

  log(quiet, '[coldstart] Parsing files...');
  const indexedFiles: IndexedFile[] = [];
  const langCount: Record<string, number> = {};
  const allSymbolEdges: SymbolEdge[] = [];

  const BATCH_SIZE = 100;
  const PROGRESS_INTERVAL = 500;
  let parsed_count = 0;

  for (let i = 0; i < walkedFiles.length; i += BATCH_SIZE) {
    const batch = walkedFiles.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (wf) => {
        try {
          const id = buildFileId(wf.relativePath);
          const parsed = await parseFile(wf.absolutePath, wf.language, id);
          if (!parsed) return;

          const file: IndexedFile = {
            id,
            path: wf.absolutePath,
            relativePath: wf.relativePath,
            language: wf.language,
            domainMap: buildFileDomains(wf.relativePath, parsed.exports),
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
            constantReferences: parsed.constantReferences,
            partialDeclarations: parsed.partialDeclarations,
            eloquentRelations: parsed.eloquentRelations,
            containerResolutions: parsed.containerResolutions,
            djangoConventionRefs: parsed.djangoConventionRefs,
            submoduleImportCandidates: parsed.submoduleImportCandidates,
          };
          indexedFiles.push(file);
          langCount[wf.language] = (langCount[wf.language] ?? 0) + 1;
        } catch (err) {
          log(quiet, `[coldstart] Error parsing ${wf.relativePath}: ${err}`);
        } finally {
          parsed_count++;
        }
      }),
    );

    const prevMilestone = Math.floor((parsed_count - batch.length) / PROGRESS_INTERVAL);
    const currMilestone = Math.floor(parsed_count / PROGRESS_INTERVAL);
    const isLast = parsed_count === walkedFiles.length;
    if (currMilestone > prevMilestone || isLast) {
      const pct = Math.round((parsed_count / walkedFiles.length) * 100);
      log(quiet, `[coldstart] ${parsed_count} / ${walkedFiles.length} parsed (${pct}%)`);
    }
  }

  log(quiet, '[coldstart] Resolving imports...');
  const { edges, unresolved } = await resolveImports(indexedFiles, rootDir);
  log(quiet, `[coldstart] Resolved ${edges.length} edges (${unresolved.length} unresolved)`);

  const fullFileIdSet = new Set(indexedFiles.map(f => f.id));
  await addRailsSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  await addLaravelSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  await addCSharpSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  await addDjangoSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  if (!quiet) {
    const langById = new Map(indexedFiles.map(f => [f.id, f.language]));
    const stats: Record<string, { r: number; u: number }> = {};
    for (const e of edges)  { const l = langById.get(e.from)!; (stats[l] ??= { r: 0, u: 0 }).r++; }
    for (const u of unresolved) { const l = langById.get(u.from)!; (stats[l] ??= { r: 0, u: 0 }).u++; }
    const breakdown = Object.entries(stats)
      .sort((a, b) => (b[1].r + b[1].u) - (a[1].r + a[1].u))
      .map(([l, s]) => `${l}(${s.r}/${s.r + s.u})`)
      .join(', ');
    if (breakdown) process.stderr.write(`[coldstart] Resolution by language: ${breakdown}\n`);
  }

  log(quiet, '[coldstart] Building graph...');
  const nodeIds = indexedFiles.map(f => f.id);
  const { outEdges, inEdges } = buildGraph(nodeIds, edges);

  for (const file of indexedFiles) {
    file.importedByCount = inEdges.get(file.id)?.length ?? 0;
  }

  const filesMap = new Map<string, IndexedFile>(indexedFiles.map(f => [f.id, f]));
  const allSymbolEdgesBuilt = buildSymbolEdges(indexedFiles, outEdges, filesMap);
  for (const e of allSymbolEdgesBuilt) allSymbolEdges.push(e);

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

  for (const file of indexedFiles) {
    if (!file.isBarrel) continue;
    for (const [token, ev] of Object.entries(file.domainMap)) {
      if (ev.filename === 0 && ev.path === 0) {
        delete file.domainMap[token];
      } else {
        file.domainMap[token] = { ...ev, symbol: 0 };
      }
    }
  }

  const tokenDocFreq = new Map<string, number>();
  for (const file of indexedFiles) {
    if (file.isBarrel) continue;
    for (const token of Object.keys(file.domainMap)) {
      tokenDocFreq.set(token, (tokenDocFreq.get(token) ?? 0) + 1);
    }
  }

  const gitHead = await getGitHead(rootDir);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(quiet, `[coldstart] Indexed ${indexedFiles.length} files in ${elapsed}s`);
  log(quiet, `[coldstart] Languages: ${Object.entries(langCount).map(([l, c]) => `${l}(${c})`).join(', ')}`);

  for (const file of indexedFiles) {
    if (!file.isBarrel) continue;
    for (const childId of outEdges.get(file.id) ?? []) {
      const child = filesMap.get(childId);
      if (child) child.transitiveImportedByCount += file.importedByCount;
    }
  }

  return {
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
}

// Bucket an edge specifier into a coarse key for --probe output.
// - synthetic prefixes like `const:Foo` / `partial:UserService` → `const:*` / `partial:*`
//   (last segment is class-like, generalize it)
// - `convention:django:middleware` → keep as-is (categorical, not class-specific)
// - regular imports (file paths, package names, no colon) → `regular`
function bucketSpecifier(spec: string): string {
  if (!spec.includes(':')) return 'regular';
  const parts = spec.split(':');
  const last = parts[parts.length - 1];
  if (/^[A-Z]/.test(last)) return parts.slice(0, -1).join(':') + ':*';
  return spec;
}

// ---------------------------------------------------------------------------
// Probe mode: walk → parse → resolve, emit JSON stats to stdout, exit.
// Per-language: total imports, resolved, unresolved, plus top-N unresolved
// specifiers (with sample fromFile) so we can tell external libs apart from
// broken-internal resolution gaps.
// ---------------------------------------------------------------------------
async function runProbe(rootDir: string, excludes: string[], includes: string[]): Promise<void> {
  const start = Date.now();
  const walked = await walkDirectory({ rootDir, excludes, includes });
  const tWalk = Date.now() - start;
  const tParseStart = Date.now();

  const indexedFiles: IndexedFile[] = [];
  for (let i = 0; i < walked.length; i += 100) {
    const batch = walked.slice(i, i + 100);
    await Promise.all(batch.map(async (wf) => {
      try {
        const id = buildFileId(wf.relativePath);
        const parsed = await parseFile(wf.absolutePath, wf.language, id);
        if (!parsed) return;
        indexedFiles.push({
          id,
          path: wf.absolutePath,
          relativePath: wf.relativePath,
          language: wf.language,
          domainMap: {},
          exports: parsed.exports,
          hasDefaultExport: parsed.hasDefaultExport,
          imports: parsed.imports,
          hash: parsed.hash,
          lineCount: parsed.lineCount,
          tokenEstimate: parsed.tokenEstimate,
          importedByCount: 0,
          transitiveImportedByCount: 0,
          isBarrel: false,
          isTestFile: false,
          symbols: parsed.symbols,
          reexportRatio: parsed.reexportRatio,
          constantReferences: parsed.constantReferences,
          partialDeclarations: parsed.partialDeclarations,
          eloquentRelations: parsed.eloquentRelations,
          containerResolutions: parsed.containerResolutions,
          djangoConventionRefs: parsed.djangoConventionRefs,
          submoduleImportCandidates: parsed.submoduleImportCandidates,
        });
      } catch { /* skip parse errors */ }
    }));
  }

  const tParse = Date.now() - tParseStart;
  const tResolveStart = Date.now();
  const { resolveImportsForFiles } = await import('./indexer/resolvers/index.js');

  // Per-language resolve timing — pass the FULL fileIdSet (resolvers index it
  // once via WeakMap) but invoke per-language so we can attribute time. Java
  // resolves to Kotlin files and vice versa, so we must not narrow the set.
  const fullFileIdSet = new Set(indexedFiles.map(f => f.id));
  const filesByLang = new Map<string, IndexedFile[]>();
  for (const f of indexedFiles) {
    const arr = filesByLang.get(f.language) ?? [];
    arr.push(f);
    filesByLang.set(f.language, arr);
  }
  const langTimes: Record<string, number> = {};
  let allEdges: Awaited<ReturnType<typeof resolveImportsForFiles>>['edges'] = [];
  let allUnresolved: Awaited<ReturnType<typeof resolveImportsForFiles>>['unresolved'] = [];
  for (const [lang, files] of filesByLang) {
    const t0 = Date.now();
    const r = await resolveImportsForFiles(files, fullFileIdSet, rootDir);
    langTimes[lang] = Date.now() - t0;
    allEdges = allEdges.concat(r.edges);
    allUnresolved = allUnresolved.concat(r.unresolved);
  }
  const edges = allEdges;
  const unresolved = allUnresolved;
  const tResolve = Date.now() - tResolveStart;

  await addRailsSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  await addLaravelSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  await addCSharpSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  await addDjangoSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);

  const langById = new Map(indexedFiles.map(f => [f.id, f.language]));
  const fileById = new Map(indexedFiles.map(f => [f.id, f.relativePath]));

  type LangBucket = {
    files: number;
    totalImports: number;
    resolved: number;
    unresolved: number;
    unresolvedBySpec: Map<string, { count: number; sampleFrom: string }>;
  };
  const byLang = new Map<string, LangBucket>();
  const get = (l: string): LangBucket => {
    let b = byLang.get(l);
    if (!b) {
      b = { files: 0, totalImports: 0, resolved: 0, unresolved: 0, unresolvedBySpec: new Map() };
      byLang.set(l, b);
    }
    return b;
  };

  for (const f of indexedFiles) { get(f.language).files++; get(f.language).totalImports += f.imports.length; }
  for (const e of edges) { get(langById.get(e.from)!).resolved++; }
  for (const u of unresolved) {
    const b = get(langById.get(u.from)!);
    b.unresolved++;
    const existing = b.unresolvedBySpec.get(u.specifier);
    if (existing) existing.count++;
    else b.unresolvedBySpec.set(u.specifier, { count: 1, sampleFrom: fileById.get(u.from) ?? '' });
  }

  const edgesBySpecifier: Record<string, number> = {};
  for (const e of edges) {
    const bucket = bucketSpecifier(e.specifier);
    edgesBySpecifier[bucket] = (edgesBySpecifier[bucket] ?? 0) + 1;
  }
  const sortedEdgesBySpecifier = Object.fromEntries(
    Object.entries(edgesBySpecifier).sort((a, b) => b[1] - a[1]),
  );

  const out = {
    rootDir,
    totalFiles: indexedFiles.length,
    totalEdges: edges.length,
    totalUnresolved: unresolved.length,
    elapsedMs: Date.now() - start,
    phaseMs: { walk: tWalk, parse: tParse, resolve: tResolve, resolveByLang: langTimes },
    edgesBySpecifier: sortedEdgesBySpecifier,
    languages: Object.fromEntries(
      [...byLang.entries()]
        .sort((a, b) => b[1].totalImports - a[1].totalImports)
        .map(([lang, b]) => [lang, {
          files: b.files,
          totalImports: b.totalImports,
          resolved: b.resolved,
          unresolved: b.unresolved,
          resolvedRatio: b.totalImports > 0 ? +(b.resolved / b.totalImports).toFixed(3) : 0,
          topUnresolved: [...b.unresolvedBySpec.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 30)
            .map(([specifier, v]) => ({ specifier, count: v.count, sampleFrom: v.sampleFrom })),
        }]),
    ),
  };

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Shared: load from cache or build, then create and return an IndexManager
// ---------------------------------------------------------------------------
async function buildManager(
  finalRoot: string,
  excludes: string[],
  includes: string[],
  cacheDir: string | undefined,
  quiet: boolean,
  noCache: boolean,
): Promise<IndexManager> {
  let index: CodebaseIndex | null = null;

  if (!noCache) {
    index = await loadCachedIndex(finalRoot, cacheDir);
    if (index) {
      const currentHead = await getGitHead(finalRoot);
      if (currentHead && index.gitHead && currentHead !== index.gitHead) {
        log(quiet, '[coldstart] Git HEAD changed, rebuilding index...');
        index = null;
      } else {
        log(quiet, '[coldstart] Loaded from cache');
      }
    }
  }

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

  const manager = new IndexManager(
    index,
    () => buildIndex(finalRoot, excludes, includes, quiet),
    cacheDir,
    noCache,
    quiet,
  );
  manager.startWatching();
  return manager;
}

// ---------------------------------------------------------------------------
// Daemon mode: HTTP server + lockfile, runs until killed
// ---------------------------------------------------------------------------
async function runDaemon(
  finalRoot: string,
  excludes: string[],
  includes: string[],
  cacheDir: string | undefined,
  quiet: boolean,
  noCache: boolean,
): Promise<void> {
  // Attach the file-backed logger BEFORE the first log() call so daemon
  // startup output (including any fatal "another daemon already running"
  // exit) is captured. The daemon is auto-spawned with stdio: 'ignore',
  // so without this every line written below would vanish.
  const detachLogger = attachDaemonLogger(finalRoot);

  log(quiet, `[coldstart] Daemon starting — root: ${finalRoot} (PID ${process.pid})`);

  // Exit immediately if another daemon is already serving this root
  const existing = await readLock(finalRoot);
  if (existing && isDaemonAlive(existing.pid)) {
    try {
      const res = await fetch(`http://127.0.0.1:${existing.port}/mcp`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      if (res.status < 500) {
        log(quiet, '[coldstart] Another daemon is already running — exiting.');
        process.exit(0);
      }
    } catch { /* stale lock — proceed */ }
  }

  // managerReady: tool calls queue here until index is built
  let managerReadyResolve!: () => void;
  let managerReadyReject!: (err: Error) => void;
  const managerReady = new Promise<void>((res, rej) => {
    managerReadyResolve = res;
    managerReadyReject = rej;
  });
  let manager: IndexManager | null = null;

  // Status snapshot for GET /status — cheap to read, used by `coldstart-mcp status`.
  const daemonStartedAt = Date.now();
  let indexReadyAt: number | null = null;
  let buildFailed = false;

  // Start HTTP server immediately so bridges can connect while index builds
  const port = await startDaemonHttpServer(
    async () => {
      await managerReady;
      return manager!.getContext();
    },
    () => {
      if (buildFailed) {
        return { state: 'failed', fileCount: null, startedAt: daemonStartedAt, indexBuildMs: null };
      }
      if (!manager) {
        return { state: 'building', fileCount: null, startedAt: daemonStartedAt, indexBuildMs: null };
      }
      const ctx = manager.getContext();
      return {
        state: ctx.isRebuilding ? 'rebuilding' : 'ready',
        fileCount: ctx.index.files.size,
        startedAt: daemonStartedAt,
        indexBuildMs: indexReadyAt !== null ? indexReadyAt - daemonStartedAt : null,
        // Fix #3: Extended health surface for doctor command
        indexedAt: ctx.index.indexedAt,
      };
    },
  );

  // Write lockfile — bridges start connecting
  // Fix #1: Include version in lockfile for version-mismatch detection
  await writeLock(finalRoot, process.pid, port, getCurrentVersion());
  log(quiet, `[coldstart] Daemon HTTP server on port ${port} (PID ${process.pid})`);

  // Auto-migrate legacy npx-based .mcp.json entries
  try {
    await migrateLegacyMcpConfig(finalRoot);
  } catch {
    // Non-fatal; continue with indexing
  }

  // Build index in background
  buildManager(finalRoot, excludes, includes, cacheDir, quiet, noCache)
    .then(m => {
      manager = m;
      indexReadyAt = Date.now();
      managerReadyResolve();
      log(quiet, '[coldstart] Daemon index ready');
    })
    .catch(err => {
      log(quiet, `[coldstart] Daemon index build failed: ${err}`);
      buildFailed = true;
      managerReadyReject(err instanceof Error ? err : new Error(String(err)));
      deleteLock(finalRoot).catch(() => {}).finally(() => {
        detachLogger();
        process.exit(1);
      });
    });

  const cleanup = (): void => {
    manager?.stopWatching();
    deleteLock(finalRoot).catch(() => {}).finally(() => {
      detachLogger();
      process.exit(0);
    });
  };

  // Fix #6: Watch lockfile for deletion; exit cleanly if user removes it
  const stopLockWatcher = watchOwnLockfile(finalRoot, () => {
    log(quiet, '[coldstart] Lockfile deleted — shutting down');
    cleanup();
  });

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('exit', () => {
    stopLockWatcher();
    manager?.stopWatching();
    detachLogger();
  });

  // Run forever
  await new Promise<never>(() => {});
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (process.argv[2] === 'init') {
    const { runInit } = await import('./init.js');
    await runInit();
    return;
  }

  if (process.argv[2] === 'status') {
    const { runStatus } = await import('./status.js');
    await runStatus();
    return;
  }

  // Fix #3: Add doctor subcommand for health checks
  if (process.argv[2] === 'doctor') {
    const { runDoctor } = await import('./doctor.js');
    await runDoctor();
    return;
  }

  // Fix #5: Add restart subcommand to kill daemons
  if (process.argv[2] === 'restart') {
    const { runRestart } = await import('./restart.js');
    await runRestart();
    return;
  }

  const { root: cliRoot, rootExplicit, excludes, includes, cacheDir, quiet, noCache, daemon, noDaemon, probe } = parseArgs(process.argv);

  // --probe: one-shot stats dump for the validation harness, then exit.
  if (probe) {
    await runProbe(resolve(cliRoot), excludes, includes);
    return;
  }

  // --daemon: background index process spawned by bridge
  if (daemon) {
    const finalRoot = resolve(cliRoot);
    await runDaemon(finalRoot, excludes, includes, cacheDir, quiet, noCache);
    return;
  }

  // --no-daemon: traditional single-process stdio mode (useful for debugging)
  if (noDaemon) {
    let manager: IndexManager | null = null;
    let managerReadyResolve!: () => void;
    let managerReadyReject!: (err: Error) => void;
    const managerReady = new Promise<void>((res, rej) => {
      managerReadyResolve = res;
      managerReadyReject = rej;
    });

    const buildAndSet = async (finalRoot: string): Promise<void> => {
      log(quiet, `[coldstart] Starting — root: ${finalRoot}`);
      try {
        await migrateLegacyMcpConfig(finalRoot);
        manager = await buildManager(finalRoot, excludes, includes, cacheDir, quiet, noCache);
        managerReadyResolve();
        log(quiet, '[coldstart] MCP server ready');
      } catch (err) {
        log(quiet, `[coldstart] Fatal: ${err}`);
        managerReadyReject(err instanceof Error ? err : new Error(String(err)));
        process.exit(1);
      }
    };

    if (rootExplicit) {
      buildAndSet(resolve(cliRoot)).catch(() => {});
    }

    await startMCPServer(
      async (clientRoots: string[]) => {
        if (!rootExplicit) {
          let finalRoot = resolve(cliRoot);
          if (clientRoots.length > 0) {
            const uri = clientRoots[0];
            finalRoot = uri.startsWith('file://') ? fileURLToPath(uri) : resolve(uri);
          }
          buildAndSet(finalRoot).catch(() => {});
        }
      },
      async () => {
        await managerReady;
        return manager!.getContext();
      },
    );

    process.on('exit', () => manager?.stopWatching());
    process.on('SIGINT', () => { manager?.stopWatching(); process.exit(0); });
    process.on('SIGTERM', () => { manager?.stopWatching(); process.exit(0); });
    return;
  }

  // Default: daemon + bridge mode
  await startBridge(cliRoot, rootExplicit, quiet);
}

main().catch(err => {
  process.stderr.write(`[coldstart] Fatal error: ${err}\n`);
  process.exit(1);
});
