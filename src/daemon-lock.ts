import { readFile, writeFile, mkdir, unlink, open } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export interface DaemonLock {
  pid: number;
  port: number;
}

function daemonDir(): string {
  return join(homedir(), '.coldstart', 'daemon');
}

export function rootHash(rootDir: string): string {
  return createHash('sha256').update(resolve(rootDir)).digest('hex').slice(0, 16);
}

function lockBasename(rootDir: string): string {
  const abs = resolve(rootDir);
  return `${basename(abs)}-${rootHash(abs)}`;
}

function lockPath(rootDir: string): string {
  return join(daemonDir(), `${lockBasename(rootDir)}.json`);
}

function spawnLockPath(rootDir: string): string {
  return join(daemonDir(), `${lockBasename(rootDir)}.spawn`);
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

export async function writeLock(rootDir: string, pid: number, port: number): Promise<void> {
  await mkdir(daemonDir(), { recursive: true });
  await writeFile(lockPath(rootDir), JSON.stringify({ pid, port }));
}

export async function deleteLock(rootDir: string): Promise<void> {
  try { await unlink(lockPath(rootDir)); } catch { /* ignore */ }
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
