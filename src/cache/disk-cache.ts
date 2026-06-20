import { readFile, writeFile, mkdir, access, readdir, rm } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import type { CodebaseIndex, CacheMeta, IndexedFile } from '../types.js';
import { CACHE_VERSION, CACHE_TTL_MS } from '../constants.js';
import { buildContentTokenPostings } from '../indexer/content-tokens.js';

const DEFAULT_CACHE_DIR = join(homedir(), '.coldstart', 'indexes');
const FILES_CHUNK_SIZE = 5000;

/**
 * Compute a stable cache key for a root directory path.
 */
function cacheKey(rootDir: string): string {
  const abs = resolve(rootDir);
  const hash = createHash('sha256').update(abs).digest('hex').slice(0, 16);
  return `${basename(abs)}-${hash}`;
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
  const graphPath = join(dir, 'graph.json');

  try {
    await access(metaPath);
    await access(graphPath);
  } catch {
    // Fall back to legacy single-file cache
    try {
      await access(join(dir, 'index.json'));
    } catch {
      return null;
    }
    return loadLegacyCache(dir);
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

  // Load graph (edges, outEdges, inEdges, tokenDocFreq, metadata)
  let graph: SerializedGraph;
  try {
    const raw = await readFile(graphPath, 'utf-8');
    graph = JSON.parse(raw) as SerializedGraph;
  } catch {
    return null;
  }

  // Load file chunks
  const allFiles: Record<string, unknown> = {};
  try {
    const entries = await readdir(dir);
    const chunkFiles = entries.filter(f => f.startsWith('files-') && f.endsWith('.json')).sort();
    for (const cf of chunkFiles) {
      const raw = await readFile(join(dir, cf), 'utf-8');
      const chunk = JSON.parse(raw) as Record<string, unknown>;
      Object.assign(allFiles, chunk);
    }
  } catch {
    return null;
  }

  const plain: SerializedIndex = {
    rootDir: graph.rootDir,
    indexedAt: graph.indexedAt,
    gitHead: graph.gitHead,
    files: allFiles,
    edges: graph.edges,
    symbolEdges: graph.symbolEdges,
    outEdges: graph.outEdges,
    inEdges: graph.inEdges,
    tokenDocFreq: graph.tokenDocFreq,
  };

  return deserializeIndex(plain);
}

async function loadLegacyCache(dir: string): Promise<CodebaseIndex | null> {
  const metaPath = join(dir, 'meta.json');
  let meta: CacheMeta & { version?: string };
  try {
    const raw = await readFile(metaPath, 'utf-8');
    meta = JSON.parse(raw) as CacheMeta & { version?: string };
  } catch {
    return null;
  }
  if (meta.version !== CACHE_VERSION) return null;
  if (Date.now() - meta.timestamp > CACHE_TTL_MS) return null;

  try {
    const raw = await readFile(join(dir, 'index.json'), 'utf-8');
    const plain = JSON.parse(raw) as SerializedIndex;
    return deserializeIndex(plain);
  } catch {
    return null; // File too large or corrupt — will trigger fresh rebuild
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

  // Clean up old cache files (legacy index.json + old chunks)
  try {
    const existing = await readdir(dir);
    const toDelete = existing.filter(f => f === 'index.json' || f.startsWith('files-') || f === 'graph.json');
    await Promise.all(toDelete.map(f => rm(join(dir, f), { force: true })));
  } catch { /* ignore */ }

  const serialized = serializeIndex(index);

  // Save files in chunks to stay under Node's string limit
  const fileEntries = Object.entries(serialized.files);
  const chunkPromises: Promise<void>[] = [];
  for (let i = 0; i < fileEntries.length; i += FILES_CHUNK_SIZE) {
    const chunk: Record<string, unknown> = {};
    const end = Math.min(i + FILES_CHUNK_SIZE, fileEntries.length);
    for (let j = i; j < end; j++) {
      chunk[fileEntries[j][0]] = fileEntries[j][1];
    }
    const chunkIdx = Math.floor(i / FILES_CHUNK_SIZE);
    chunkPromises.push(writeFile(join(dir, `files-${chunkIdx}.json`), JSON.stringify(chunk)));
  }

  // Save graph (everything except files)
  const graph: SerializedGraph = {
    rootDir: serialized.rootDir,
    indexedAt: serialized.indexedAt,
    gitHead: serialized.gitHead,
    edges: serialized.edges,
    symbolEdges: serialized.symbolEdges,
    outEdges: serialized.outEdges,
    inEdges: serialized.inEdges,
    tokenDocFreq: serialized.tokenDocFreq,
  };
  chunkPromises.push(writeFile(join(dir, 'graph.json'), JSON.stringify(graph)));

  // Write all chunks + graph in parallel, then meta last (acts as commit marker)
  await Promise.all(chunkPromises);
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
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
}

interface SerializedGraph {
  rootDir: string;
  indexedAt: number;
  gitHead: string;
  edges: unknown[];
  symbolEdges: unknown[];
  outEdges: Record<string, string[]>;
  inEdges: Record<string, string[]>;
  tokenDocFreq?: Record<string, number>;
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
    if (!file['domainMap'] || typeof file['domainMap'] !== 'object') file['domainMap'] = {};
    if (typeof file['isBarrel'] !== 'boolean') file['isBarrel'] = false;
    if (typeof file['transitiveImportedByCount'] !== 'number') file['transitiveImportedByCount'] = file['importedByCount'] as number ?? 0;
    files.set(k, file as unknown as Parameters<typeof files.set>[1]);
  }

  const outEdges = new Map<string, string[]>(Object.entries(plain.outEdges));
  const inEdges = new Map<string, string[]>(Object.entries(plain.inEdges));
  const tokenDocFreq = new Map<string, number>(Object.entries(plain.tokenDocFreq ?? {}));
  // Derived, not serialized: per-file contentTokens round-trip through the
  // files chunks; rebuilding the postings here is a cheap single pass.
  const contentTokenPostings = buildContentTokenPostings(
    files.values() as Iterable<IndexedFile>,
  );

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
    contentTokenPostings,
  };
}
