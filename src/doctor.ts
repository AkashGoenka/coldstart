/**
 * coldstart-mcp doctor — Health check for the daemon running on cwd.
 *
 * Finds the daemon for the current working directory, hits `/status`,
 * and reports PASS (exit 0) or FAIL (exit 1) with a brief summary.
 */

import { resolve } from 'node:path';
import { readLock, isDaemonAlive, daemonDir } from './daemon-lock.js';

interface DoctorStatus {
  state: 'building' | 'ready' | 'rebuilding' | 'failed' | 'unknown';
  fileCount: number | null;
  startedAt: number;
  indexBuildMs: number | null;
  indexedAt?: number;
}

async function probeStatus(port: number): Promise<DoctorStatus | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return (await res.json()) as DoctorStatus;
  } catch {
    return null;
  }
}

export async function runDoctor(): Promise<void> {
  const cwd = process.cwd();
  const finalRoot = resolve(cwd);

  const lock = await readLock(finalRoot);
  if (!lock) {
    process.stdout.write(
      `[coldstart] FAIL: No daemon for ${finalRoot}\n` +
      `           Daemon directory: ${daemonDir()}\n` +
      `           Run any MCP tool from your AI client to spawn one.\n`,
    );
    process.exit(1);
  }

  if (!isDaemonAlive(lock.pid)) {
    process.stdout.write(
      `[coldstart] FAIL: Daemon PID ${lock.pid} is not alive (stale lockfile)\n` +
      `           Remove the lock and restart your AI client: rm ${daemonDir()}/*\n`,
    );
    process.exit(1);
  }

  const status = await probeStatus(lock.port);
  if (!status) {
    process.stdout.write(
      `[coldstart] FAIL: Daemon PID ${lock.pid} is alive but HTTP unreachable on port ${lock.port}\n`,
    );
    process.exit(1);
  }

  if (status.state === 'failed') {
    process.stdout.write(`[coldstart] FAIL: Daemon index build failed\n`);
    process.exit(1);
  }

  if (status.state === 'building') {
    process.stdout.write(
      `[coldstart] PASS: Daemon is building index (${status.fileCount ?? '?'} files)\n`,
    );
    process.exit(0);
  }

  if (status.state === 'rebuilding') {
    process.stdout.write(
      `[coldstart] PASS: Daemon is rebuilding index (${status.fileCount ?? '?'} files)\n`,
    );
    process.exit(0);
  }

  process.stdout.write(
    `[coldstart] PASS: Daemon healthy — ${status.fileCount ?? '?'} files, ` +
    `ready on port ${lock.port} (PID ${lock.pid})\n`,
  );
  process.exit(0);
}
