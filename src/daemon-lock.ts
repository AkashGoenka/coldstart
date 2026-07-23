import { readFile, writeFile, mkdir, unlink, open, readdir } from 'node:fs/promises';
import { readFileSync, watch, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface DaemonLock {
  pid: number;
  /** Absolute project root. Optional for forward-compat with old lockfiles. */
  rootDir?: string;
  /** Version of the keeper that wrote this lock. Optional for forward-compat with old lockfiles. */
  version?: string;
  /**
   * Legacy HTTP-serving port. The keeper no longer serves, so new locks omit
   * it; kept optional so old lockfiles still parse without erroring.
   */
  port?: number;
}

export function daemonDir(): string {
  return join(homedir(), '.coldstart', 'daemon');
}

export function rootHash(rootDir: string): string {
  return createHash('sha256').update(resolve(rootDir)).digest('hex').slice(0, 16);
}

export function lockBasename(rootDir: string): string {
  const abs = resolve(rootDir);
  return `${basename(abs)}-${rootHash(abs)}`;
}

function lockPath(rootDir: string): string {
  return join(daemonDir(), `${lockBasename(rootDir)}.json`);
}

function spawnLockPath(rootDir: string): string {
  return join(daemonDir(), `${lockBasename(rootDir)}.spawn`);
}

export function daemonLogPath(rootDir: string): string {
  return join(daemonDir(), `${lockBasename(rootDir)}.log`);
}

export function daemonLogPrevPath(rootDir: string): string {
  return join(daemonDir(), `${lockBasename(rootDir)}.log.prev`);
}

export async function readLock(rootDir: string): Promise<DaemonLock | null> {
  try {
    const raw = await readFile(lockPath(rootDir), 'utf-8');
    const lock = JSON.parse(raw) as Partial<DaemonLock>;
    if (typeof lock.pid !== 'number') return null;
    return lock as DaemonLock;
  } catch {
    return null;
  }
}

export async function writeLock(
  rootDir: string,
  pid: number,
  version?: string,
): Promise<void> {
  await mkdir(daemonDir(), { recursive: true });
  const payload: DaemonLock = { pid, rootDir: resolve(rootDir), version };
  await writeFile(lockPath(rootDir), JSON.stringify(payload));
}

export async function deleteLock(rootDir: string): Promise<void> {
  try { await unlink(lockPath(rootDir)); } catch { /* ignore */ }
}

/**
 * List every daemon lockfile under ~/.coldstart/daemon/.
 * Returns the parsed lock plus its filename basename (`<dirname>-<hash>`)
 * so callers can derive log paths even when the lock doesn't record rootDir.
 */
export interface DaemonLockListing {
  basename: string;       // <dirname>-<hash> portion of the filename
  lockPath: string;
  lock: DaemonLock;
}

export async function listDaemonLocks(): Promise<DaemonLockListing[]> {
  let entries: string[];
  try {
    entries = await readdir(daemonDir());
  } catch {
    return [];
  }
  const out: DaemonLockListing[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const full = join(daemonDir(), name);
    try {
      const raw = await readFile(full, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DaemonLock>;
      if (typeof parsed.pid !== 'number') continue;
      out.push({
        basename: name.replace(/\.json$/, ''),
        lockPath: full,
        lock: parsed as DaemonLock,
      });
    } catch { /* skip malformed */ }
  }
  return out;
}

export function isDaemonAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current version of coldstart-mcp from package.json.
 */
export function getCurrentVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const pkgPath = resolve(dirname(__filename), '..', 'package.json');
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Kill a daemon by PID with escalating signals: SIGTERM (5s wait), then SIGKILL.
 * Returns true if the daemon was alive and has been killed; false if already dead.
 */
export async function killDaemon(pid: number): Promise<boolean> {
  if (!isDaemonAlive(pid)) return false;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }

  // Wait up to 5 seconds for graceful shutdown
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isDaemonAlive(pid)) return true;
    await new Promise(r => setTimeout(r, 100));
  }

  // SIGKILL if still alive
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already dead or permission denied — either way, treat as killed
  }

  return true;
}

