/**
 * coldstart-mcp status — list every daemon known to this user and report
 * whether each is alive and answering HTTP. Reads `~/.coldstart/daemon/*.json`
 * and probes `GET /mcp` on the recorded port.
 *
 * Output format is intentionally simple stdout text (not JSON) so it's
 * grep-friendly from the shell. If we later want machine-readable output we
 * can add a `--json` flag without breaking the human form.
 */

import { existsSync, statSync } from 'node:fs';
import {
  daemonDir,
  daemonLogPath,
  daemonLogPrevPath,
  isDaemonAlive,
  listDaemonLocks,
  type DaemonLockListing,
} from './daemon-lock.js';

async function probeHttp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

function fileSize(path: string): string {
  try {
    if (!existsSync(path)) return '-';
    const bytes = statSync(path).size;
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  } catch {
    return '-';
  }
}

interface Row {
  root: string;
  pid: string;
  port: string;
  status: string;
  log: string;
  logSize: string;
}

function deriveRoot(listing: DaemonLockListing): string {
  // Modern lockfiles record the absolute root path. Older ones don't —
  // fall back to the basename portion of the filename, which is the
  // project directory's name (collision-disambiguated by hash suffix).
  if (listing.lock.rootDir) return listing.lock.rootDir;
  return `(unknown — ${listing.basename})`;
}

export async function runStatus(): Promise<void> {
  const listings = await listDaemonLocks();
  if (listings.length === 0) {
    process.stdout.write(
      `No coldstart daemons found.\n` +
      `Daemon directory: ${daemonDir()}\n` +
      `Run any MCP tool from your AI client to spawn one.\n`,
    );
    return;
  }

  // Probe everything in parallel — typically a handful of entries, all on
  // 127.0.0.1, so even with timeouts this stays well under a second.
  const probed = await Promise.all(listings.map(async (l) => {
    const alive = isDaemonAlive(l.lock.pid);
    const httpOk = alive ? await probeHttp(l.lock.port) : false;
    let status: string;
    if (!alive) status = 'dead (stale lock)';
    else if (!httpOk) status = 'alive, http unreachable';
    else status = 'ok';
    // Use the lockfile's own basename for log paths — it works for old
    // lockfiles without rootDir, and for new ones it's equivalent.
    const logPath = l.lock.rootDir ? daemonLogPath(l.lock.rootDir) : '';
    const prevPath = l.lock.rootDir ? daemonLogPrevPath(l.lock.rootDir) : '';
    const log = logPath || `${daemonDir()}/${l.basename}.log`;
    return { listing: l, status, log, logSize: fileSize(log), prevPath } as const;
  }));

  const rows: Row[] = probed.map(p => ({
    root: deriveRoot(p.listing),
    pid: String(p.listing.lock.pid),
    port: String(p.listing.lock.port),
    status: p.status,
    log: p.log,
    logSize: p.logSize,
  }));

  // Column widths sized to content with reasonable minimums.
  const widths = {
    root: Math.max(4, ...rows.map(r => r.root.length)),
    pid: Math.max(3, ...rows.map(r => r.pid.length)),
    port: Math.max(4, ...rows.map(r => r.port.length)),
    status: Math.max(6, ...rows.map(r => r.status.length)),
    log: Math.max(3, ...rows.map(r => r.log.length)),
    logSize: Math.max(4, ...rows.map(r => r.logSize.length)),
  };

  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));
  const header = [
    pad('ROOT', widths.root),
    pad('PID', widths.pid),
    pad('PORT', widths.port),
    pad('STATUS', widths.status),
    pad('SIZE', widths.logSize),
    pad('LOG', widths.log),
  ].join('  ');

  const lines = [header, '─'.repeat(header.length)];
  for (const r of rows) {
    lines.push([
      pad(r.root, widths.root),
      pad(r.pid, widths.pid),
      pad(r.port, widths.port),
      pad(r.status, widths.status),
      pad(r.logSize, widths.logSize),
      pad(r.log, widths.log),
    ].join('  '));
  }

  process.stdout.write(lines.join('\n') + '\n');

  const anyDead = rows.some(r => r.status !== 'ok');
  if (anyDead) {
    process.stdout.write(
      `\nFor a sick daemon: tail the LOG path above (and the matching .log.prev for the previous run).\n` +
      `To force a respawn, remove the lockfile in ${daemonDir()} and restart your AI client.\n`,
    );
  }
}
