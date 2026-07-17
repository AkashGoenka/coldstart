/**
 * coldstart CLI query surface — `find` / `gs` / `index`.
 *
 * Design rule (see docs/cli-skill-spec.md): the query path is a PURE READER.
 * It loads the on-disk cache and runs the SAME engine the MCP reader uses
 * (buildRichPage / handleGetStructure), printing their `__rawText` to
 * stdout so output is byte-identical to the MCP tool and pipeable.
 *
 * Cache miss is the one exception: `find`/`gs` will lazily build + save so the
 * tool is usable without an explicit prep step. This build+save is NOT
 * concurrency-safe (no lock) — fine for sequential CLI use; the product-grade
 * single-writer prep is `coldstart index` (and, later, the write-only daemon).
 * Diagnostics go to stderr; stdout carries only the answer.
 */
import { resolve } from 'node:path';
import { loadCachedIndex, saveCachedIndex, type LoadProfile } from './cache/disk-cache.js';
import { getGitHead } from './indexer/git.js';
import { handleGetStructure } from './server/tools.js';
import { ensureKeeper, waitForKeeperCache, waitForCacheAdvance } from './keeper.js';
import type { CodebaseIndex } from './types.js';

type BuildFn = (
  rootDir: string,
  excludes: string[],
  includes: string[],
  quiet: boolean,
) => Promise<CodebaseIndex>;

type HandlerResult = { __rawText?: string; error?: string } & Record<string, unknown>;

function err(...args: unknown[]): void {
  process.stderr.write(args.join(' ') + '\n');
}

interface ParsedArgs {
  positional: string[];
  flags: {
    path?: string;
    match?: string;
    symbol?: string;
    view?: string;
    max?: string;
    page?: string;
    paths?: string[];
    root?: string;
    cacheDir?: string;
    tests?: boolean;
    json?: boolean;
    via?: boolean;
  };
}

function parseQueryArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: ParsedArgs['flags'] = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--path': flags.path = argv[++i]; break;
      case '--match': flags.match = argv[++i]; break;
      case '--symbol': flags.symbol = argv[++i]; break;
      case '--view': flags.view = argv[++i]; break;
      case '--max': flags.max = argv[++i]; break;
      case '--page': flags.page = argv[++i]; break;
      case '--paths': flags.paths = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--root': flags.root = argv[++i]; break;
      case '--cache-dir': flags.cacheDir = argv[++i]; break;
      case '--tests': flags.tests = true; break;
      case '--json': flags.json = true; break;
      case '--via': flags.via = true; break;
      default:
        if (a.startsWith('--')) err(`[coldstart] unknown flag: ${a}`);
        else positional.push(a);
    }
  }
  return { positional, flags };
}

/**
 * Load the index from cache (pure read). Readers NEVER build (B4): on a cache
 * miss they wait for the keeper's first save; on git-HEAD drift they wait
 * briefly for the keeper's reconcile re-save, then serve what exists. The
 * in-process build survives only as a last resort when no keeper could be
 * spawned at all. Returns null when a keeper is alive but still building —
 * callers print the retry hint and exit non-zero.
 */
