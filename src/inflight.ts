/**
 * What the indexer is working on RIGHT NOW — the record that survives a hang.
 *
 * This exists because of a specific failure shape: a pathological input that
 * spins the CPU inside ONE synchronous call (a catastrophic-backtracking regex
 * was the first, see content-tokens.ts). When that happens the event loop is
 * dead — a watchdog timer, a `setInterval` progress dump, a signal handler, or
 * any async flush can NEVER run again. So none of those can name the culprit.
 * The only thing that works is a record written BEFORE the work starts, with a
 * synchronous write that has already returned by the time the spin begins.
 *
 * Two rules follow from that and must not be "optimised" away:
 *   - the write is SYNCHRONOUS (writeFileSync). An async write may still be
 *     queued when the event loop stops, and queued means lost.
 *   - it is written before EVERY file, not on a timer and not per batch.
 *     Measured at ~0.04ms/file — 86ms across a 2000-file build, under 3% of a
 *     build that takes seconds — which buys the exact path instead of a
 *     100-file window to bisect by hand.
 *
 * Overwritten in place, never appended: it answers "what now", not "what
 * happened". It is CLEARED when a phase completes, which is what makes it a
 * diagnosis — a record that outlives the process that wrote it names the unit
 * of work that killed it. See readStaleInflight.
 */
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getCacheDir } from './cache/disk-cache.js';
import { isDaemonAlive } from './daemon-lock.js';

const INFLIGHT_FILE = 'inflight.json';

export type IndexPhase = 'walk' | 'parse' | 'resolve' | 'graph' | 'save' | 'cochange';

export interface Inflight {
  pid: number;
  phase: IndexPhase;
  /** Repo-relative path, when the phase works file-by-file. */
  file?: string;
  at: number;
}

export function inflightPath(rootDir: string, baseCacheDir?: string): string {
  return join(getCacheDir(rootDir, baseCacheDir), INFLIGHT_FILE);
}

/**
 * Record the unit of work about to start. Best-effort and synchronous —
 * observability must never take the keeper down, so every failure is swallowed.
 * The mkdir only happens on the first write of a run (ENOENT retry), keeping
 * the steady state to a single write syscall.
 */
export function markInflight(
  rootDir: string,
  phase: IndexPhase,
  file?: string,
  baseCacheDir?: string,
): void {
  const record: Inflight = { pid: process.pid, phase, at: Date.now() };
  if (file !== undefined) record.file = file;
  const path = inflightPath(rootDir, baseCacheDir);
  const body = JSON.stringify(record);
  try {
    writeFileSync(path, body);
  } catch {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
    } catch { /* best-effort */ }
  }
}

/** Work finished cleanly — drop the record so it can never read as a hang. */
export function clearInflight(rootDir: string, baseCacheDir?: string): void {
  try {
    unlinkSync(inflightPath(rootDir, baseCacheDir));
  } catch { /* already gone */ }
}

export function readInflight(rootDir: string, baseCacheDir?: string): Inflight | null {
  try {
    const parsed = JSON.parse(readFileSync(inflightPath(rootDir, baseCacheDir), 'utf8')) as Inflight;
    return typeof parsed?.pid === 'number' && typeof parsed?.phase === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * An in-flight record whose process is GONE. This is the smoking gun: the
 * indexer started this unit of work and never finished it, so whatever killed
 * the process (a hang the user killed, an OOM, a crash) happened here.
 *
 * Returns null when the record's process is still alive — that is ordinary
 * work in progress, not a failure.
 */
export function readStaleInflight(rootDir: string, baseCacheDir?: string): Inflight | null {
  const record = readInflight(rootDir, baseCacheDir);
  if (!record) return null;
  return isDaemonAlive(record.pid) ? null : record;
}

/** One-line human summary, shared by the keeper log and `coldstart status`. */
export function describeInflight(record: Inflight): string {
  return record.file ? `${record.phase} ${record.file}` : record.phase;
}
