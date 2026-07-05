/**
 * coldstart status — list every keeper known to this user and report, without
 * any network probe, whether each is alive and how fresh its on-disk index is.
 *
 * The keeper no longer serves over HTTP, so liveness is a lockfile PID check
 * (`process.kill(pid, 0)`) and freshness is the cache meta.json mtime. This
 * also covers the old `doctor` use-case ("is my index fresh?") for the cwd.
 *
 * Output is simple grep-friendly stdout text.
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  daemonDir,
  daemonLogPath,
  isDaemonAlive,
  listDaemonLocks,
  type DaemonLockListing,
} from './daemon-lock.js';
import { getCacheDir } from './cache/disk-cache.js';
import { readKeeperState, readRepairTail, type KeeperEventStamp } from './keeper-state.js';

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

function relativeAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Freshness of a root's on-disk index, derived from the cache meta.json. */
function indexFreshness(rootDir: string | undefined): string {
  if (!rootDir) return '?';
  try {
    const metaPath = join(getCacheDir(rootDir, undefined), 'meta.json');
    if (!existsSync(metaPath)) return 'no cache';
    const st = statSync(metaPath);
    const age = relativeAge(Date.now() - st.mtimeMs);
    // meta.json may carry a file count; surface it when present.
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { fileCount?: number; files?: unknown[] };
      const n = typeof meta.fileCount === 'number'
        ? meta.fileCount
        : Array.isArray(meta.files) ? meta.files.length : null;
      return n !== null ? `${n} files, ${age}` : age;
    } catch {
      return age;
    }
  } catch {
    return '?';
  }
}

function deriveRoot(listing: DaemonLockListing): string {
  if (listing.lock.rootDir) return listing.lock.rootDir;
  return `(unknown — ${listing.basename})`;
}

interface Row {
  root: string;
  pid: string;
  status: string;
  version: string;
  index: string;
  logSize: string;
}

export async function runStatus(): Promise<void> {
  const listings = await listDaemonLocks();
  if (listings.length === 0) {
    process.stdout.write(
      `No coldstart keepers running.\n` +
      `Keeper directory: ${daemonDir()}\n` +
      `Run \`coldstart find\` (or any MCP call) to spawn one.\n`,
    );
    return;
  }

  const rows: Row[] = listings.map((l) => {
    const alive = isDaemonAlive(l.lock.pid);
    const logPath = l.lock.rootDir ? daemonLogPath(l.lock.rootDir) : `${daemonDir()}/${l.basename}.log`;
    return {
      root: deriveRoot(l),
      pid: String(l.lock.pid),
      status: alive ? 'alive' : 'dead (stale lock)',
      version: l.lock.version ?? '-',
      index: indexFreshness(l.lock.rootDir),
      logSize: fileSize(logPath),
    };
  });

  const widths = {
    root: Math.max(4, ...rows.map(r => r.root.length)),
    pid: Math.max(3, ...rows.map(r => r.pid.length)),
    status: Math.max(6, ...rows.map(r => r.status.length)),
    version: Math.max(7, ...rows.map(r => r.version.length)),
    index: Math.max(5, ...rows.map(r => r.index.length)),
    logSize: Math.max(4, ...rows.map(r => r.logSize.length)),
  };

  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));
  const header = [
    pad('ROOT', widths.root),
    pad('PID', widths.pid),
    pad('STATUS', widths.status),
    pad('VERSION', widths.version),
    pad('INDEX', widths.index),
    pad('LOG', widths.logSize),
  ].join('  ');

  const lines = [header, '─'.repeat(header.length)];
  for (const r of rows) {
    lines.push([
      pad(r.root, widths.root),
      pad(r.pid, widths.pid),
      pad(r.status, widths.status),
      pad(r.version, widths.version),
      pad(r.index, widths.index),
      pad(r.logSize, widths.logSize),
    ].join('  '));
  }

  process.stdout.write(lines.join('\n') + '\n');

  // Per-root keeper activity: why the index is (or isn't) fresh, without
  // digging through the daemon log. Sourced from keeper-state.json +
  // repair.jsonl beside the cache segments.
  const stampLine = (label: string, s: KeeperEventStamp | undefined): string | null =>
    s ? `${label} ${relativeAge(Date.now() - s.at)} (${s.detail})` : null;
  const detailLines: string[] = [];
  for (const l of listings) {
    const root = l.lock.rootDir;
    if (!root) continue;
    const state = readKeeperState(root);
    const repairs = readRepairTail(root, 1);
    if (!state && repairs.length === 0) continue;
    const parts = [
      stampLine('reconcile', state?.lastReconcile),
      stampLine('patch', state?.lastPatch),
      stampLine('rebuild', state?.lastRebuild),
      stampLine('save', state?.lastSave),
    ].filter((p): p is string => p !== null);
    if (repairs.length > 0) {
      const r = repairs[repairs.length - 1];
      parts.push(`last failure ${relativeAge(Date.now() - r.at)}: ${r.event} (${r.detail})`);
    }
    if (parts.length > 0) detailLines.push(`${root}\n  ${parts.join('\n  ')}`);
  }
  if (detailLines.length > 0) {
    process.stdout.write('\n' + detailLines.join('\n') + '\n');
  }

  if (rows.some(r => r.status !== 'alive')) {
    process.stdout.write(
      `\nA dead keeper means a stale lockfile. \`coldstart restart\` clears it; ` +
      `the next \`coldstart find\` respawns a fresh keeper.\n`,
    );
  }
}