/**
 * Try to atomically acquire a spawn lock so only one reader spawns the keeper.
 * Returns a release function if acquired, null if another process already holds it.
 */
export async function tryAcquireSpawnLock(rootDir: string): Promise<(() => Promise<void>) | null> {
  await mkdir(daemonDir(), { recursive: true });
  const path = spawnLockPath(rootDir);
  try {
    const fd = await open(path, 'wx'); // O_CREAT | O_EXCL — atomic
    await fd.writeFile(String(process.pid));
    await fd.close();
    return async () => { try { await unlink(path); } catch { /* ignore */ } };
  } catch {
    return null; // Another reader already holds the spawn lock
  }
}

/**
 * Fix #6: Watch the daemon lockfile directory for deletions of our own lockfile.
 * If our lockfile is deleted (e.g., user ran `rm ~/.coldstart/daemon/foo.json`),
 * call onMissing() so the daemon can exit cleanly.
 *
 * fs.watch drops events under load (observed live: a keeper surviving its
 * lockfile deletion, then coexisting with its replacement — two keepers
 * racing saves on one root). Two hardenings:
 *   - a slow poll backstop, so a missed event only delays shutdown
 *   - lock OWNERSHIP: if the lockfile exists but names a different pid,
 *     another keeper has taken over this root — the old one must exit.
 *
 * Returns a function to stop watching.
 */
export const LOCK_POLL_INTERVAL_MS = 30_000;

export function watchOwnLockfile(
  rootDir: string,
  onMissing: () => void,
  pollIntervalMs = LOCK_POLL_INTERVAL_MS, // injectable so tests don't depend on fs.watch delivery
): () => void {
  const lock = lockPath(rootDir);
  const parent = daemonDir();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  let fired = false;

  const lockLost = (): boolean => {
    if (!existsSync(lock)) return true;
    try {
      const parsed = JSON.parse(readFileSync(lock, 'utf-8')) as Partial<DaemonLock>;
      return typeof parsed.pid === 'number' && parsed.pid !== process.pid;
    } catch {
      return false; // unreadable mid-write — never shut down on a read race
    }
  };
  const fire = (): void => {
    if (fired) return;
    fired = true;
    onMissing();
  };

  const poll = setInterval(() => { if (lockLost()) fire(); }, pollIntervalMs);
  poll.unref();

  try {
    watcher = watch(parent, (_eventType, _filename) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (lockLost()) fire();
      }, 200);
    });
  } catch (err) {
    // Keep the poll backstop even when fs.watch is unavailable.
    return () => {
      clearInterval(poll);
    };
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(poll);
    watcher?.close();
  };
}

export const BINARY_POLL_INTERVAL_MS = 15_000;

/**
 * Self-reap safety net: poll for the keeper's own entry script and fire
 * onGone() once it disappears (an `npm uninstall`/`npm rm`, or a moved global
 * install). This is the ONLY thing that can stop a keeper after an uninstall —
 * the lockfile is left untouched, no reader ever runs to replace it, and
 * `coldstart stop` is gone along with the binary — so without it the keeper runs
 * forever. Two consecutive misses are required so a transient unlink+rewrite
 * during `npm update` doesn't trigger a spurious exit (and even if one slips
 * through, a reader just respawns from the new binary — the intended upgrade
 * path). Returns a function to stop polling.
 */
export function watchOwnBinary(
  entryPath: string,
  onGone: () => void,
  pollIntervalMs = BINARY_POLL_INTERVAL_MS, // injectable so tests don't wait 15s
): () => void {
  let misses = 0;
  let fired = false;
  const poll = setInterval(() => {
    if (fired) return;
    if (entryPath && !existsSync(entryPath)) {
      if (++misses >= 2) { fired = true; onGone(); }
    } else {
      misses = 0;
    }
  }, pollIntervalMs);
  poll.unref();
  return () => clearInterval(poll);
}
