import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { CACHE_VERSION } from '../constants.js';
const DEFAULT_CACHE_DIR = join(homedir(), '.coldstart', 'indexes');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
/**
 * Compute a stable cache key for a root directory path.
 */
function cacheKey(rootDir) {
    return createHash('md5').update(resolve(rootDir)).digest('hex').slice(0, 16);
}
export function getCacheDir(rootDir, baseCacheDir) {
    const base = baseCacheDir ?? DEFAULT_CACHE_DIR;
    return join(base, cacheKey(rootDir));
}
export async function loadCachedIndex(rootDir, baseCacheDir) {
    const dir = getCacheDir(rootDir, baseCacheDir);
    const metaPath = join(dir, 'meta.json');
    const indexPath = join(dir, 'index.json');
    try {
        await access(metaPath);
        await access(indexPath);
    }
    catch {
        return null; // Cache does not exist
    }
    let meta;
    try {
        const raw = await readFile(metaPath, 'utf-8');
        meta = JSON.parse(raw);
    }
    catch {
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
        const plain = JSON.parse(raw);
        return deserializeIndex(plain);
    }
    catch {
        return null;
    }
}
export async function saveCachedIndex(index, baseCacheDir) {
    const dir = getCacheDir(index.rootDir, baseCacheDir);
    await mkdir(dir, { recursive: true });
    const meta = {
        rootDir: index.rootDir,
        gitHead: index.gitHead,
        fileCount: index.files.size,
        timestamp: index.indexedAt,
        version: CACHE_VERSION,
    };
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    await writeFile(join(dir, 'index.json'), JSON.stringify(serializeIndex(index)));
}
export async function isCacheStale(index, currentGitHead, baseCacheDir) {
    const dir = getCacheDir(index.rootDir, baseCacheDir);
    const metaPath = join(dir, 'meta.json');
    try {
        const raw = await readFile(metaPath, 'utf-8');
        const meta = JSON.parse(raw);
        if (meta.gitHead && currentGitHead && meta.gitHead !== currentGitHead) {
            return true;
        }
        if (Date.now() - meta.timestamp > CACHE_TTL_MS) {
            return true;
        }
        return false;
    }
    catch {
        return true;
    }
}
function serializeIndex(index) {
    const files = {};
    for (const [k, v] of index.files)
        files[k] = v;
    const outEdges = {};
    for (const [k, v] of index.outEdges)
        outEdges[k] = v;
    const inEdges = {};
    for (const [k, v] of index.inEdges)
        inEdges[k] = v;
    const pagerank = {};
    for (const [k, v] of index.pagerank)
        pagerank[k] = v;
    const cochange = {};
    for (const [k, innerMap] of index.cochange) {
        const inner = {};
        for (const [ik, iv] of innerMap)
            inner[ik] = iv;
        cochange[k] = inner;
    }
    const tfidf = {};
    for (const [k, innerMap] of index.tfidf) {
        const inner = {};
        for (const [ik, iv] of innerMap)
            inner[ik] = iv;
        tfidf[k] = inner;
    }
    const idf = {};
    for (const [k, v] of index.idf)
        idf[k] = v;
    return {
        rootDir: index.rootDir,
        indexedAt: index.indexedAt,
        gitHead: index.gitHead,
        files,
        edges: index.edges,
        outEdges,
        inEdges,
        pagerank,
        cochange,
        tfidf,
        idf,
    };
}
function deserializeIndex(plain) {
    const files = new Map();
    for (const [k, v] of Object.entries(plain.files)) {
        files.set(k, v);
    }
    const outEdges = new Map(Object.entries(plain.outEdges));
    const inEdges = new Map(Object.entries(plain.inEdges));
    const pagerank = new Map(Object.entries(plain.pagerank));
    const cochange = new Map();
    for (const [k, inner] of Object.entries(plain.cochange)) {
        cochange.set(k, new Map(Object.entries(inner)));
    }
    const tfidf = new Map();
    for (const [k, inner] of Object.entries(plain.tfidf)) {
        tfidf.set(k, new Map(Object.entries(inner)));
    }
    const idf = new Map(Object.entries(plain.idf));
    return {
        rootDir: plain.rootDir,
        indexedAt: plain.indexedAt,
        gitHead: plain.gitHead,
        files,
        edges: plain.edges,
        outEdges,
        inEdges,
        pagerank,
        cochange,
        tfidf,
        idf,
    };
}
//# sourceMappingURL=disk-cache.js.map