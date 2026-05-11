import { readFile, writeFile, mkdir, unlink, open, readdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export interface DaemonLock {
  pid: number;
  port: number;
  /** Absolute project root. Optional for forward-compat with old lockfiles. */
  rootDir?: string;
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
    if (typeof lock.pid !== 'number' || typeof lock.port !== 'number') return null;
    return lock as DaemonLock;
  } catch {
    return null;
  }
}

export async function writeLock(
  rootDir: string,
  pid: number,
  port: number,
): Promise<void> {
  await mkdir(daemonDir(), { recursive: true });
  const payload: DaemonLock = { pid, port, rootDir: resolve(rootDir) };
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
      if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') continue;
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
 * Try to atomically acquire a spawn lock so only one bridge process spawns the daemon.
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
    return null; // Another bridge already holds the spawn lock
  }
}
