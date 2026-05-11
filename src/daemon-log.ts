import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  type WriteStream,
} from 'node:fs';
import { dirname } from 'node:path';
import { daemonLogPath, daemonLogPrevPath } from './daemon-lock.js';

/**
 * Per-daemon log file lives next to the daemon lockfile at
 * `~/.coldstart/daemon/<basename>-<hash>.log`. On rotation the previous
 * contents move to `<basename>-<hash>.log.prev` so the most recent crash
 * is always preserved.
 *
 * Sizing rationale: a daemon emits ~5 KB of startup output on a normal
 * repo and is near-silent in steady state. 1 MB comfortably holds a full
 * workday of patch events plus an occasional error storm without thrashing
 * disk, and worst-case per project is 2 MB across .log + .log.prev.
 */
export const MAX_LOG_BYTES = 1 * 1024 * 1024;
const ROTATE_CHECK_INTERVAL_MS = 60 * 1000;

let currentStream: WriteStream | null = null;
let currentPath: string | null = null;
let prevPath: string | null = null;
let rotateTimer: NodeJS.Timeout | null = null;
let originalStderrWrite: typeof process.stderr.write | null = null;

/**
 * Atomically rotate `<root>.log` to `<root>.log.prev`. Best-effort —
 * rotation must never crash the daemon, so all errors are swallowed.
 */
function rotateNow(logPath: string, prevTarget: string): void {
  try {
    if (existsSync(logPath)) {
      try { renameSync(logPath, prevTarget); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/**
 * Attach a file-backed logger for the running daemon process.
 *
 * - Rotates any existing `.log` to `.log.prev` before opening a fresh file,
 *   so the new daemon run starts with a clean log and the previous run's
 *   output (likely containing the crash, if any) is preserved.
 * - Overrides `process.stderr.write` so all existing `log()` call sites
 *   automatically land in the file — no caller changes needed.
 * - Starts a 60 s timer that rotates the file when it crosses 1 MB.
 *
 * Returns a teardown function for graceful shutdown.
 */
export function attachDaemonLogger(rootDir: string): () => void {
  const logPath = daemonLogPath(rootDir);
  const prevTarget = daemonLogPrevPath(rootDir);

  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch { /* directory may already exist */ }

  rotateNow(logPath, prevTarget);
  currentStream = createWriteStream(logPath, { flags: 'a' });
  currentPath = logPath;
  prevPath = prevTarget;

  originalStderrWrite = process.stderr.write.bind(process.stderr);
  // Route every process.stderr.write through the log file. Cast through
  // unknown because Node's Writable.write has three overloaded signatures.
  (process.stderr as unknown as { write: (chunk: unknown, ...rest: unknown[]) => boolean }).write =
    (chunk: unknown, ...rest: unknown[]): boolean => {
      const stream = currentStream;
      if (!stream) return originalStderrWrite!(chunk as never, ...(rest as []));
      return (stream.write as (c: unknown, ...r: unknown[]) => boolean)(chunk, ...rest);
    };

  rotateTimer = setInterval(() => {
    try {
      if (!currentPath || !prevPath) return;
      if (!existsSync(currentPath)) return;
      const size = statSync(currentPath).size;
      if (size <= MAX_LOG_BYTES) return;
      const oldStream = currentStream;
      currentStream = null;
      if (oldStream) oldStream.end();
      rotateNow(currentPath, prevPath);
      currentStream = createWriteStream(currentPath, { flags: 'a' });
    } catch {
      // Rotation is best-effort — never crash the daemon over a log roll.
    }
  }, ROTATE_CHECK_INTERVAL_MS);
  // Don't keep the daemon alive solely because of the rotation timer.
  rotateTimer.unref();

  return () => {
    if (rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = null;
    }
    const stream = currentStream;
    currentStream = null;
    currentPath = null;
    prevPath = null;
    if (stream) stream.end();
    if (originalStderrWrite) {
      (process.stderr as unknown as { write: typeof process.stderr.write }).write =
        originalStderrWrite;
      originalStderrWrite = null;
    }
  };
}
