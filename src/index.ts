#!/usr/bin/env node
/**
 * coldstart-mcp — Local MCP server for AI agent codebase navigation.
 *
 * Usage:
 *   coldstart-mcp --root /path/to/project
 *   coldstart-mcp --root . --exclude vendor --quiet
 *   coldstart-mcp --root . --no-cache
 *   coldstart-mcp --root . --no-daemon    # self-contained stdio MCP (no keeper)
 *
 * Subcommands:
 *   coldstart init            # wire coldstart.md into the project
 *   coldstart find / gs       # CLI readers (load the cache, print, exit)
 *   coldstart status          # list every keeper + its index freshness
 *   coldstart restart [--all] # stop the keeper(s); respawn on next read
 *
 * Internal (spawned automatically by readers):
 *   coldstart-mcp --root . --daemon       # background keeper (keeps cache fresh)
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { walkDirectory } from './indexer/walker.js';
import { parseFile, buildFileId } from './indexer/parser.js';
import { resolveImports } from './indexer/resolvers/index.js';
import { addRailsSyntheticEdges } from './indexer/rails-synthetic.js';
import { addLaravelSyntheticEdges } from './indexer/laravel-synthetic.js';
import { addCSharpSyntheticEdges } from './indexer/csharp-synthetic.js';
import { addDjangoSyntheticEdges } from './indexer/django-synthetic.js';
import { buildGraph } from './indexer/graph.js';
import { buildFileDomains, isTestPath } from './indexer/tokenize.js';
import { buildContentTokenPostings } from './indexer/content-tokens.js';
import { buildSymbolEdges } from './indexer/symbol-edges.js';
import { getGitHead } from './indexer/git.js';
import { loadCachedIndex, saveCachedIndex, getCacheDir } from './cache/disk-cache.js';
import { startMCPServer } from './server/mcp.js';
import { IndexManager } from './index-manager.js';
import type { IndexContext } from './index-manager.js';
import { readLock, writeLock, deleteLock, isDaemonAlive, getCurrentVersion, watchOwnLockfile } from './daemon-lock.js';
import { ensureKeeper } from './keeper.js';
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

// MCP clients advertise their workspace as a `file://` URI (or sometimes a bare
// path). Resolve the first advertised root to an absolute filesystem path,
// falling back to the CLI-provided root when the client advertises none.
function resolveClientRoot(clientRoots: string[], fallback: string): string {
  if (clientRoots.length === 0) return fallback;
  const uri = clientRoots[0];
  return uri.startsWith('file://') ? fileURLToPath(uri) : resolve(uri);
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
            contentTokens: parsed.contentTokens,
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

  const contentTokenPostings = buildContentTokenPostings(indexedFiles);

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
    contentTokenPostings,
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
// Keeper mode (`--daemon`): keep the on-disk index FRESH. Watches the repo,
// patches/rebuilds the in-memory index, and writes it to the disk cache that
// the CLI and MCP readers load. It does NOT serve queries — every reader reads
// the cache directly. Lazy-spawned by the first reader; runs until killed or
// its lockfile is removed.
// ---------------------------------------------------------------------------
async function runKeeper(
  finalRoot: string,
  excludes: string[],
  includes: string[],
  cacheDir: string | undefined,
  quiet: boolean,
  noCache: boolean,
): Promise<void> {
  // Attach the file-backed logger BEFORE the first log() call: the keeper is
  // auto-spawned with stdio: 'ignore', so the log file is the ONLY debug trace.
  const detachLogger = attachDaemonLogger(finalRoot);

  log(quiet, `[coldstart] Keeper starting — root: ${finalRoot} (PID ${process.pid})`);

  // Exit immediately if another keeper is already alive for this root.
  const existing = await readLock(finalRoot);
  if (existing && isDaemonAlive(existing.pid)) {
    log(quiet, '[coldstart] Another keeper is already running — exiting.');
    detachLogger();
    process.exit(0);
  }

  // Version in the lock lets a reader replace an outdated keeper (cache-format
  // compatibility) on upgrade.
  await writeLock(finalRoot, process.pid, getCurrentVersion());
  log(quiet, `[coldstart] Keeper lock written (PID ${process.pid})`);

  // Auto-migrate legacy npx-based .mcp.json entries (non-fatal).
  try { await migrateLegacyMcpConfig(finalRoot); } catch { /* ignore */ }

  let manager: IndexManager | null = null;
  try {
    // buildManager loads-or-builds the index AND starts the watcher, which
    // patches/rebuilds and debounce-saves the cache on every change.
    manager = await buildManager(finalRoot, excludes, includes, cacheDir, quiet, noCache);
    log(quiet, '[coldstart] Keeper index ready — watching for changes');
  } catch (err) {
    log(quiet, `[coldstart] Keeper index build failed: ${err}`);
    await deleteLock(finalRoot).catch(() => {});
    detachLogger();
    process.exit(1);
  }

  const cleanup = (): void => {
    manager?.stopWatching();
    deleteLock(finalRoot).catch(() => {}).finally(() => {
      detachLogger();
      process.exit(0);
    });
  };

  // Exit cleanly if the user removes our lockfile.
  const stopLockWatcher = watchOwnLockfile(finalRoot, () => {
    log(quiet, '[coldstart] Lockfile deleted — shutting down keeper');
    cleanup();
  });

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('exit', () => {
    stopLockWatcher();
    manager?.stopWatching();
    detachLogger();
  });

  // Run forever.
  await new Promise<never>(() => {});
}

