/**
 * The data half of `coldstart graph` — turn an already-built index into the
 * compact payload the viewer draws.
 *
 * Nothing here builds or parses: it reads the index the keeper already has,
 * plus the co-change sidecar and the notebook, and reduces them to two arrays.
 * Globe positions are NOT dumped — the viewer derives every seat from the band
 * assignment below, so a file lands in the same place on every reload.
 */
import type { CodebaseIndex } from '../types.js';
import type { CoChangeIndex } from '../indexer/cochange.js';

/** [filename, full path, cluster index, degree] */
export type GraphNode = [string, string, number, number];
/** [a, b, kind, directed, detail] — kinds below. */
export type GraphEdge = [number, number, number, number, string];

export const REL_IMPORT = 0;
export const REL_CALLS = 1;
export const REL_COEDIT = 2;
export const REL_NOTE = 3;

export interface GraphPayload {
  repo: string;
  clusters: string[];
  n: GraphNode[];
  e: GraphEdge[];
}

export interface GraphStats {
  files: number;
  clusters: number;
  edges: number;
  byKind: [number, number, number, number];
  isolated: number;
  notes: number;
}

/** A note reduced to the file paths it anchors — the caller supplies these so
 *  this module never has to load the notebook itself. */
export interface GraphNoteAnchors {
  title: string;
  paths: string[];
}

/**
 * Directory bands, chosen ADAPTIVELY rather than at a fixed depth.
 *
 * A fixed two-segment cut is what a repo's own shape defeats: on arches it put
 * 1,093 of 1,615 files into `arches/app`, so one band swallowed two thirds of
 * the sphere while 14 other bands held fewer than 5 files each. Instead: split
 * any band that is too big one segment deeper until none dominates, then fold
 * the slivers together so the legend stays readable.
 */
