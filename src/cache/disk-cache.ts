/**
 * On-disk index cache, format v18 — consumer-scoped gzipped segments.
 *
 * The old format stored one giant JSON blob (132MB on a 16k-file repo) that
 * every reader parsed in full (~900ms) even though `find` needs a fraction of
 * it. v18 splits the index by CONSUMER and interns every file path once:
 *
 *   meta.json          version + gitHead + counts. Written LAST (commit marker).
 *   table.json.gz      fileTable: relativePaths[]. Everything else refers to a
 *                      file by its integer index in this table ("fileRef").
 *   core-<n>.json.gz   find+gs: slim per-file tuples (language, line counts,
 *                      import counts, flags, slim symbols WITHOUT calls[],
 *                      contentTokens), chunked 5000 files per segment.
 *   graph.json.gz      find+gs: file edges, out/in adjacency, contentToken
 *                      postings — all int-ref encoded, SERIALIZED (no longer
 *                      rebuilt on every load).
 *   callgraph.json.gz  gs only: symbolEdges, int-ref encoded.
 *   build-<n>.json.gz  keeper only: domainMap, exports, raw imports, hash,
 *                      per-symbol calls[], resolver fields — the data needed
 *                      to PATCH the index, never to query it.
 *   buildmeta.json.gz  keeper only: tokenDocFreq.
 *   fingerprints.json  per-file [mtimeMs, size] aligned to fileTable — the
 *                      stat-walk reconcile backstop.
 *
 * Load profiles: 'find' (table+core+graph) · 'gs' (+callgraph) · 'full'
 * (+build+fingerprints). A partial load fills the untouched fields with
 * empties and stamps index.profile; saveCachedIndex refuses to persist a
 * partial index so a reader can never clobber the keeper's full cache.
 *
 * No TTL: cache validity = format version + git HEAD (checked by callers) +
 * the keeper's live watcher. Time never invalidates a correct index.
 */
import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { gzip as gzipCb, gunzip as gunzipCb } from 'node:zlib';
import { promisify } from 'node:util';
import type {
  CodebaseIndex, CacheMeta, IndexedFile, SymbolNode, Edge, SymbolEdge,
  Language, SymbolKind, EdgeType, SymbolEdgeType, CallSite, DomainEvidence,
} from '../types.js';
import { CACHE_VERSION } from '../constants.js';

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

const DEFAULT_CACHE_DIR = join(homedir(), '.coldstart', 'indexes');
const FILES_CHUNK_SIZE = 5000;

export type LoadProfile = 'find' | 'gs' | 'full';

/** Compute a stable cache key for a root directory path. */
function cacheKey(rootDir: string): string {
  const abs = resolve(rootDir);
  const hash = createHash('sha256').update(abs).digest('hex').slice(0, 16);
  return `${basename(abs)}-${hash}`;
}

export function getCacheDir(rootDir: string, baseCacheDir?: string): string {
  const base = baseCacheDir ?? DEFAULT_CACHE_DIR;
  return join(base, cacheKey(rootDir));
}

// ---------------------------------------------------------------------------
// Serialized shapes (tuples keep both bytes and parse time down)
// ---------------------------------------------------------------------------

// [name, kind, startLine, endLine, exported(0|1), extendsName|0, implementsNames|0]
type SlimSymbol = [string, SymbolKind, number, number, number, string | 0, string[] | 0];
// [language, lineCount, tokenEstimate, importedByCount, transitiveImportedByCount,
//  flags(1=barrel|2=test|4=hasDefaultExport), symbols, contentTokens|0]
type CoreFile = [Language, number, number, number, number, number, SlimSymbol[], Record<string, number> | 0];
// [fromRef, toRef, edgeType, specifier]
type CoreEdge = [number, number, EdgeType, string];
// symbol ref: fileRef (a file endpoint) | [fileRef, symbolIndex] | raw string fallback
type SymRef = number | [number, number] | string;
type SlimSymbolEdge = [SymRef, SymRef, number, number]; // [from, to, typeIdx, line(0=unknown)]
// [calls [name,line][], annotations|0] per symbol, aligned to the core symbols array
type BuildSymbol = [Array<[string, number]>, string[] | 0];
interface BuildFile {
  d: Record<string, DomainEvidence>;      // domainMap
  e: string[];                            // exports
  i: string[];                            // imports
  h: string;                              // hash
  s: BuildSymbol[];                       // per-symbol build data
  rr?: number;                            // reexportRatio
  pn?: string;                            // packageName
  x?: Record<string, unknown>;            // resolver-specific optional fields
}

