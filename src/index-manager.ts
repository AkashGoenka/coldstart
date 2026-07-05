import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import type { CodebaseIndex } from './types.js';
import { startWatcher } from './watcher.js';
import { renderIds, notebookExists } from './kb/store.js';
import { buildKbNotesIndex, saveKbNotesIndex } from './kb/notes-index.js';
import { patchIndex } from './indexer/patch.js';
import { getGitHead } from './indexer/git.js';
import { lintIndexInvariants } from './indexer/invariants.js';
import { saveCachedIndex, getCacheDir } from './cache/disk-cache.js';
import { updateKeeperState, appendRepairLog } from './keeper-state.js';
import { patchThreshold } from './constants.js';
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
      (batch) => { this.handleNotebookRawBatch(batch); },
    );
    this.log('[coldstart] File watcher active');

    // Fix #2: Watch cache directory for manual deletes
    this.stopCacheWatcherFn = this.startCacheWatcher();

    // Seed the KB notes index so kb readers (which never load the code index)
    // have lane-2 inventories + absence stamps from the first query on.
    void this.refreshKbNotesIndex();
  }

  /** Stop watching (called on process exit). */
  stopWatching(): void {
    this.stopWatcherFn?.();
    this.stopWatcherFn = null;
    this.stopCacheWatcherFn?.();
    this.stopCacheWatcherFn = null;
    if (this.pendingCacheSave) clearTimeout(this.pendingCacheSave);
    if (this.rebuildRetryTimer) clearTimeout(this.rebuildRetryTimer);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private log(...args: unknown[]): void {
    if (!this.quiet) process.stderr.write(args.join(' ') + '\n');
  }

  /**
   * Notebook `.raw` logs changed (an agent wrote a note, or a git merge
   * unioned two logs) — re-fold and re-render the derived md for those ids.
   * Never touches the code index; md here is a browsability nicety (search
   * folds from `.raw` directly), so failures only log.
   */
  private handleNotebookRawBatch(batch: Set<string>): void {
    try {
      const ids = [...batch]
        .filter((p) => p.endsWith('.jsonl'))
        .map((p) => basename(p, '.jsonl'));
      if (!ids.length) return;
      const rendered = renderIds(this.activeIndex.rootDir, ids);
      this.log(`[coldstart] notebook: re-rendered ${rendered.length} note(s)`);
    } catch (err) {
      this.log(`[coldstart] notebook render failed: ${err}`);
    }
    // Note anchors / absence terms may have changed — refresh the notes index.
    void this.refreshKbNotesIndex();
  }

  /**
   * Rebuild the keeper-maintained KB notes index (per-anchor symbol
   * inventories + absence verdict stamps) from the live code index, and
   * persist it beside the cache. Single-flight: a refresh landing while one
   * runs is coalesced into one follow-up pass, so stamps never go stale
   * silently. kb readers only ever READ this file (C1 decoupling).
   */
  private refreshingKb = false;
  private kbRefreshQueued = false;
  private async refreshKbNotesIndex(): Promise<void> {
    if (this.noCache) return; // disk writes disabled
    if (!notebookExists(this.activeIndex.rootDir)) return;
    if (this.refreshingKb) { this.kbRefreshQueued = true; return; }
    this.refreshingKb = true;
    try {
      const kb = await buildKbNotesIndex(this.activeIndex, this.activeIndex.rootDir);
      await saveKbNotesIndex(this.activeIndex.rootDir, kb, this.cacheDir);
      this.log(`[coldstart] KB notes index refreshed (${Object.keys(kb.anchors).length} anchors, ${Object.keys(kb.absence).length} absence stamps)`);
    } catch (err) {
      this.log(`[coldstart] KB notes index refresh failed: ${err}`);
    } finally {
      this.refreshingKb = false;
      if (this.kbRefreshQueued) {
        this.kbRefreshQueued = false;
        void this.refreshKbNotesIndex();
      }
    }
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

    const threshold = patchThreshold(this.activeIndex.files.size);
    if (batch.size <= threshold) {
      this.log(`[coldstart] ${batch.size} file(s) changed — patching incrementally`);
      try {
        await patchIndex(this.activeIndex, batch, this.activeIndex.rootDir);
        // Invariant lint: a patch that left the graph inconsistent must not
        // be served or persisted — rebuild from scratch instead.
        const problems = lintIndexInvariants(this.activeIndex);
        if (problems.length > 0) {
          this.log(`[coldstart] INVARIANT VIOLATION after patch — rebuilding. ${problems.join(' | ')}`);
          void this.report('invariant-violation', problems.join(' | '));
          await this.triggerRebuild();
          return;
        }
        this.log('[coldstart] Incremental patch done');
        void this.stamp({ lastPatch: { at: Date.now(), detail: `${batch.size} file(s)` } });
        this.scheduleCacheSave();
      } catch (err) {
        this.log(`[coldstart] Patch failed (${err}) — falling back to full rebuild`);
        void this.report('patch-failed', String(err));
        await this.triggerRebuild();
      }
    } else {
      this.log(`[coldstart] ${batch.size} files changed (> ${threshold}) — triggering full rebuild`);
      await this.triggerRebuild();
    }
  }

  /** Best-effort observability writers (skipped under --no-cache). Stamps are
   *  serialized through one promise chain: updateKeeperState is read-merge-
   *  write, so two in-flight stamps would silently drop each other's fields. */
  private stampChain: Promise<void> = Promise.resolve();
  private async stamp(patch: Parameters<typeof updateKeeperState>[1]): Promise<void> {
    if (this.noCache) return;
    this.stampChain = this.stampChain
      .then(() => updateKeeperState(this.activeIndex.rootDir, patch, this.cacheDir))
      .catch(() => { /* best-effort */ });
    await this.stampChain;
  }

  private async report(event: 'patch-failed' | 'rebuild-failed' | 'invariant-violation', detail: string): Promise<void> {
    if (this.noCache) return;
    await appendRepairLog(this.activeIndex.rootDir, event, detail, this.cacheDir);
  }

  private async triggerRebuild(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      const newIndex = await this.rebuild();
      this.activeIndex = newIndex; // atomic swap
      this.log(`[coldstart] Rebuild complete (${newIndex.files.size} files)`);
      this.rebuildFailures = 0;
      void this.stamp({ lastRebuild: { at: Date.now(), detail: `${newIndex.files.size} files` } });
      this.scheduleCacheSave();
    } catch (err) {
      this.log(`[coldstart] Rebuild failed: ${err}`);
      void this.report('rebuild-failed', String(err));
      this.scheduleRebuildRetry();
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

  /**
   * A failed rebuild leaves the keeper serving a stale snapshot with no
   * guarantee another change event ever arrives — retry on a timer, backing
   * off, and give up (until the next real change) after a few attempts.
   */
  private rebuildFailures = 0;
  private rebuildRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleRebuildRetry(): void {
    this.rebuildFailures++;
    if (this.rebuildFailures > 3) {
      this.log(`[coldstart] Rebuild failed ${this.rebuildFailures - 1} time(s) — giving up until the next file change`);
      this.rebuildFailures = 0;
      return;
    }
    const delayMs = 60_000 * this.rebuildFailures;
    this.log(`[coldstart] Retrying rebuild in ${delayMs / 1000}s (attempt ${this.rebuildFailures})`);
    if (this.rebuildRetryTimer) clearTimeout(this.rebuildRetryTimer);
    this.rebuildRetryTimer = setTimeout(() => {
      this.rebuildRetryTimer = null;
      void this.triggerRebuild();
    }, delayMs);
  }

  /**
   * Sampled fingerprint audit — after each cache save, stat a rotating window
   * of indexed files against their parse-time fingerprints. Catches changes
   * the watcher missed (dropped fs events, edits in paths fs.watch didn't
   * cover); drifted files are re-fed through the normal patch path.
   */
  private auditCursor = 0;
  private async auditFingerprints(sample = 50): Promise<void> {
    const files = [...this.activeIndex.files.values()];
    if (files.length === 0) return;
    const n = Math.min(sample, files.length);
    const stale = new Set<string>();
    for (let i = 0; i < n; i++) {
      const f = files[(this.auditCursor + i) % files.length];
      try {
        const st = await stat(f.path);
        if (f.mtimeMs === undefined || f.sizeBytes === undefined
          || st.mtimeMs !== f.mtimeMs || st.size !== f.sizeBytes) stale.add(f.path);
      } catch {
        stale.add(f.path); // gone — patch plans the delete
      }
    }
    this.auditCursor = (this.auditCursor + n) % files.length;
    if (stale.size > 0) {
      this.log(`[coldstart] Fingerprint audit: ${stale.size}/${n} sampled file(s) drifted — re-patching (watcher may have missed events)`);
      void this.handleBatch(stale);
    }
  }

  /** Debounced cache write — avoids hammering disk on rapid successive patches. */
  private savingCache = false;
  private scheduleCacheSave(): void {
    if (this.noCache) return; // --no-cache: watcher is active but disk writes are disabled
    if (this.pendingCacheSave) clearTimeout(this.pendingCacheSave);
    this.pendingCacheSave = setTimeout(() => {
      this.pendingCacheSave = null;
      this.savingCache = true;
      // Refresh the stored head at save time: watcher patches track file
      // content but a checkout also moves HEAD, and a save stamped with the
      // old head makes every reader burn the full HEAD-drift wait forever.
      getGitHead(this.activeIndex.rootDir)
        .then((head) => {
          if (head) this.activeIndex.gitHead = head;
          return saveCachedIndex(this.activeIndex, this.cacheDir);
        })
        .then(() => this.stamp({ lastSave: { at: Date.now(), detail: `${this.activeIndex.files.size} files` } }))
        .then(() => this.auditFingerprints())
        .catch(err => this.log(`[coldstart] Cache write failed: ${err}`))
        .finally(() => { this.savingCache = false; });
      // Code changed → anchored files' symbols and absence-search results may
      // have too; re-stamp the KB notes index alongside the cache save.
      void this.refreshKbNotesIndex();
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

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let watcher: ReturnType<typeof watch> | null = null;

    try {
      watcher = watch(cacheDir, { recursive: false }, (_eventType, filename) => {
        // Watch fires on file changes in the cache dir. Only rebuild if meta.json
        // is missing (e.g., user deleted it via `rm meta.json`).
        // The existence check is the safety gate: if meta.json was just written
        // by the daemon, it exists and we don't rebuild.
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          // Only rebuild if meta.json is missing (user deleted cache manually).
          // Stand down while a rebuild or save is already in flight: the keeper
          // itself writes to this dir between rebuild and (debounced) meta save
          // (keeper-state stamps, segments), and treating those events as "cache
          // still missing" turned one heal into an infinite rebuild loop.
          if (!existsSync(metaPath)) {
            if (this.rebuilding || this.pendingCacheSave !== null || this.savingCache) return;
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
