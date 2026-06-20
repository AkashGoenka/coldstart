/**
 * coldstart restart [--all] — Kill the background keeper and clear its lock.
 *
 * Without --all: the keeper for the current working directory.
 * With --all: every keeper the user has running.
 *
 * The keeper respawns lazily on the next `coldstart find` (or MCP call), so
 * "restart" = stop now, fresh keeper on next use. Use this to clear a wedged
 * keeper or a stale lockfile.
 */

import { resolve } from 'node:path';
import { readLock, listDaemonLocks, deleteLock, killDaemon } from './daemon-lock.js';

export async function runRestart(): Promise<void> {
  const all = process.argv.includes('--all');
  let killed = 0;

  if (all) {
    // Kill every keeper.
    const listings = await listDaemonLocks();
    for (const listing of listings) {
      await killDaemon(listing.lock.pid);
      await deleteLock(listing.lock.rootDir || '.').catch(() => {});
      process.stdout.write(`[coldstart] Killed keeper ${listing.basename} (PID ${listing.lock.pid})\n`);
      killed++;
    }
  } else {
    // Kill the keeper for cwd.
    const cwd = process.cwd();
    const finalRoot = resolve(cwd);
    const lock = await readLock(finalRoot);
    if (!lock) {
      process.stdout.write(`[coldstart] No keeper found for ${finalRoot}\n`);
      return;
    }
    await killDaemon(lock.pid);
    await deleteLock(finalRoot).catch(() => {});
    process.stdout.write(`[coldstart] Killed keeper (PID ${lock.pid}) — respawns on next \`coldstart find\`\n`);
    killed++;
  }

  if (killed === 0) {
    process.stdout.write(`[coldstart] No keepers to restart\n`);
  }
}
