/**
 * Keeper observability — two small files beside the cache segments:
 *
 *   keeper-state.json  — last reconcile / patch / rebuild / save, one record,
 *                        overwritten in place (atomic). `coldstart status`
 *                        renders it so "is my index fresh, and why?" is
 *                        answerable without reading the daemon log.
 *   repair.jsonl       — append-only log of FAILURES (patch failed, rebuild
 *                        failed, invariant violation). Persistent across
 *                        keeper restarts — a keeper that silently rebuilds
 *                        every hour shows up here even if each individual
 *                        log rotated away.
 *
 * Neither filename matches saveCachedIndex's cleanup sweep (index.json,
 * graph.json, files-*, *.gz, *.gz.tmp, fingerprints.json) — same survival
 * reasoning as kb-notes.json.
 */
import { readFileSync, statSync } from 'node:fs';
import { writeFile, rename, mkdir, appendFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getCacheDir } from './cache/disk-cache.js';

export interface KeeperEventStamp {
  at: number;
  detail: string;
}

export interface KeeperState {
  pid: number;
  startedAt: number;
  lastReconcile?: KeeperEventStamp;
  lastPatch?: KeeperEventStamp;
  lastRebuild?: KeeperEventStamp;
  lastSave?: KeeperEventStamp;
}

export interface RepairEvent {
  at: number;
  event: 'patch-failed' | 'rebuild-failed' | 'invariant-violation' | 'reconcile-failed';
  detail: string;
}

const STATE_FILE = 'keeper-state.json';
const REPAIR_FILE = 'repair.jsonl';
const REPAIR_MAX_BYTES = 256 * 1024;

export function keeperStatePath(rootDir: string, baseCacheDir?: string): string {
  return join(getCacheDir(rootDir, baseCacheDir), STATE_FILE);
}

export function repairLogPath(rootDir: string, baseCacheDir?: string): string {
  return join(getCacheDir(rootDir, baseCacheDir), REPAIR_FILE);
}

/** Read-merge-write. Best-effort and atomic — observability must never take
 *  the keeper down, so all failures are swallowed. */
export async function updateKeeperState(
  rootDir: string,
  patch: Partial<KeeperState>,
  baseCacheDir?: string,
): Promise<void> {
  try {
    const path = keeperStatePath(rootDir, baseCacheDir);
    const current = readKeeperState(rootDir, baseCacheDir) ?? { pid: process.pid, startedAt: Date.now() };
    const next: KeeperState = { ...current, ...patch, pid: process.pid };
    await mkdir(dirname(path), { recursive: true });
    const tmp = path + '.tmp';
    await writeFile(tmp, JSON.stringify(next));
    await rename(tmp, path);
  } catch { /* best-effort */ }
}

export function readKeeperState(rootDir: string, baseCacheDir?: string): KeeperState | null {
  try {
    const parsed = JSON.parse(readFileSync(keeperStatePath(rootDir, baseCacheDir), 'utf8')) as KeeperState;
    return typeof parsed?.pid === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

/** Append one failure record. Size-capped: past the cap the file starts over
 *  (the tail is what matters; a growing failure log IS the signal). */
export async function appendRepairLog(
  rootDir: string,
  event: RepairEvent['event'],
  detail: string,
  baseCacheDir?: string,
): Promise<void> {
  try {
    const path = repairLogPath(rootDir, baseCacheDir);
    await mkdir(dirname(path), { recursive: true });
    try {
      if (statSync(path).size > REPAIR_MAX_BYTES) await rm(path, { force: true });
    } catch { /* absent — fine */ }
    const record: RepairEvent = { at: Date.now(), event, detail: detail.slice(0, 500) };
    await appendFile(path, JSON.stringify(record) + '\n');
  } catch { /* best-effort */ }
}

/** Last N repair events (tolerant reader — skips corrupt lines). */
export function readRepairTail(rootDir: string, n = 3, baseCacheDir?: string): RepairEvent[] {
  try {
    const lines = readFileSync(repairLogPath(rootDir, baseCacheDir), 'utf8').trim().split('\n');
    const out: RepairEvent[] = [];
    for (const line of lines.slice(-n * 2)) {
      try {
        const parsed = JSON.parse(line) as RepairEvent;
        if (typeof parsed?.at === 'number' && typeof parsed?.event === 'string') out.push(parsed);
      } catch { /* skip corrupt line */ }
    }
    return out.slice(-n);
  } catch {
    return [];
  }
}
