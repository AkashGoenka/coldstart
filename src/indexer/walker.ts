import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { DEFAULT_EXCLUDES, EXTENSION_TO_LANGUAGE } from '../constants.js';
import { toPosixRelative } from './paths.js';
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

      let language: Language | undefined;
      const ext = extname(entry.name).toLowerCase();
      language = EXTENSION_TO_LANGUAGE[ext] as Language | undefined;

      // Handle .env files: .env, .env.local, .env.production, .env.development, etc.
      if (!language && /^\.env(\.|$)/.test(entry.name)) {
        language = 'env';
      }

      // Handle Jenkinsfile: Jenkinsfile, Jenkinsfile.*, etc.
      if (!language && /^Jenkinsfile(\.|$)/.test(entry.name)) {
        language = 'groovy';
      }

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

      // Relative to the root WE WERE GIVEN, from the path we walked in on.
      //
      // This used to relativize `await realpath(fullPath)` instead, which is a
      // different path whenever an ANCESTOR is a link or a Windows 8.3 short
      // name — and symlinked entries are skipped above, so ancestors were all
      // it could still resolve. On the Windows CI runner, whose tmpdir is
      // `C:\Users\RUNNER~1\...`, libuv's realpath expanded that to
      // `runneradmin` while the caller's root kept the short form, and every
      // id came out as `../../../../../runneradmin/AppData/Local/Temp/...`.
      // Nothing threw; the ids were simply wrong.
      //
      // Canonicalising the root instead would fix the ids and break something
      // else: the resolvers relativize candidate paths against the SAME root
      // the caller passed, so file ids and import targets have to be built
      // from that one root or they stop matching each other.
      //
      // Forward-slash, ALWAYS — `relative()` is OS-native, so this was
      // `app\Models\User.php` on Windows. buildFileId normalised the *id* but
      // the relativePath field kept the backslashes, and everything downstream
      // (convention gating like `app/Models/`, tokenization, domain mapping)
      // silently stopped matching. Normalising at the producer is what makes
      // every language's path convention work on Windows, not per-caller fixes.
      const relativePath = toPosixRelative(fullPath, rootDir);

      results.push({
        absolutePath: fullPath,
        relativePath,
        language,
      });
    }
  }

  await walk(rootDir);
  return results;
}
