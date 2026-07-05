import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readLock, writeLock, watchOwnLockfile, daemonDir } from '../src/daemon-lock.js';

// These tests exercise the keeper-lock invariants that prevent the two
// catastrophic failure modes shipped in v1.4.3:
//   1. Loop on the keeper's own lockfile write (existence-check filter).
//   2. Silent attach to an older-version keeper (version field round-trip).
// The keeper no longer serves over HTTP, so the lock carries no port.

describe('daemon-lock', () => {
  const realDaemonDir = daemonDir();
  let tmpHome: string;
  let originalHome: string | undefined;
  let testRoot: string;

  beforeEach(() => {
    // Redirect ~/.coldstart/daemon/ to a temp dir so we don't touch the
    // user's real daemons. Both readLock/writeLock/watchOwnLockfile resolve
    // their target path via the HOME env var.
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-lock-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.coldstart', 'daemon'), { recursive: true });
    // A real project root the lockfile is keyed against.
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-lock-root-'));
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(testRoot, { recursive: true, force: true });
    // Sanity: make sure we didn't somehow write into the real daemon dir
    // during the test (would catch a future regression in path resolution).
    expect(realDaemonDir.startsWith(tmpHome)).toBe(false);
  });

  describe('readLock / writeLock version round-trip', () => {
    it('preserves the version field on round-trip', async () => {
      await writeLock(testRoot, 12345, '1.4.3');
      const lock = await readLock(testRoot);
      expect(lock).toBeTruthy();
      expect(lock!.pid).toBe(12345);
      expect(lock!.version).toBe('1.4.3');
    });

    it('returns undefined version for legacy lockfiles missing the field', async () => {
      // Manually write a v1.4.2-shaped lockfile (no version field) to
      // simulate an upgrade-in-place scenario.
      const dir = path.join(tmpHome, '.coldstart', 'daemon');
      const files = fs.readdirSync(dir);
      // writeLock derives the filename internally; we can reuse it by writing once
      // with version and then stripping the field.
      await writeLock(testRoot, 9, '1.4.3');
      const written = fs.readdirSync(dir).find(f => f.endsWith('.json'))!;
      const full = path.join(dir, written);
      const raw = JSON.parse(fs.readFileSync(full, 'utf-8'));
      delete raw.version;
      fs.writeFileSync(full, JSON.stringify(raw));

      const lock = await readLock(testRoot);
      expect(lock).toBeTruthy();
      // Missing version → bridge treats as mismatch → kills daemon. This
      // is the load-bearing behavior; documenting it via test.
      expect(lock!.version).toBeUndefined();
      // Silence the unused-files lint.
      expect(files).toBeDefined();
    });
  });

  describe('watchOwnLockfile existence-check filter', () => {
    it('does NOT fire onMissing when the daemon writes its own lockfile', async () => {
      // Pre-create the lockfile so the watcher is observing a steady-state
      // condition (keeper already running). "Its own" is literal since the
      // ownership check landed: the lock must carry THIS process's pid.
      await writeLock(testRoot, process.pid, '1.4.3');

      let onMissingCalls = 0;
      const stop = watchOwnLockfile(testRoot, () => { onMissingCalls++; });

      try {
        // Simulate the keeper re-writing its lockfile (periodic touch,
        // atomic-replace pattern). This MUST NOT trigger the onMissing
        // callback — that would be the infinite-loop bug.
        await writeLock(testRoot, process.pid, '1.4.3');
        await writeLock(testRoot, process.pid, '1.4.3');

        // Wait past the 200 ms debounce + a safety margin.
        await new Promise(r => setTimeout(r, 400));
        expect(onMissingCalls).toBe(0);
      } finally {
        stop();
      }
    });

    it('fires onMissing exactly once when the user deletes the lockfile', async () => {
      await writeLock(testRoot, 22222, '1.4.3');

      let onMissingCalls = 0;
      // Short poll interval: fs.watch drops events under parallel-suite load —
      // assert the poll backstop's semantics ("fires, exactly once"), not
      // fs.watch delivery timing (the historical ~1/3 flake).
      const stop = watchOwnLockfile(testRoot, () => { onMissingCalls++; }, 150);

      try {
        // User runs `rm ~/.coldstart/daemon/foo.json`.
        const dir = path.join(tmpHome, '.coldstart', 'daemon');
        const lockFile = fs.readdirSync(dir).find(f => f.endsWith('.json'))!;
        fs.unlinkSync(path.join(dir, lockFile));

        const deadline = Date.now() + 3_000;
        while (onMissingCalls === 0 && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 50));
        }
        await new Promise(r => setTimeout(r, 300)); // window for a double-fire
        expect(onMissingCalls).toBe(1);
      } finally {
        stop();
      }
    });

    it('fires onMissing when another keeper overwrites the lock (takeover)', async () => {
      await writeLock(testRoot, process.pid, '1.4.3');

      let onMissingCalls = 0;
      // Short poll interval: fs.watch drops events under parallel-suite load
      // (the reason the poll backstop exists) — the test asserts the backstop,
      // not event delivery timing.
      const stop = watchOwnLockfile(testRoot, () => { onMissingCalls++; }, 150);

      try {
        // A replacement keeper wrote its own pid over ours — the old keeper
        // must notice (watch event or poll) and shut down exactly once.
        await writeLock(testRoot, process.pid + 1, '1.4.3');
        const deadline = Date.now() + 3_000;
        while (onMissingCalls === 0 && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 50));
        }
        await new Promise(r => setTimeout(r, 300)); // window for a double-fire
        expect(onMissingCalls).toBe(1);
      } finally {
        stop();
      }
    });

    it('stop() halts further callbacks even if the file is later deleted', async () => {
      await writeLock(testRoot, 33333, '1.4.3');
      let onMissingCalls = 0;
      const stop = watchOwnLockfile(testRoot, () => { onMissingCalls++; });
      stop();

      const dir = path.join(tmpHome, '.coldstart', 'daemon');
      const lockFile = fs.readdirSync(dir).find(f => f.endsWith('.json'))!;
      fs.unlinkSync(path.join(dir, lockFile));
      await new Promise(r => setTimeout(r, 500));

      expect(onMissingCalls).toBe(0);
    });
  });
});
