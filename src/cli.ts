/**
 * coldstart CLI query surface — `go` / `gs` / `index`.
 *
 * Design rule (see docs/cli-skill-spec.md): the query path is a PURE READER.
 * It loads the on-disk cache and runs the SAME handlers the MCP server uses
 * (handleGetOverview / handleGetStructure), printing their `__rawText` to
 * stdout so output is byte-identical to the MCP tool and pipeable.
 *
 * Cache miss is the one exception: `go`/`gs` will lazily build + save so the
 * tool is usable without an explicit prep step. This build+save is NOT
 * concurrency-safe (no lock) — fine for sequential CLI use; the product-grade
 * single-writer prep is `coldstart index` (and, later, the write-only daemon).
 * Diagnostics go to stderr; stdout carries only the answer.
 */
import { resolve } from 'node:path';
import { loadCachedIndex, saveCachedIndex } from './cache/disk-cache.js';
import { getGitHead } from './indexer/git.js';
import { handleGetStructure } from './server/tools.js';
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
 * Load the index from cache (pure read). On cache miss or git-HEAD drift,
 * lazily build + save. Returns null only on hard failure.
 */
async function getIndex(
  root: string,
  cacheDir: string | undefined,
  buildIndex: BuildFn,
): Promise<CodebaseIndex | null> {
  const t0 = Date.now();
  let index = await loadCachedIndex(root, cacheDir);
  if (index) {
    const head = await getGitHead(root);
    if (head && index.gitHead && head !== index.gitHead) {
      err('[coldstart] cache stale (git HEAD changed) — rebuilding');
      index = null;
    } else {
      err(`[coldstart] cache hit (${Date.now() - t0}ms, ${index.files.size} files)`);
      return index;
    }
  }

  // Lazy build+save. Run `coldstart index` once to avoid paying this per query.
  if (!index) err('[coldstart] cache miss — building (run `coldstart index` once to prep)');
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

export async function runGo(argv: string[], buildIndex: BuildFn): Promise<number> {
  const { positional, flags } = parseQueryArgs(argv);
  const query = positional.join(' ').trim();
  if (!query) {
    err('usage: coldstart go <terms...>  — pass every salient identifier from the task, not one distilled keyword [--json]');
    return 1;
  }
  const root = resolve(flags.root ?? '.');
  const index = await getIndex(root, flags.cacheDir, buildIndex);
  if (!index) { err('[coldstart] no index available'); return 1; }

  // go and find share one engine — same query in, same page out.
  const { buildRichPage } = await import('./server/find.js');
  process.stdout.write(buildRichPage(index, root, query, flags.json, flags.via === true) + '\n');
  return 0;
}

export async function runGs(argv: string[], buildIndex: BuildFn): Promise<number> {
  const { positional, flags } = parseQueryArgs(argv);
  const file = positional[0];
  if (!file) {
    err('usage: coldstart gs <file> [--symbol NAME[,NAME]] [--match TERM] [--view full|symbols|imports|importers|callers] [--json]');
    return 1;
  }
  const root = resolve(flags.root ?? '.');
  const index = await getIndex(root, flags.cacheDir, buildIndex);
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
  const index = await getIndex(root, flags.cacheDir, buildIndex);
  if (!index) { err('[coldstart] no index available'); return 1; }

  const { buildRichPage } = await import('./server/find.js');
  process.stdout.write(buildRichPage(index, root, query, flags.json, flags.via === true) + '\n');
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
