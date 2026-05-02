import { dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { tryResolveBase } from './shared.js';

/**
 * PHP resolver: handles both PSR-4 namespace imports and relative path includes.
 *
 * `use App\Models\User` — resolved via composer.json autoload.psr-4 mapping.
 *   PSR-4 maps a namespace prefix (e.g. "App\\") to a directory (e.g. "app/").
 *   "App\Models\User" → strip "App\\" prefix → "Models/User" → "app/Models/User.php"
 *
 * `require_once './config.php'` — already a relative path; resolveGeneric handles
 *   these, but the extractor prefixes require paths with the raw string so we
 *   handle relative ones here too.
 *
 * Imports that don't match any PSR-4 prefix (vendor classes, built-ins) → null.
 */

interface ComposerAutoload {
  'psr-4'?: Record<string, string | string[]>;
}

interface ComposerJson {
  autoload?: ComposerAutoload;
  'autoload-dev'?: ComposerAutoload;
  repositories?: Array<{ type: string; url?: string }>;
}

// Cache per rootDir
const psr4Cache = new Map<string, Map<string, string> | null>();

function applyPsr4Section(section: ComposerAutoload | undefined, baseDir: string, map: Map<string, string>): void {
  const psr4 = section?.['psr-4'];
  if (!psr4) return;
  for (const [ns, dirs] of Object.entries(psr4)) {
    const nsKey = ns.replace(/\\+$/, ''); // strip trailing backslash
    const dir = Array.isArray(dirs) ? dirs[0] : dirs;
    if (typeof dir === 'string') map.set(nsKey, resolve(baseDir, dir));
  }
}

async function loadPsr4Map(rootDir: string): Promise<Map<string, string> | null> {
  if (psr4Cache.has(rootDir)) return psr4Cache.get(rootDir)!;
  try {
    const raw = await readFile(join(rootDir, 'composer.json'), 'utf-8');
    const cfg = JSON.parse(raw) as ComposerJson;
    const map = new Map<string, string>();

    // Root package PSR-4 autoload
    applyPsr4Section(cfg.autoload, rootDir, map);
    applyPsr4Section(cfg['autoload-dev'], rootDir, map);

    // Path repositories — merge PSR-4 from each sub-package's composer.json
    if (Array.isArray(cfg.repositories)) {
      for (const repo of cfg.repositories) {
        if (repo.type !== 'path' || !repo.url || repo.url.includes('*')) continue;
        const repoDir = resolve(rootDir, repo.url);
        try {
          const subRaw = await readFile(join(repoDir, 'composer.json'), 'utf-8');
          const subCfg = JSON.parse(subRaw) as ComposerJson;
          applyPsr4Section(subCfg.autoload, repoDir, map);
          applyPsr4Section(subCfg['autoload-dev'], repoDir, map);
        } catch { /* skip inaccessible path repo */ }
      }
    }

    psr4Cache.set(rootDir, map);
    return map;
  } catch {
    psr4Cache.set(rootDir, null);
    return null;
  }
}

export async function resolvePHP(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  // Relative path includes (require/include with ./ or ../)
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const base = resolve(dirname(fromFile), specifier);
    return tryResolveBase(base, fileIdSet, rootDir);
  }

  // PSR-4 namespace import: "App\Models\User"
  const psr4 = await loadPsr4Map(rootDir);
  if (!psr4) return null;

  // Normalise backslashes to forward slashes for comparison
  const normalised = specifier.replace(/\\/g, '/');

  // Longest-prefix match among PSR-4 namespace roots
  const entries = [...psr4.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [nsKey, dir] of entries) {
    const nsSlash = nsKey.replace(/\\/g, '/');
    if (normalised === nsSlash || normalised.startsWith(nsSlash + '/')) {
      const suffix = normalised.slice(nsSlash.length).replace(/^\//, '');
      const base = join(dir, suffix);
      return tryResolveBase(base, fileIdSet, rootDir);
    }
  }

  return null;
}
