/**
 * Keeper spawn helper — shared by the MCP reader (index.ts) and the CLI readers
 * (cli.ts). Lives in its own module so cli.ts can use it without importing
 * index.ts (whose top-level `main()` would run on import).
 *
 * The keeper is a detached background process (`--daemon`) that keeps the
 * on-disk cache fresh. Readers call ensureKeeper() so a single keeper is alive
 * per root; it short-circuits cheaply (one lock read + a liveness check) when
 * one already runs.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readLock,
  isDaemonAlive,
  getCurrentVersion,
  killDaemon,
  deleteLock,
  tryAcquireSpawnLock,
} from './daemon-lock.js';
import { getCacheDir } from './cache/disk-cache.js';
import { readKeeperState } from './keeper-state.js';

/**
 * Ensure a background keeper is running for `finalRoot`. Spawns one (detached)
 * if none is alive, or replaces a keeper left by an older coldstart version
 * (cache-format compatibility). Best-effort — any failure is swallowed so the
 * reader still works off the (possibly staler) cache.
 */
export async function ensureKeeper(finalRoot: string): Promise<void> {
  try {
    const lock = await readLock(finalRoot);
    const version = getCurrentVersion();
    if (lock && isDaemonAlive(lock.pid)) {
      if (!lock.version || lock.version === version) return; // alive & current
      await killDaemon(lock.pid);
      await deleteLock(finalRoot).catch(() => {});
    }
    const release = await tryAcquireSpawnLock(finalRoot);
    if (!release) return; // another reader is already spawning it
    try {
      const entry = process.argv[1];
      const child = spawn(
        process.execPath,
        [entry, '--root', finalRoot, '--daemon', '--quiet'],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      child.unref();
    } finally {
      await release();
    }
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Readers never build (B4): on a cache miss they wait for the keeper's first
// save instead of building a second index in-process (the double-build spike).
// ---------------------------------------------------------------------------

function metaPath(rootDir: string, cacheDir: string | undefined): string {
  return join(getCacheDir(rootDir, cacheDir), 'meta.json');
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type CacheWait = 'ready' | 'no-keeper' | 'timeout';

/**
 * Wait for the keeper's cache to exist. 'no-keeper' = no live keeper after a
 * spawn grace period (caller may build in-process as a last resort);
 * 'timeout' = a keeper is alive but still building (caller should tell the
 * user to retry rather than start a competing build).
 */
export async function waitForKeeperCache(
  rootDir: string,
  cacheDir: string | undefined,
  timeoutMs = 180_000,
  note?: (msg: string) => void,
): Promise<CacheWait> {
  const meta = metaPath(rootDir, cacheDir);
  const start = Date.now();
  let lastNote = start;
  while (Date.now() - start < timeoutMs) {
    if (existsSync(meta)) return 'ready';
    if (Date.now() - start > 3_000) {
      const lock = await readLock(rootDir);
      if (!lock || !isDaemonAlive(lock.pid)) return 'no-keeper';
    }
    if (note && Date.now() - lastNote >= 5_000) {
      note(`[coldstart] keeper is building the index… (${Math.round((Date.now() - start) / 1000)}s)`);
      lastNote = Date.now();
    }
    await sleep(250);
  }
  return existsSync(meta) ? 'ready' : 'timeout';
}

export type HeadWait = 'caught-up' | 'rebuilding' | 'timeout';

/** The gitHead recorded in the cache's commit marker, or null if unreadable. */
function cachedHead(rootDir: string, cacheDir: string | undefined): string | null {
  try {
    const meta = JSON.parse(readFileSync(metaPath(rootDir, cacheDir), 'utf8')) as { gitHead?: string };
    return typeof meta.gitHead === 'string' ? meta.gitHead : null;
  } catch {
    return null;
  }
}

/**
 * Wait for the keeper to bring the cache up to `wantHead`, but only for as long
 * as that is plausible.
 *
 * Two things were wrong with waiting on meta.json's MTIME instead:
 *
 *  1. The baseline was read when the wait started, not when the index was
 *     loaded. A save landing in between made the reader wait the full window
 *     for a second save that was never coming.
 *  2. Any save satisfied it, even one that left the cache still behind HEAD.
 *
 * The head is the condition the caller actually cares about, and it is exact.
 *
 * 'rebuilding' is the fix for the pathology itself: a keeper that has decided
 * on a full rebuild publishes that decision, and 30-100s of work is not worth
 * standing still for — the caller serves what it already holds. Absence of a
 * stamp means keep waiting, NOT bail: a freshly spawned keeper needs a moment
 * to load the cache and reconcile before it knows what it is doing, and the
 * common patch case is worth the few seconds it takes.
 */
export async function waitForCacheHead(
  rootDir: string,
  cacheDir: string | undefined,
  wantHead: string,
  timeoutMs = 12_000,
): Promise<HeadWait> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cachedHead(rootDir, cacheDir) === wantHead) return 'caught-up';
    const state = readKeeperState(rootDir, cacheDir);
    // pid check: a keeper killed mid-rebuild leaves its stamp behind, and a
    // stale stamp must not silently disable the wait forever.
    if (state?.inProgress?.kind === 'rebuild' && isDaemonAlive(state.pid)) return 'rebuilding';
    await sleep(250);
  }
  return cachedHead(rootDir, cacheDir) === wantHead ? 'caught-up' : 'timeout';
}
