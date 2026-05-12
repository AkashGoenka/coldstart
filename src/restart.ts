/**
 * coldstart-mcp restart [--all] — Kill daemons and clean lockfiles.
 *
 * Without --all: restarts the daemon for the current working directory.
 * With --all: restarts all daemons the user has running.
 */

import { resolve } from 'node:path';
import { readLock, listDaemonLocks, deleteLock, killDaemon } from './daemon-lock.js';

export async function runRestart(): Promise<void> {
  const all = process.argv.includes('--all');
  let killed = 0;

  if (all) {
    // Kill all daemons
    const listings = await listDaemonLocks();
    for (const listing of listings) {
      await killDaemon(listing.lock.pid);
      await deleteLock(listing.lock.rootDir || '.').catch(() => {});
      process.stdout.write(`[coldstart] Killed ${listing.basename} (PID ${listing.lock.pid})\n`);
      killed++;
    }
  } else {
    // Kill daemon for cwd
    const cwd = process.cwd();
    const finalRoot = resolve(cwd);
    const lock = await readLock(finalRoot);
    if (!lock) {
      process.stdout.write(`[coldstart] No daemon found for ${finalRoot}\n`);
      return;
    }
    await killDaemon(lock.pid);
    await deleteLock(finalRoot).catch(() => {});
    process.stdout.write(`[coldstart] Killed daemon (PID ${lock.pid})\n`);
    killed++;
  }

  if (killed === 0) {
    process.stdout.write(`[coldstart] No daemons to restart\n`);
  }
}
