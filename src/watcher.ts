import { watch } from 'node:fs';
import { join, extname, sep } from 'node:path';
import { EXTENSION_TO_LANGUAGE } from './constants.js';

export type BatchHandler = (changedPaths: Set<string>) => void;

const DEBOUNCE_MS = 400;

// The notebook's .raw logs live under a hidden dir the INDEX never sees, but
// the keeper must still react to them (a git merge unions the logs; the derived
// md needs re-rendering). They get their own route because the extension filter
// below would otherwise silently drop every .jsonl event.
const NOTEBOOK_RAW_PREFIX = ['.coldstart', 'notebook', '.raw'].join(sep) + sep;

/**
 * Starts a recursive fs.watch on rootDir.
 * Fires onBatch with a deduplicated set of changed absolute paths after DEBOUNCE_MS of quiet.
 * Only files whose extension maps to an indexed language are included.
 * Notebook `.raw/*.jsonl` events are routed separately to onNotebookRaw (never
 * into the index batch).
 * Returns a cleanup function to stop watching.
 */
export function startWatcher(
  rootDir: string,
  onBatch: BatchHandler,
  onNotebookRaw?: BatchHandler,
): () => void {
  const changedSet = new Set<string>();
  const notebookSet = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcherInstance: ReturnType<typeof watch> | null = null;

  const scheduleFlush = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (changedSet.size) {
        const batch = new Set(changedSet);
        changedSet.clear();
        onBatch(batch);
      }
      if (notebookSet.size) {
        const batch = new Set(notebookSet);
        notebookSet.clear();
        onNotebookRaw?.(batch);
      }
    }, DEBOUNCE_MS);
  };

  try {
    watcherInstance = watch(rootDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const ext = extname(filename).toLowerCase();

      if (filename.startsWith(NOTEBOOK_RAW_PREFIX) && ext === '.jsonl') {
        notebookSet.add(join(rootDir, filename));
        scheduleFlush();
        return;
      }
      if (!EXTENSION_TO_LANGUAGE[ext]) return; // skip non-indexed files (SVG, JSON, CSS, etc.)

      changedSet.add(join(rootDir, filename));
      scheduleFlush();
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
