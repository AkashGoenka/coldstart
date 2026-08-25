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
import { unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  daemonDir,
  daemonLogPath,
  isDaemonAlive,
  listDaemonLocks,
  getCurrentVersion,
  type DaemonLockListing,
} from './daemon-lock.js';
import { getCacheDir } from './cache/disk-cache.js';
import { readKeeperState, readRepairTail, type KeeperEventStamp } from './keeper-state.js';
import { loadCoChange } from './indexer/cochange.js';

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

/**
 * Absolute coldstart hook script paths wired into a repo's Claude settings.
 * Scanned as raw text (structure-agnostic across settings shapes): every
 * `/…/hooks/<name>.mjs` referenced in a hook command. Used only to flag a path
 * a global-install move (node/nvm/prefix change) left dangling.
 */
function wiredHookPaths(rootDir: string): string[] {
  const settings = join(rootDir, '.claude', 'settings.json');
  if (!existsSync(settings)) return [];
  try {
    const raw = readFileSync(settings, 'utf-8');
    // Both separators, and a Windows drive prefix. The POSIX-only form
    // (`/…/hooks/x.mjs`) could never match a Windows entry, so the one check
    // that would have caught #158's broken wiring was itself dead on Windows.
    // Backslashes arrive JSON-escaped (`d:\\repo\\hooks\\…`), hence the
    // doubled-separator alternative.
    const re = /((?:[A-Za-z]:)?(?:\\\\|[\\/])[^\s"']*?(?:\\\\|[\\/])hooks(?:\\\\|[\\/])(?:kb-elicit|kb-recall|find-nudge|find-preguard)\.mjs)/g;
    return [...new Set(Array.from(raw.matchAll(re), (m) => m[1].replace(/\\\\/g, '\\')))];
  } catch {
    return [];
  }
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

/**
 * Drop lock records for roots that no longer exist on disk.
 *
 * A keeper that dies without cleanup leaves its lockfile behind, and if the
 * repo itself is then deleted (a temp dir, a scratch clone) the record is pure
 * garbage — it can never come back, and it can never be cleaned by the normal
 * path because that requires a reader running IN that root. One user had 18 of
 * them burying the single row they cared about.
 *
 * Deliberately conservative: only a record whose PID is dead AND whose rootDir
 * is both known and absent. A live keeper is never touched, and neither is a
 * legacy lock that never recorded its rootDir (we can't prove anything about
 * it, and guessing here would delete a real keeper's lock).
 */
async function pruneVanishedRoots(listings: DaemonLockListing[]): Promise<{ kept: DaemonLockListing[]; pruned: number }> {
  const kept: DaemonLockListing[] = [];
  let pruned = 0;
  for (const l of listings) {
    const root = l.lock.rootDir;
    if (root && !existsSync(root) && !isDaemonAlive(l.lock.pid)) {
      try {
        await unlink(l.lockPath);
        pruned++;
        continue;
      } catch { /* couldn't remove it — fall through and still show the row */ }
    }
    kept.push(l);
  }
  return { kept, pruned };
}

export async function runStatus(): Promise<void> {
  const { kept: listings, pruned } = await pruneVanishedRoots(await listDaemonLocks());
  if (listings.length === 0) {
    process.stdout.write(
      `No coldstart keepers running.\n` +
      `Keeper directory: ${daemonDir()}\n` +
      (pruned > 0 ? `Pruned ${pruned} record(s) for roots that no longer exist.\n` : '') +
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

  if (pruned > 0) lines.push('', `Pruned ${pruned} record(s) for roots that no longer exist.`);

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
    const work = state?.inProgress;
    const parts = [
      // First, because it explains a stale index better than any of the
      // "last X" stamps can — the answer is "it is working on it right now".
      work ? `IN PROGRESS: ${work.kind}${work.detail ? ` (${work.detail})` : ''}, started ${relativeAge(Date.now() - work.at)}` : null,
      stampLine('reconcile', state?.lastReconcile),
      stampLine('patch', state?.lastPatch),
      stampLine('rebuild', state?.lastRebuild),
      stampLine('save', state?.lastSave),
    ].filter((p): p is string => p !== null);
    if (repairs.length > 0) {
      const r = repairs[repairs.length - 1];
      parts.push(`last failure ${relativeAge(Date.now() - r.at)}: ${r.event} (${r.detail})`);
    }
    // Co-change is silent when git can't supply history (shallow CI checkout,
    // no repo, brand-new repo). Without this line that silence is
    // indistinguishable from "this repo genuinely has no pairs".
    const cc = loadCoChange(root);
    parts.push(cc
      ? `edited-together ${relativeAge(Date.now() - cc.builtAt)} (${cc.commitsScanned} commits, ${Object.keys(cc.partners).length} files paired)`
      : 'edited-together not derived yet (no git history, a shallow clone, or the keeper has not finished its first pass)');
    if (parts.length > 0) detailLines.push(`${root}\n  ${parts.join('\n  ')}`);
  }
  if (detailLines.length > 0) {
    process.stdout.write('\n' + detailLines.join('\n') + '\n');
  }

  // Install health: the #1 cause of "the update didn't take" is a keeper still
  // running old code, or hooks wired to a global path a node/prefix change left
  // behind. Surface both so it's diagnosed, not guessed.
  const installed = getCurrentVersion();
  // status.js runs from <installRoot>/dist/, so the package root is two up.
  const thisInstallRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const healthLines: string[] = [`\nInstalled: ${installed}  (${thisInstallRoot})`];
  for (const r of rows) {
    if (r.version !== '-' && r.version !== installed) {
      healthLines.push(
        `  ⚠ keeper on ${r.root} runs ${r.version} but ${installed} is installed — ` +
        `run \`coldstart restart\` to pick up the update`,
      );
    }
  }
  for (const l of listings) {
    if (!l.lock.rootDir) continue;
    for (const w of wiredHookPaths(l.lock.rootDir)) {
      if (!existsSync(w)) {
        healthLines.push(
          `  ⚠ wired hook path missing: ${w}\n` +
          `    (global install moved — likely a node/nvm or npm-prefix change) — ` +
          `run \`coldstart init\` in that repo to re-point the hooks`,
        );
      }
    }
  }
  process.stdout.write(healthLines.join('\n') + '\n');

  if (rows.some(r => r.status !== 'alive')) {
    process.stdout.write(
      `\nA dead keeper means a stale lockfile. \`coldstart restart\` clears it; ` +
      `the next \`coldstart find\` respawns a fresh keeper.\n`,
    );
  }
}