// ---------------------------------------------------------------------------
// A disk-cache reader for the long-lived MCP server: loads the keeper-maintained
// index and reloads it when the cache file's mtime advances (the keeper rewrites
// it ~5s after edits settle). This is how the MCP server stays live WITHOUT its
// own watcher — the keeper is the single freshness authority.
// ---------------------------------------------------------------------------
function makeCacheReader(
  finalRoot: string,
  cacheDir: string | undefined,
  quiet: boolean,
): () => Promise<IndexContext> {
  let cached: CodebaseIndex | null = null;
  let lastMtimeMs = 0;
  const metaPath = join(getCacheDir(finalRoot, cacheDir), 'meta.json');
  const currentMtime = (): number => {
    try { return statSync(metaPath).mtimeMs; } catch { return 0; }
  };
  return async () => {
    const m = currentMtime();
    if (!cached || (m > 0 && m > lastMtimeMs)) {
      const fresh = await loadCachedIndex(finalRoot, cacheDir);
      if (fresh) {
        cached = fresh;
        lastMtimeMs = m;
      } else if (!cached) {
        // No cache yet (keeper still building its first index) — build once in
        // this process so the first call works; the keeper takes over after.
        cached = await buildIndex(finalRoot, [], [], quiet);
        try { await saveCachedIndex(cached, cacheDir); } catch { /* ignore */ }
        lastMtimeMs = currentMtime();
      }
    }
    return { index: cached!, isRebuilding: false };
  };
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

  // `restart` — kill the keeper for this root (or --all) and clear its lock.
  // The keeper respawns lazily on the next reader.
  if (process.argv[2] === 'restart') {
    const { runRestart } = await import('./restart.js');
    await runRestart();
    return;
  }

  // CLI query surface — pure-reader `find`/`gs`, plus single-writer `index` prep.
  // These read the on-disk cache directly (kept fresh by the keeper), run the
  // same engine the MCP reader uses, print, exit. (docs/cli-skill-spec.md)
  if (process.argv[2] === 'gs') {
    const { runGs } = await import('./cli.js');
    process.exit(await runGs(process.argv.slice(3), buildIndex));
  }
  if (process.argv[2] === 'find') {
    const { runFind } = await import('./cli.js');
    process.exit(await runFind(process.argv.slice(3), buildIndex));
  }
  if (process.argv[2] === 'index') {
    const { runIndexPrep } = await import('./cli.js');
    process.exit(await runIndexPrep(process.argv.slice(3), buildIndex));
  }

  const { root: cliRoot, rootExplicit, excludes, includes, cacheDir, quiet, noCache, daemon, noDaemon, probe } = parseArgs(process.argv);

  // --probe: one-shot stats dump for the validation harness, then exit.
  if (probe) {
    await runProbe(resolve(cliRoot), excludes, includes);
    return;
  }

  // --daemon: background keeper that keeps the on-disk cache fresh (no serving).
  // Lazy-spawned by readers via ensureKeeper().
  if (daemon) {
    const finalRoot = resolve(cliRoot);
    await runKeeper(finalRoot, excludes, includes, cacheDir, quiet, noCache);
    return;
  }

  // --no-daemon: self-contained single-process stdio MCP (builds + watches +
  // serves in-process, no background keeper). Useful for debugging / one-off use.
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
          buildAndSet(resolveClientRoot(clientRoots, resolve(cliRoot))).catch(() => {});
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

  // Default: stdio MCP server in READER mode. Serves find/gs off the on-disk
  // cache that a background keeper keeps fresh; spawns the keeper if absent.
  // This is the path for no-shell MCP clients (e.g. Claude Desktop).
  {
    let reader: (() => Promise<IndexContext>) | null = null;
    let readerReadyResolve!: () => void;
    const readerReady = new Promise<void>(res => { readerReadyResolve = res; });

    const initRoot = async (finalRoot: string): Promise<void> => {
      log(quiet, `[coldstart] MCP reader — root: ${finalRoot}`);
      await ensureKeeper(finalRoot);
      reader = makeCacheReader(finalRoot, cacheDir, quiet);
      readerReadyResolve();
    };

    if (rootExplicit) {
      void initRoot(resolve(cliRoot));
    }

    await startMCPServer(
      async (clientRoots: string[]) => {
        if (!rootExplicit) {
          void initRoot(resolveClientRoot(clientRoots, resolve(cliRoot)));
        }
      },
      async () => {
        await readerReady;
        return reader!();
      },
    );
    return;
  }
}

main().catch(err => {
  process.stderr.write(`[coldstart] Fatal error: ${err}\n`);
  process.exit(1);
});
