import { watch } from 'node:fs';
import { join, extname } from 'node:path';
import { EXTENSION_TO_LANGUAGE } from './constants.js';

export type BatchHandler = (changedPaths: Set<string>) => void;

const DEBOUNCE_MS = 400;

/**
 * Starts a recursive fs.watch on rootDir.
 * Fires onBatch with a deduplicated set of changed absolute paths after DEBOUNCE_MS of quiet.
 * Only files whose extension maps to an indexed language are included.
 * Returns a cleanup function to stop watching.
 */
export function startWatcher(rootDir: string, onBatch: BatchHandler): () => void {
  const changedSet = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcherInstance: ReturnType<typeof watch> | null = null;

  try {
    watcherInstance = watch(rootDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const ext = extname(filename).toLowerCase();
      if (!EXTENSION_TO_LANGUAGE[ext]) return; // skip non-indexed files (SVG, JSON, CSS, etc.)

      changedSet.add(join(rootDir, filename));

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const batch = new Set(changedSet);
        changedSet.clear();
        debounceTimer = null;
        onBatch(batch);
      }, DEBOUNCE_MS);
    });
  } catch (err) {
    // fs.watch with recursive may not be available in all environments
    process.stderr.write(`[coldstart] File watcher unavailable: ${err}\n`);
    return () => {};
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcherInstance?.close();
  };
}