const SYMBOL_EDGE_TYPES: SymbolEdgeType[] = ['calls', 'extends', 'implements', 'exports'];
const RESOLVER_FIELDS = [
  'constantReferences', 'partialDeclarations', 'eloquentRelations',
  'containerResolutions', 'djangoConventionRefs', 'submoduleImportCandidates',
] as const;

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function writeGz(path: string, data: unknown): Promise<void> {
  const buf = await gzip(Buffer.from(JSON.stringify(data)));
  // temp + rename: a reader never sees a half-written segment
  const tmp = path + '.tmp';
  await writeFile(tmp, buf);
  await rename(tmp, path);
}

async function readGz<T>(path: string): Promise<T> {
  const buf = await gunzip(await readFile(path));
  return JSON.parse(buf.toString('utf8')) as T;
}

/** meta.json is the commit marker — its write must be atomic too. */
async function writeMetaAtomic(dir: string, meta: unknown): Promise<void> {
  const path = join(dir, 'meta.json');
  const tmp = path + '.tmp-meta';
  await writeFile(tmp, JSON.stringify(meta, null, 2));
  await rename(tmp, path);
}

/**
 * Refresh ONLY the gitHead/timestamp in meta.json — for the reconcile-fresh
 * case where HEAD moved but every indexed file is unchanged (e.g. committing
 * files the keeper already patched). Without this the stored head lags
 * forever and every reader pays the full HEAD-drift wait on every query.
 * The mtime bump doubles as the "cache advanced" signal those readers poll.
 */
export async function updateCachedGitHead(
  rootDir: string,
  gitHead: string,
  baseCacheDir?: string,
): Promise<void> {
  const dir = getCacheDir(rootDir, baseCacheDir);
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf-8')) as Record<string, unknown>;
  meta.gitHead = gitHead;
  meta.timestamp = Date.now();
  await writeMetaAtomic(dir, meta);
}

