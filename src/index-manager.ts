import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { CodebaseIndex } from './types.js';
import { startWatcher } from './watcher.js';
import { patchIndex } from './indexer/patch.js';
import { saveCachedIndex, getCacheDir } from './cache/disk-cache.js';
import { PATCH_THRESHOLD } from './constants.js';
import { daemonDir } from './daemon-lock.js';

export type RebuildFn = () => Promise<CodebaseIndex>;

export interface IndexContext {
  index: CodebaseIndex;
  /** True while a full rebuild is running. Tool calls served from previous snapshot. */
  isRebuilding: boolean;
}

/**
 * Owns the live in-memory index and orchestrates incremental patches vs full rebuilds.
 *
 * Decision logic (fires on each debounced batch from the file watcher):
 *   - batch.size === 0        → no-op
 *   - batch.size <= 30        → incremental patch (serial, ~2-5ms per file)
 *   - batch.size > 30         → full rebuild in background, serve stale index until complete
 *   - patch throws            → fallback to full rebuild
 *
 * Changes that arrive WHILE a rebuild is running are collected into a pending set.
 * After the rebuild completes, the pending set is processed as a new batch so no
 * changes are silently dropped.
 *
 * Tool calls always read `getContext().index` which is the last stable snapshot.
 * Index swaps are atomic (single JS assignment).
 */
export class IndexManager {
  private activeIndex: CodebaseIndex;
  private rebuilding = false;
  private stopWatcherFn: (() => void) | null = null;
  private stopCacheWatcherFn: (() => void) | null = null;
  private pendingCacheSave: ReturnType<typeof setTimeout> | null = null;

  /**
   * Paths that changed while a rebuild was in progress.
   * Processed as a follow-up batch once the rebuild completes.
   */
  private pendingDuringRebuild = new Set<string>();

  constructor(
    initialIndex: CodebaseIndex,
    private readonly rebuild: RebuildFn,
    private readonly cacheDir: string | undefined,
    private readonly noCache: boolean,
    private readonly quiet: boolean,
  ) {
    this.activeIndex = initialIndex;
  }

  /** Returns the current index snapshot and rebuild status for tool calls. */
  getContext(): IndexContext {
    return { index: this.activeIndex, isRebuilding: this.rebuilding };
  }

  /** Start watching the project root for file changes. */
  startWatching(): void {
    this.stopWatcherFn = startWatcher(
      this.activeIndex.rootDir,
      (batch) => { void this.handleBatch(batch); },
    );
    this.log('[coldstart] File watcher active');

    // Fix #2: Watch cache directory for manual deletes
    this.stopCacheWatcherFn = this.startCacheWatcher();
  }

  /** Stop watching (called on process exit). */
  stopWatching(): void {
    this.stopWatcherFn?.();
    this.stopWatcherFn = null;
    this.stopCacheWatcherFn?.();
    this.stopCacheWatcherFn = null;
    if (this.pendingCacheSave) clearTimeout(this.pendingCacheSave);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private log(...args: unknown[]): void {
    if (!this.quiet) process.stderr.write(args.join(' ') + '\n');
  }

  private async handleBatch(batch: Set<string>): Promise<void> {
    if (batch.size === 0) return;

    if (this.rebuilding) {
      // Collect changes that arrive mid-rebuild. They are processed as a
      // follow-up batch once the rebuild completes (see triggerRebuild finally).
      for (const p of batch) this.pendingDuringRebuild.add(p);
      this.log(`[coldstart] Rebuild in progress — queued ${batch.size} change(s) for post-rebuild patch`);
      return;
    }

    if (batch.size <= PATCH_THRESHOLD) {
      this.log(`[coldstart] ${batch.size} file(s) changed — patching incrementally`);
      try {
        await patchIndex(this.activeIndex, batch, this.activeIndex.rootDir);
        this.log('[coldstart] Incremental patch done');
        this.scheduleCacheSave();
      } catch (err) {
        this.log(`[coldstart] Patch failed (${err}) — falling back to full rebuild`);
        await this.triggerRebuild();
      }
    } else {
      this.log(`[coldstart] ${batch.size} files changed (> ${PATCH_THRESHOLD}) — triggering full rebuild`);
      await this.triggerRebuild();
    }
  }

  private async triggerRebuild(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      const newIndex = await this.rebuild();
      this.activeIndex = newIndex; // atomic swap
      this.log(`[coldstart] Rebuild complete (${newIndex.files.size} files)`);
      this.scheduleCacheSave();
    } catch (err) {
      this.log(`[coldstart] Rebuild failed: ${err}`);
    } finally {
      this.rebuilding = false;

      // Process any changes that arrived while the rebuild was running.
      // These may not be reflected in the freshly built snapshot.
      if (this.pendingDuringRebuild.size > 0) {
        const pending = new Set(this.pendingDuringRebuild);
        this.pendingDuringRebuild.clear();
        this.log(`[coldstart] Processing ${pending.size} change(s) that arrived during rebuild`);
        void this.handleBatch(pending);
      }
    }
  }

  /** Debounced cache write — avoids hammering disk on rapid successive patches. */
  private scheduleCacheSave(): void {
    if (this.noCache) return; // --no-cache: watcher is active but disk writes are disabled
    if (this.pendingCacheSave) clearTimeout(this.pendingCacheSave);
    this.pendingCacheSave = setTimeout(() => {
      this.pendingCacheSave = null;
      saveCachedIndex(this.activeIndex, this.cacheDir).catch(err =>
        this.log(`[coldstart] Cache write failed: ${err}`),
      );
    }, 5_000); // write 5s after last change settles
  }

  /**
   * Fix #2: Watch the cache directory for manual deletes (e.g., user runs
   * `rm -rf ~/.coldstart/indexes/<x>/meta.json`). If meta.json is missing,
   * trigger a rebuild so the cache is recreated.
   *
   * Uses fs.watch on the parent directory (Windows quirk) and checks for
   * meta.json existence. The existence check prevents a loop: the daemon
   * itself writes meta.json on every save, which would fire the watch event,
   * but we only rebuild if meta.json is MISSING.
   */
  private startCacheWatcher(): () => void {
    if (this.noCache) return () => {}; // No cache watching if caching is disabled

    const cacheDir = getCacheDir(this.activeIndex.rootDir, this.cacheDir);
    const metaPath = join(cacheDir, 'meta.json');
    const parentDir = dirname(cacheDir);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let watcher: ReturnType<typeof watch> | null = null;

    try {
      watcher = watch(parentDir, (_eventType, filename) => {
        // fs.watch fires even if we don't care about the filename, so we
        // just check if our meta.json exists. If it doesn't, trigger rebuild.
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          // Only rebuild if meta.json is missing (user deleted cache manually)
          if (!existsSync(metaPath)) {
            this.log('[coldstart] Cache meta.json missing — triggering rebuild');
            void this.triggerRebuild();
          }
        }, 200);
      });
    } catch (err) {
      this.log(`[coldstart] Cache watcher unavailable: ${err}`);
      return () => {};
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
    };
  }
}
