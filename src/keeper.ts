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
import {
  readLock,
  isDaemonAlive,
  getCurrentVersion,
  killDaemon,
  deleteLock,
  tryAcquireSpawnLock,
} from './daemon-lock.js';

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
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
    } finally {
      await release();
    }
  } catch {
    /* best-effort */
  }
}