export async function saveCachedIndex(
  index: CodebaseIndex,
  baseCacheDir?: string,
): Promise<void> {
  if (index.profile && index.profile !== 'full') {
    throw new Error(`refusing to save a partial index (profile=${index.profile}) — it would clobber the keeper's full cache`);
  }
  const dir = getCacheDir(index.rootDir, baseCacheDir);
  await mkdir(dir, { recursive: true });

  // Generations: segments are NEVER overwritten in place. Each save writes a
  // fresh `g<N>-` set, commits it by writing meta.json (which names the gen)
  // LAST, then sweeps older generations — keeping the previous one so a
  // reader that grabbed the old meta moments ago still finds every segment
  // it needs. Without this, a save racing a load could serve a mixed-
  // generation index (new file table + old chunk = silently misaligned data).
  let gen = 1;
  try {
    const old = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf-8')) as { gen?: number };
    if (typeof old.gen === 'number' && Number.isFinite(old.gen)) gen = old.gen + 1;
  } catch { /* no prior cache */ }
  const seg = (name: string): string => join(dir, `g${gen}-${name}`);

  // --- file table + per-file refs -----------------------------------------
  const paths: string[] = [];
  const refOf = new Map<string, number>();
  for (const id of index.files.keys()) {
    refOf.set(id, paths.length);
    paths.push(id);
  }

  // symbol name → index per file, for symbolEdge encoding
  const symIdx = new Map<string, Map<string, number>>();
  for (const [id, f] of index.files) {
    const m = new Map<string, number>();
    f.symbols.forEach((s, i) => { if (!m.has(s.name)) m.set(s.name, i); });
    symIdx.set(id, m);
  }

  const encodeSymRef = (ref: string): SymRef => {
    const fileRef = refOf.get(ref);
    if (fileRef !== undefined) return fileRef;
    const hash = ref.indexOf('#');
    if (hash > 0) {
      const fr = refOf.get(ref.slice(0, hash));
      const si = fr !== undefined ? symIdx.get(ref.slice(0, hash))!.get(ref.slice(hash + 1)) : undefined;
      if (fr !== undefined && si !== undefined) return [fr, si];
    }
    return ref; // unresolvable — keep verbatim
  };

  // --- core + build chunks (aligned to the file table) ---------------------
  const writes: Promise<void>[] = [];
  const fps: Array<[number, number]> = [];
  for (let start = 0; start < paths.length; start += FILES_CHUNK_SIZE) {
    const core: CoreFile[] = [];
    const build: BuildFile[] = [];
    for (let i = start; i < Math.min(start + FILES_CHUNK_SIZE, paths.length); i++) {
      const f = index.files.get(paths[i])!;
      const flags = (f.isBarrel ? 1 : 0) | (f.isTestFile ? 2 : 0) | (f.hasDefaultExport ? 4 : 0);
      core.push([
        f.language, f.lineCount, f.tokenEstimate, f.importedByCount, f.transitiveImportedByCount,
        flags,
        f.symbols.map((s): SlimSymbol => [
          s.name, s.kind, s.startLine, s.endLine, s.isExported ? 1 : 0,
          s.extendsName ?? 0, s.implementsNames.length ? s.implementsNames : 0,
        ]),
        f.contentTokens ?? 0,
      ]);
      const extras: Record<string, unknown> = {};
      for (const k of RESOLVER_FIELDS) if (f[k] !== undefined) extras[k] = f[k];
      build.push({
        d: f.domainMap, e: f.exports, i: f.imports, h: f.hash,
        s: f.symbols.map((s): BuildSymbol => [
          s.calls.map((c): [string, number] => [c.name, c.line]),
          s.annotations?.length ? s.annotations : 0,
        ]),
        ...(f.reexportRatio !== undefined ? { rr: f.reexportRatio } : {}),
        ...(f.packageName !== undefined ? { pn: f.packageName } : {}),
        ...(Object.keys(extras).length ? { x: extras } : {}),
      });
    }
    const n = start / FILES_CHUNK_SIZE;
    writes.push(writeGz(seg(`core-${n}.json.gz`), core));
    writes.push(writeGz(seg(`build-${n}.json.gz`), build));
  }
  for (const id of paths) {
    const f = index.files.get(id)!;
    fps.push([f.mtimeMs ?? 0, f.sizeBytes ?? 0]);
  }

  // --- graph (find+gs) ------------------------------------------------------
  const adj = (m: Map<string, string[]>): number[][] => {
    const out: number[][] = paths.map(() => []);
    for (const [k, list] of m) {
      const r = refOf.get(k);
      if (r === undefined) continue;
      out[r] = list.map((t) => refOf.get(t)).filter((x): x is number => x !== undefined);
    }
    return out;
  };
  const postings: Record<string, number[]> = {};
  for (const [tok, ids] of index.contentTokenPostings) {
    postings[tok] = ids.map((t) => refOf.get(t)).filter((x): x is number => x !== undefined);
  }
  writes.push(writeGz(seg('graph.json.gz'), {
    edges: index.edges
      .filter((e) => refOf.has(e.from) && refOf.has(e.to))
      .map((e): CoreEdge => [refOf.get(e.from)!, refOf.get(e.to)!, e.type, e.specifier]),
    out: adj(index.outEdges),
    in: adj(index.inEdges),
    postings,
  }));

  // --- callgraph (gs) -------------------------------------------------------
  writes.push(writeGz(seg('callgraph.json.gz'), {
    symbolEdges: index.symbolEdges.map((e): SlimSymbolEdge => [
      encodeSymRef(e.from), encodeSymRef(e.to),
      SYMBOL_EDGE_TYPES.indexOf(e.type), e.line ?? 0,
    ]),
  }));

  // --- keeper-only leftovers + table + fingerprints -------------------------
  writes.push(writeGz(seg('buildmeta.json.gz'), {
    tokenDocFreq: Object.fromEntries(index.tokenDocFreq),
  }));
  writes.push(writeGz(seg('table.json.gz'), { paths }));
  writes.push(writeFile(seg('fingerprints.json'), JSON.stringify(fps)));

  await Promise.all(writes);

  // meta last = commit marker
  const meta: CacheMeta & { version: string; gen: number } = {
    rootDir: index.rootDir,
    gitHead: index.gitHead,
    fileCount: index.files.size,
    timestamp: index.indexedAt,
    version: CACHE_VERSION,
    gen,
  };
  await writeMetaAtomic(dir, meta);

  // Sweep AFTER the commit: drop generations older than the previous one,
  // plus any pre-generation / legacy-format files. keeper-state.json,
  // repair.jsonl, kb-notes.json and meta.json never match.
  try {
    const existing = await readdir(dir);
    const toDelete = existing.filter((f) => {
      const m = /^g(\d+)-/.exec(f);
      if (m) return Number(m[1]) <= gen - 2;
      return f === 'index.json' || f === 'graph.json' || f.startsWith('files-')
        || f.endsWith('.gz') || f.endsWith('.gz.tmp') || f.endsWith('.tmp-meta')
        || f === 'fingerprints.json';
    });
    await Promise.all(toDelete.map((f) => rm(join(dir, f), { force: true })));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadCachedIndex(
  rootDir: string,
  baseCacheDir?: string,
  profile: LoadProfile = 'full',
): Promise<CodebaseIndex | null> {
  const dir = getCacheDir(rootDir, baseCacheDir);

  let meta: CacheMeta & { version?: string; gen?: number };
  try {
    meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf-8')) as CacheMeta & { version?: string; gen?: number };
  } catch {
    return null;
  }
  if (meta.version !== CACHE_VERSION) return null;
  // gen-prefixed segment names (absent on pre-generation v18 caches).
  const seg = (name: string): string =>
    join(dir, typeof meta.gen === 'number' ? `g${meta.gen}-${name}` : name);

  try {
    const { paths } = await readGz<{ paths: string[] }>(seg('table.json.gz'));
    const chunkCount = Math.ceil(paths.length / FILES_CHUNK_SIZE);

    // Kick off every segment read for this profile concurrently.
    const coreP = Promise.all(Array.from({ length: chunkCount }, (_v, n) =>
      readGz<CoreFile[]>(seg(`core-${n}.json.gz`))));
    const graphP = readGz<{ edges: CoreEdge[]; out: number[][]; in: number[][]; postings: Record<string, number[]> }>(
      seg('graph.json.gz'));
    const callgraphP = profile !== 'find'
      ? readGz<{ symbolEdges: SlimSymbolEdge[] }>(seg('callgraph.json.gz'))
      : null;
    const buildP = profile === 'full'
      ? Promise.all(Array.from({ length: chunkCount }, (_v, n) =>
          readGz<BuildFile[]>(seg(`build-${n}.json.gz`))))
      : null;
    const buildMetaP = profile === 'full'
      ? readGz<{ tokenDocFreq: Record<string, number> }>(seg('buildmeta.json.gz'))
      : null;
    const fpP = profile === 'full'
      ? readFile(seg('fingerprints.json'), 'utf-8').then((raw) => JSON.parse(raw) as Array<[number, number]>)
      : null;

    const [coreChunks, graph, callgraph, buildChunks, buildMeta, fps] = await Promise.all([
      coreP, graphP, callgraphP, buildP, buildMetaP, fpP,
    ]);

    const rootAbs = meta.rootDir;
    const files = new Map<string, IndexedFile>();
    for (let n = 0; n < chunkCount; n++) {
      const core = coreChunks[n];
      const build = buildChunks?.[n];
      for (let j = 0; j < core.length; j++) {
        const idx = n * FILES_CHUNK_SIZE + j;
        const rel = paths[idx];
        const [language, lineCount, tokenEstimate, importedByCount, transitiveImportedByCount, flags, slimSymbols, contentTokens] = core[j];
        const b = build?.[j];
        const symbols: SymbolNode[] = slimSymbols.map((s, si) => ({
          id: `${rel}#${s[0]}`,
          name: s[0], kind: s[1], startLine: s[2], endLine: s[3],
          isExported: s[4] === 1,
          calls: b ? b.s[si][0].map(([name, line]): CallSite => ({ name, line })) : [],
          ...(s[5] !== 0 ? { extendsName: s[5] } : {}),
          implementsNames: s[6] === 0 ? [] : s[6],
          ...(b && b.s[si][1] !== 0 ? { annotations: b.s[si][1] as string[] } : {}),
        }));
        const file: IndexedFile = {
          id: rel,
          path: rootAbs + sep + rel,
          relativePath: rel,
          language,
          domainMap: b ? b.d : {},
          exports: b ? b.e : [],
          hasDefaultExport: (flags & 4) !== 0,
          imports: b ? b.i : [],
          hash: b ? b.h : '',
          lineCount, tokenEstimate, importedByCount, transitiveImportedByCount,
          isBarrel: (flags & 1) !== 0,
          isTestFile: (flags & 2) !== 0,
          symbols,
          ...(b?.rr !== undefined ? { reexportRatio: b.rr } : {}),
          ...(b?.pn !== undefined ? { packageName: b.pn } : {}),
          ...(contentTokens !== 0 ? { contentTokens } : {}),
          ...(fps?.[idx]?.[0] ? { mtimeMs: fps[idx][0], sizeBytes: fps[idx][1] } : {}),
        };
        if (b?.x) Object.assign(file, b.x);
        files.set(rel, file);
      }
    }

    const outEdges = new Map<string, string[]>();
    const inEdges = new Map<string, string[]>();
    graph.out.forEach((list, r) => { if (list.length) outEdges.set(paths[r], list.map((t) => paths[t])); });
    graph.in.forEach((list, r) => { if (list.length) inEdges.set(paths[r], list.map((t) => paths[t])); });
    const edges: Edge[] = graph.edges.map(([f, t, type, specifier]) => ({
      from: paths[f], to: paths[t], type, specifier,
    }));
    const contentTokenPostings = new Map<string, string[]>();
    for (const [tok, refs] of Object.entries(graph.postings)) {
      contentTokenPostings.set(tok, refs.map((r) => paths[r]));
    }

    const decodeSymRef = (ref: SymRef): string => {
      if (typeof ref === 'number') return paths[ref];
      if (typeof ref === 'string') return ref;
      const [fr, si] = ref;
      return `${paths[fr]}#${files.get(paths[fr])!.symbols[si].name}`;
    };
    const symbolEdges: SymbolEdge[] = (callgraph?.symbolEdges ?? []).map(([f, t, ty, line]) => ({
      from: decodeSymRef(f), to: decodeSymRef(t),
      type: SYMBOL_EDGE_TYPES[ty],
      ...(line !== 0 ? { line } : {}),
    }));

    return {
      rootDir: meta.rootDir,
      indexedAt: meta.timestamp,
      gitHead: meta.gitHead,
      files,
      edges,
      symbolEdges,
      outEdges,
      inEdges,
      tokenDocFreq: new Map(Object.entries(buildMeta?.tokenDocFreq ?? {})),
      contentTokenPostings,
      ...(profile !== 'full' ? { profile } : {}),
    };
  } catch {
    return null; // missing/corrupt segment — caller rebuilds
  }
}
