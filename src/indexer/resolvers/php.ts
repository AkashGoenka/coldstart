import { dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { tryResolveBase } from './shared.js';

/**
 * PHP resolver: handles PSR-4 namespace imports and relative path includes.
 *
 * `use App\Models\User` — resolved via composer.json autoload.psr-4 mapping.
 *   PSR-4 maps a namespace prefix (e.g. "App\\") to a directory (e.g. "app/").
 *   "App\Models\User" → strip "App\\" → "Models/User" → "app/Models/User.php"
 *
 * `require_once './config.php'` — relative paths handled directly.
 *
 * composer.json may live at the file's own package, or any ancestor — including
 * dirs below rootDir, or split across packages in a monorepo. We walk up from
 * the file's directory to find the nearest composer.json.
 */

interface ComposerAutoload {
  'psr-4'?: Record<string, string | string[]>;
}

interface ComposerJson {
  autoload?: ComposerAutoload;
  'autoload-dev'?: ComposerAutoload;
  repositories?: Array<{ type: string; url?: string }>;
}

// Caches keyed by the discovered composer.json directory.
// Each PSR-4 prefix may map to multiple dirs (composer.json supports arrays).
const psr4ByDir = new Map<string, Map<string, string[]> | null>();
// Nearest-to-farthest list of composer.json directories ancestors of a startDir.
// Sub-component composer.jsons (e.g. Laravel's per-Illuminate-component setup)
// only declare their own namespace; we fall through to ancestors for the rest.
const startDirToComposerDirs = new Map<string, string[]>();

async function findComposerDirs(startDir: string): Promise<string[]> {
  const cached = startDirToComposerDirs.get(startDir);
  if (cached) return cached;
  const found: string[] = [];
  let dir = startDir;
  for (let i = 0; i < 64; i++) {
    try {
      await readFile(join(dir, 'composer.json'), 'utf-8');
      found.push(dir);
    } catch { /* not here */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  startDirToComposerDirs.set(startDir, found);
  return found;
}

function applyPsr4Section(section: ComposerAutoload | undefined, baseDir: string, map: Map<string, string[]>): void {
  const psr4 = section?.['psr-4'];
  if (!psr4) return;
  for (const [ns, dirs] of Object.entries(psr4)) {
    const nsKey = ns.replace(/\\+$/, '');
    const dirList = Array.isArray(dirs) ? dirs : (typeof dirs === 'string' ? [dirs] : []);
    const resolved = dirList.map(d => resolve(baseDir, d));
    const existing = map.get(nsKey);
    map.set(nsKey, existing ? [...existing, ...resolved] : resolved);
  }
}

async function loadPsr4MapForDir(composerDir: string): Promise<Map<string, string[]> | null> {
  if (psr4ByDir.has(composerDir)) return psr4ByDir.get(composerDir)!;
  try {
    const raw = await readFile(join(composerDir, 'composer.json'), 'utf-8');
    const cfg = JSON.parse(raw) as ComposerJson;
    const map = new Map<string, string[]>();

    applyPsr4Section(cfg.autoload, composerDir, map);
    applyPsr4Section(cfg['autoload-dev'], composerDir, map);

    if (Array.isArray(cfg.repositories)) {
      for (const repo of cfg.repositories) {
        if (repo.type !== 'path' || !repo.url || repo.url.includes('*')) continue;
        const repoDir = resolve(composerDir, repo.url);
        try {
          const subRaw = await readFile(join(repoDir, 'composer.json'), 'utf-8');
          const subCfg = JSON.parse(subRaw) as ComposerJson;
          applyPsr4Section(subCfg.autoload, repoDir, map);
          applyPsr4Section(subCfg['autoload-dev'], repoDir, map);
        } catch { /* skip */ }
      }
    }

    psr4ByDir.set(composerDir, map);
    return map;
  } catch {
    psr4ByDir.set(composerDir, null);
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

  // PSR-4 namespace import: walk up from file dir collecting all ancestor
  // composer.json mappings. Try them nearest-first; for a given map, longest
  // prefix wins but fall through to shorter prefixes if the longer one's dirs
  // don't yield a file.
  const composerDirs = await findComposerDirs(dirname(fromFile));
  if (composerDirs.length === 0) return null;

  const normalised = specifier.replace(/\\/g, '/');
  for (const composerDir of composerDirs) {
    const psr4 = await loadPsr4MapForDir(composerDir);
    if (!psr4) continue;
    const entries = [...psr4.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [nsKey, dirs] of entries) {
      const nsSlash = nsKey.replace(/\\/g, '/');
      if (normalised !== nsSlash && !normalised.startsWith(nsSlash + '/')) continue;
      const suffix = normalised.slice(nsSlash.length).replace(/^\//, '');
      for (const dir of dirs) {
        const base = join(dir, suffix);
        const result = await tryResolveBase(base, fileIdSet, rootDir);
        if (result) return result;
      }
    }
  }

  return null;
}
