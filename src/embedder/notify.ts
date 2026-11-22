/**
 * Keeper → embedder daemon: "this repo's sketches were saved" (docs/embedder-daemon-design.md §2). Fire-and-
 * forget, never throws, never delays a save: the daemon embeds whatever is missing on its own schedule, and a
 * daemon that isn't running is spawned (it then reconciles every registered repo). Off under
 * COLDSTART_EMBEDDER=0 (vitest) or `init --no-embedder`.
 */
import { getCacheDir } from '../cache/disk-cache.js';
import { notifyEmbedder } from '../../hooks/embed-client.mjs';

export function notifySketchesSaved(rootDir: string, baseCacheDir?: string): void {
  void notifyEmbedder('sketches-saved', rootDir, getCacheDir(rootDir, baseCacheDir)).catch(() => { /* never matters */ });
}
