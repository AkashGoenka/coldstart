import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import type { CodebaseIndex, CacheMeta } from '../types.js';
import { CACHE_VERSION } from '../constants.js';

const DEFAULT_CACHE_DIR = join(homedir(), '.coldstart', 'indexes');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Compute a stable cache key for a root directory path.
 */
function cacheKey(rootDir: string): string {
  return createHash('md5').update(resolve(rootDir)).digest('hex').slice(0, 16);
}

export function getCacheDir(rootDir: string, baseCacheDir?: string): string {
  const base = baseCacheDir ?? DEFAULT_CACHE_DIR;
  return join(base, cacheKey(rootDir));
}

export async function loadCachedIndex(
  rootDir: string,
  baseCacheDir?: string,
): Promise<CodebaseIndex | null> {
  const dir = getCacheDir(rootDir, baseCacheDir);
  const metaPath = join(dir, 'meta.json');
  const indexPath = join(dir, 'index.json');

  try {
    await access(metaPath);
    await access(indexPath);
  } catch {
    return null; // Cache does not exist
  }

  let meta: CacheMeta & { version?: string };
  try {
    const raw = await readFile(metaPath, 'utf-8');
    meta = JSON.parse(raw) as CacheMeta & { version?: string };
  } catch {
    return null;
  }

  // Version check
  if (meta.version !== CACHE_VERSION) {
    return null;
  }

  // TTL check
  if (Date.now() - meta.timestamp > CACHE_TTL_MS) {
    return null;
  }

  // Load index
  try {
    const raw = await readFile(indexPath, 'utf-8');
    const plain = JSON.parse(raw) as SerializedIndex;
    return deserializeIndex(plain);
  } catch {
    return null;
  }
}

export async function saveCachedIndex(
  index: CodebaseIndex,
  baseCacheDir?: string,
): Promise<void> {
  const dir = getCacheDir(index.rootDir, baseCacheDir);
  await mkdir(dir, { recursive: true });

  const meta: CacheMeta & { version: string } = {
    rootDir: index.rootDir,
    gitHead: index.gitHead,
    fileCount: index.files.size,
    timestamp: index.indexedAt,
    version: CACHE_VERSION,
  };

  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  await writeFile(join(dir, 'index.json'), JSON.stringify(serializeIndex(index)));
}

export async function isCacheStale(
  index: CodebaseIndex,
  currentGitHead: string,
  baseCacheDir?: string,
): Promise<boolean> {
  const dir = getCacheDir(index.rootDir, baseCacheDir);
  const metaPath = join(dir, 'meta.json');

  try {
    const raw = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(raw) as CacheMeta;

    if (meta.gitHead && currentGitHead && meta.gitHead !== currentGitHead) {
      return true;
    }
    if (Date.now() - meta.timestamp > CACHE_TTL_MS) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Serialization helpers (Map ↔ plain object)
// ---------------------------------------------------------------------------

interface SerializedIndex {
  rootDir: string;
  indexedAt: number;
  gitHead: string;
  files: Record<string, unknown>;
  edges: unknown[];
  symbolEdges: unknown[];
  outEdges: Record<string, string[]>;
  inEdges: Record<string, string[]>;
  tokenDocFreq?: Record<string, number>;
  // v5.1.0+
  // isBarrel and transitiveImportedByCount are stored inline in files records
}

function serializeIndex(index: CodebaseIndex): SerializedIndex {
  const files: Record<string, unknown> = {};
  for (const [k, v] of index.files) files[k] = v;

  const outEdges: Record<string, string[]> = {};
  for (const [k, v] of index.outEdges) outEdges[k] = v;

  const inEdges: Record<string, string[]> = {};
  for (const [k, v] of index.inEdges) inEdges[k] = v;

  const tokenDocFreq: Record<string, number> = {};
  for (const [k, v] of index.tokenDocFreq) tokenDocFreq[k] = v;

  return {
    rootDir: index.rootDir,
    indexedAt: index.indexedAt,
    gitHead: index.gitHead,
    files,
    edges: index.edges,
    symbolEdges: index.symbolEdges,
    outEdges,
    inEdges,
    tokenDocFreq,
  };
}

function deserializeIndex(plain: SerializedIndex): CodebaseIndex {
  const files = new Map<string, CodebaseIndex['files'] extends Map<string, infer V> ? V : never>();
  for (const [k, v] of Object.entries(plain.files)) {
    // Ensure symbols and domains arrays exist for files loaded from older cache
    const file = v as Record<string, unknown>;
    if (!Array.isArray(file['symbols'])) file['symbols'] = [];
    if (!Array.isArray(file['domains'])) file['domains'] = [];
    if (typeof file['isBarrel'] !== 'boolean') file['isBarrel'] = false;
    if (typeof file['transitiveImportedByCount'] !== 'number') file['transitiveImportedByCount'] = file['importedByCount'] as number ?? 0;
    files.set(k, file as unknown as Parameters<typeof files.set>[1]);
  }

  const outEdges = new Map<string, string[]>(Object.entries(plain.outEdges));
  const inEdges = new Map<string, string[]>(Object.entries(plain.inEdges));
  const tokenDocFreq = new Map<string, number>(Object.entries(plain.tokenDocFreq ?? {}));

  return {
    rootDir: plain.rootDir,
    indexedAt: plain.indexedAt,
    gitHead: plain.gitHead,
    files,
    edges: plain.edges as CodebaseIndex['edges'],
    symbolEdges: (plain.symbolEdges ?? []) as CodebaseIndex['symbolEdges'],
    outEdges,
    inEdges,
    tokenDocFreq,
  };
}
