import { readdir, stat, realpath } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { DEFAULT_EXCLUDES, EXTENSION_TO_LANGUAGE } from '../constants.js';
import type { Language, WalkedFile } from '../types.js';

export interface WalkOptions {
  rootDir: string;
  excludes?: string[];      // additional dir names to exclude
  includes?: string[];      // restrict walk to these subdirs (relative paths)
  maxFileSizeBytes?: number;
}

export async function walkDirectory(options: WalkOptions): Promise<WalkedFile[]> {
  const {
    rootDir,
    excludes = [],
    includes = [],
    maxFileSizeBytes = 1_000_000,
  } = options;

  const userExcludes = new Set(excludes);
  const includeSet = includes.length > 0
    ? new Set(includes.map(i => join(rootDir, i)))
    : null;

  const results: WalkedFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Permission error or other read failure — skip silently
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        // Skip symlinks to avoid cycles
        continue;
      }

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (DEFAULT_EXCLUDES.has(entry.name) || userExcludes.has(entry.name)) {
          continue;
        }
        // Skip hidden directories (e.g. .git, .next)
        if (entry.name.startsWith('.')) {
          continue;
        }
        // If includes filter is set, only descend into matching roots
        if (includeSet) {
          const isIncluded = [...includeSet].some(
            inc => fullPath.startsWith(inc) || inc.startsWith(fullPath),
          );
          if (!isIncluded) continue;
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = extname(entry.name).toLowerCase();
      const language = EXTENSION_TO_LANGUAGE[ext] as Language | undefined;
      if (!language) continue;

      // Skip generated files (e.g. foo.generated.ts, schema_pb.ts, api.pb.go)
      const nameLower = entry.name.toLowerCase();
      if (/\.(generated|pb)\.[a-z]+$/.test(nameLower) || /_(generated|pb)\.[a-z]+$/.test(nameLower)) continue;

      // Check file size
      try {
        const info = await stat(fullPath);
        if (info.size > maxFileSizeBytes) continue;
      } catch {
        continue;
      }

      // Resolve symlink chains in the path (for relative path computation only)
      let resolvedPath = fullPath;
      try {
        resolvedPath = await realpath(fullPath);
      } catch {
        resolvedPath = fullPath;
      }

      const relativePath = relative(rootDir, resolvedPath);

      results.push({
        absolutePath: resolvedPath,
        relativePath,
        language,
      });
    }
  }

  await walk(rootDir);
  return results;
}