export async function getIndex(
  root: string,
  cacheDir: string | undefined,
  buildIndex: BuildFn,
  profile: LoadProfile = 'full',
): Promise<CodebaseIndex | null> {
  const t0 = Date.now();
  let index = await loadCachedIndex(root, cacheDir, profile);
  if (index) {
    const head = await getGitHead(root);
    if (head && index.gitHead && head !== index.gitHead) {
      // Branch switch / pull while no keeper watched. ensureKeeper (already
      // called by every CLI entry) spawned one, and its startup reconcile
      // re-saves the cache — give that a short window before serving stale.
      err('[coldstart] cache behind git HEAD — waiting for keeper reconcile');
      if (await waitForCacheAdvance(root, cacheDir)) {
        index = (await loadCachedIndex(root, cacheDir, profile)) ?? index;
        err(`[coldstart] cache refreshed (${Date.now() - t0}ms, ${index.files.size} files)`);
      } else {
        err('[coldstart] keeper still reconciling — serving previous index (rerun shortly for fresh results)');
      }
      return index;
    }
    err(`[coldstart] cache hit (${Date.now() - t0}ms, ${index.files.size} files)`);
    return index;
  }

  err('[coldstart] no cache yet — waiting for the keeper build (run `coldstart index` to prep manually)');
  const wait = await waitForKeeperCache(root, cacheDir, 180_000, err);
  if (wait === 'ready') {
    // The save is segment-wise; tolerate a beat between meta and segments.
    for (let attempt = 0; attempt < 3; attempt++) {
      index = await loadCachedIndex(root, cacheDir, profile);
      if (index) {
        err(`[coldstart] keeper build ready (${((Date.now() - t0) / 1000).toFixed(1)}s, ${index.files.size} files)`);
        return index;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (wait === 'timeout') {
    err('[coldstart] keeper is still building this repo — retry in a minute');
    return null;
  }

  // No keeper could be spawned (or its cache never materialized) — build
  // in-process so the tool still answers. One-off, loudly labeled.
  err('[coldstart] no keeper available — building in-process (one-off)');
  index = await buildIndex(root, [], [], true);
  try {
    await saveCachedIndex(index, cacheDir);
  } catch (e) {
    err(`[coldstart] warn: could not save cache: ${e}`);
  }
  err(`[coldstart] built ${index.files.size} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return index;
}

function stripRaw(result: HandlerResult): Record<string, unknown> {
  const { __rawText, ...rest } = result;
  void __rawText;
  return rest;
}

function emit(result: HandlerResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(stripRaw(result), null, 2) + '\n');
    return;
  }
  process.stdout.write((result.__rawText ?? result.error ?? '') + '\n');
}

export async function runGs(argv: string[], buildIndex: BuildFn): Promise<number> {
  const { positional, flags } = parseQueryArgs(argv);
  const file = positional[0];
  if (!file) {
    err('usage: coldstart gs <file> [--symbol NAME[,NAME]] [--match TERM] [--view full|symbols|imports|importers|callers] [--json]');
    return 1;
  }
  const root = resolve(flags.root ?? '.');
  // Keep the on-disk cache live for uncommitted edits: ensure a background
  // keeper is running (cheap no-op when one already is).
  await ensureKeeper(root);
  const index = await getIndex(root, flags.cacheDir, buildIndex, 'gs');
  if (!index) { err('[coldstart] no index available'); return 1; }

  const result = handleGetStructure(index, {
    file_path: file,
    match: flags.match,
    symbol: flags.symbol,
    view: flags.view as 'full' | 'symbols' | 'imports' | 'importers' | 'callers' | undefined,
  }) as HandlerResult;

  emit(result, flags.json === true);
  // file-not-found (no __rawText, only error) → exit 2
  return result.error && result.__rawText === undefined ? 2 : 0;
}

export async function runFind(argv: string[], buildIndex: BuildFn): Promise<number> {
  const { positional, flags } = parseQueryArgs(argv);
  const query = positional.join(' ').trim();
  if (!query) {
    err('usage: coldstart find <terms...>  — pass every salient identifier from the task, not one distilled keyword');
    return 1;
  }
  const root = resolve(flags.root ?? '.');
  // Keep the on-disk cache live for uncommitted edits: ensure a background
  // keeper is running (cheap no-op when one already is).
  await ensureKeeper(root);
  const index = await getIndex(root, flags.cacheDir, buildIndex, 'find');
  if (!index) { err('[coldstart] no index available'); return 1; }

  const { buildRichPage } = await import('./server/find.js');
  process.stdout.write((await buildRichPage(index, root, query, flags.json, flags.via === true)) + '\n');
  return 0;
}

/**
 * Consumer counts for the capture hook's "no consumers in import graph"
 * worklist annotation: per path, how many files the graph knows import it.
 * `consumers: null` for unindexed paths — the hook flags ONLY an explicit 0
 * (a file the index knows but sees nobody importing), never absence of data.
 */
export async function runConsumers(argv: string[], _buildIndex: BuildFn): Promise<number> {
  const { positional, flags } = parseQueryArgs(argv);
  const paths = [...(flags.paths ?? []), ...positional].filter(Boolean);
  if (!paths.length) {
    err('usage: coldstart consumers --paths a,b [--json]  (or positional paths)');
    return 1;
  }
  const root = resolve(flags.root ?? '.');
  // Pure cache read — no keeper spawn, no build-wait. This is called from the
  // capture hook at fire time; a cold cache must answer "don't know" (nulls)
  // instantly, not stall the stop.
  const index = await loadCachedIndex(root, flags.cacheDir, 'gs');
  const results = paths.map((p) => {
    const f = index?.files.get(p);
    return { path: p, consumers: f ? f.importedByCount : null };
  });
  if (flags.json) process.stdout.write(JSON.stringify({ paths: results }, null, 2) + '\n');
  else for (const r of results) process.stdout.write(`${r.path}: ${r.consumers ?? 'not indexed'}\n`);
  return 0;
}

/** Single-writer prep step: build the index and persist it to cache. */
export async function runIndexPrep(argv: string[], buildIndex: BuildFn): Promise<number> {
  const { flags } = parseQueryArgs(argv);
  const root = resolve(flags.root ?? '.');
  const t0 = Date.now();
  err(`[coldstart] building index for ${root}...`);
  const index = await buildIndex(root, [], [], false); // progress to stderr
  try {
    await saveCachedIndex(index, flags.cacheDir);
  } catch (e) {
    err(`[coldstart] error: could not save cache: ${e}`);
    return 1;
  }
  err(`[coldstart] indexed ${index.files.size} files, saved to cache in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return 0;
}