export function assignClusters(ids: string[]): Map<string, string> {
  const N = ids.length;
  const MAX_SHARE = 0.13;
  const MIN_COUNT = Math.max(5, Math.round(N * 0.012));
  const MAX_DEPTH = 5;

  const dirOf = (p: string): string[] => { const s = p.split('/'); s.pop(); return s; };
  const at = (p: string, d: number): string => {
    const s = dirOf(p);
    return s.length === 0 ? '/' : s.slice(0, Math.min(d, s.length)).join('/');
  };

  const depth = new Map<string, number>();
  const assign = new Map(ids.map((id) => [id, at(id, 1)]));
  for (const id of ids) depth.set(assign.get(id)!, 1);

  for (let pass = 0; pass < MAX_DEPTH; pass++) {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(assign.get(id)!, (counts.get(assign.get(id)!) ?? 0) + 1);
    const oversized = [...counts].filter(
      ([k, c]) => c > N * MAX_SHARE && (depth.get(k) ?? MAX_DEPTH) < MAX_DEPTH,
    );
    if (!oversized.length) break;
    for (const [key] of oversized) {
      const d = (depth.get(key) ?? 1) + 1;
      for (const id of ids) {
        if (assign.get(id) !== key) continue;
        const sub = at(id, d);
        assign.set(id, sub);
        depth.set(sub, sub === key ? MAX_DEPTH : d);
      }
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(assign.get(id)!, (counts.get(assign.get(id)!) ?? 0) + 1);
    let changed = false;
    for (const id of ids) {
      const k = assign.get(id)!;
      if ((counts.get(k) ?? 0) >= MIN_COUNT) continue;
      const parent = k.includes('/') ? k.slice(0, k.lastIndexOf('/')) : null;
      const next = parent && counts.has(parent) ? parent : (parent ?? 'other');
      if (next !== k) { assign.set(id, next); changed = true; }
    }
    if (!changed) break;
  }
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(assign.get(id)!, (counts.get(assign.get(id)!) ?? 0) + 1);
  for (const id of ids) if ((counts.get(assign.get(id)!) ?? 0) < MIN_COUNT) assign.set(id, 'other');
  return assign;
}

/**
 * Relations, each carrying a NAME so the explorer can say *why* two files are
 * linked instead of drawing an anonymous line.
 *
 *   kind 0 import   directed  "imports" / "imported by"
 *   kind 1 calls    directed  "calls foo(), bar()"
 *   kind 2 coedit   mutual    "moves together · N of M commits"
 *   kind 3 note     mutual    "same note · <title>"
 */
export function buildGraphPayload(
  repo: string,
  index: CodebaseIndex,
  cochange: CoChangeIndex | null,
  notes: GraphNoteAnchors[],
): { payload: GraphPayload; stats: GraphStats } {
  const ids = [...index.files.keys()].sort();
  const assigned = assignClusters(ids);
  const clusterOf = (p: string) => assigned.get(p) ?? 'other';
  const idx = new Map(ids.map((id, i) => [id, i]));

  const rel = new Map<string, GraphEdge>();
  const put = (s: string, t: string, kind: number, directed: boolean, detail: string): void => {
    const a = idx.get(s), b = idx.get(t);
    if (a === undefined || b === undefined || a === b) return;
    const key = directed
      ? a + '|' + b + '|' + kind
      : Math.min(a, b) + '|' + Math.max(a, b) + '|' + kind;
    const prev = rel.get(key);
    if (prev) { if (detail && !prev[4]) prev[4] = detail; return; }
    rel.set(key, [
      directed ? a : Math.min(a, b),
      directed ? b : Math.max(a, b),
      kind, directed ? 1 : 0, detail,
    ]);
  };

  for (const e of index.edges) put(e.from, e.to, REL_IMPORT, true, '');

  // Cross-file calls aggregated to the file pair: a reader wants "calls save(),
  // load()", not 40 anonymous parallel edges. Every file-level edge is a plain
  // import, so symbol edges are the only source of real verbs.
  const symFile = new Map<string, string>();
  for (const [fid, f] of index.files) for (const sym of f.symbols ?? []) symFile.set(sym.id, fid);
  const callNames = new Map<string, Set<string>>();
  for (const e of index.symbolEdges ?? []) {
    if (e.type !== 'calls') continue;
    const fa = symFile.get(e.from), fb = symFile.get(e.to);
    if (!fa || !fb || fa === fb) continue;
    const key = fa + ' ' + fb;
    let set = callNames.get(key);
    if (!set) callNames.set(key, set = new Set());
    set.add(e.to.includes('#') ? e.to.slice(e.to.indexOf('#') + 1) : e.to);
  }
  for (const [key, names] of callNames) {
    const [fa, fb] = key.split(' ');
    const list = [...names];
    const shown = list.slice(0, 3).map((n) => n + '()').join(', ');
    put(fa, fb, REL_CALLS, true, list.length > 3 ? shown + ' +' + (list.length - 3) : shown);
  }

  // Moves together — carry the support count, which IS the evidence. Top 3
  // only, matching what `gs` prints; drawing all 8 stored partners triples the
  // ink for pairs no agent is ever told about.
  if (cochange) {
    for (const [f, ps] of Object.entries(cochange.partners)) {
      const outOf = cochange.touched?.[f] ?? 0;
      for (const [p, shared] of ps.slice(0, 3)) {
        put(f, p, REL_COEDIT, false,
          outOf ? shared + ' of ' + outOf + ' commits' : shared + ' commits');
      }
    }
  }

  // Notebook — a note joins the files it anchors, and names itself. Star from
  // the first anchor rather than all-pairs, so a 12-anchor flow note
  // contributes 11 edges instead of 66.
  let noteCount = 0;
  for (const n of notes) {
    if (n.paths.length < 2) continue;
    noteCount++;
    for (let i = 1; i < n.paths.length; i++) put(n.paths[0], n.paths[i], REL_NOTE, false, n.title);
  }

  const edges = [...rel.values()];
  const deg = new Int32Array(ids.length);
  for (const [a, b] of edges) { deg[a]++; deg[b]++; }

  const clusters = [...new Set(ids.map(clusterOf))].sort();
  const cIdx = new Map(clusters.map((c, i) => [c, i]));

  const byKind: [number, number, number, number] = [0, 1, 2, 3].map(
    (k) => edges.filter((e) => e[2] === k).length,
  ) as [number, number, number, number];

  return {
    payload: {
      repo,
      clusters,
      n: ids.map((id, i) => [id.split('/').pop()!, id, cIdx.get(clusterOf(id))!, deg[i]]),
      e: edges,
    },
    stats: {
      files: ids.length,
      clusters: clusters.length,
      edges: edges.length,
      byKind,
      isolated: ids.filter((_, i) => deg[i] === 0).length,
      notes: noteCount,
    },
  };
}
