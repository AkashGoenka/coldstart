/**
 * Post-patch invariant lint — cheap structural checks run after every
 * incremental patch (and after startup reconcile). A violation means the
 * in-memory index is internally inconsistent — i.e. a patch bug — so the
 * caller logs loudly and queues a full rebuild rather than serving (and
 * cache-persisting) a corrupt graph.
 *
 * Deliberately bounded: exhaustive existence checks are O(files + edges);
 * the quadratic-ish mirror check is stride-sampled. Returns at most
 * `sampleLimit` problem strings — the point is "corrupt or not", not a
 * full diff.
 */
import type { CodebaseIndex, SymbolEdgeType } from '../types.js';

const MIRROR_SAMPLE = 2000;

/**
 * The fileId a symbolEdge endpoint asserts, or null when the ref carries no
 * file claim to verify. Qualified refs ("src/a.ts#foo") always do. Bare refs
 * are LEGITIMATE for 'extends'/'implements' targets (kept as queryable class
 * names by design — see symbol-edges.ts) — flagging those would turn every
 * repo with inheritance into an infinite rebuild loop. The only bare ref
 * that IS a fileId by construction is the 'exports' edge's from-side.
 */
function assertedFile(ref: string, type: SymbolEdgeType, side: 'from' | 'to'): string | null {
  const hash = ref.indexOf('#');
  if (hash > 0) return ref.slice(0, hash);
  if (type === 'exports' && side === 'from') return ref;
  return null;
}

export function lintIndexInvariants(index: CodebaseIndex, sampleLimit = 5): string[] {
  const problems: string[] = [];
  const files = index.files;
  const full = (): boolean => problems.length >= sampleLimit;

  // 1. flat import edges point at indexed files
  for (const e of index.edges) {
    if (!files.has(e.from)) problems.push(`edge.from not in files: ${e.from} → ${e.to}`);
    else if (!files.has(e.to)) problems.push(`edge.to not in files: ${e.from} → ${e.to}`);
    if (full()) return problems;
  }

  // 2. adjacency keys/targets exist; sampled mirror check (out ↔ in)
  let seen = 0;
  let totalOut = 0;
  for (const outs of index.outEdges.values()) totalOut += outs.length;
  const stride = Math.max(1, Math.floor(totalOut / MIRROR_SAMPLE));
  for (const [from, outs] of index.outEdges) {
    if (!files.has(from) && outs.length > 0) {
      problems.push(`outEdges key not in files: ${from}`);
      if (full()) return problems;
    }
    for (const to of outs) {
      if (!files.has(to)) {
        problems.push(`outEdges target not in files: ${from} → ${to}`);
        if (full()) return problems;
        continue;
      }
      if (seen++ % stride === 0) {
        if (!(index.inEdges.get(to) ?? []).includes(from)) {
          problems.push(`adjacency not mirrored in inEdges: ${from} → ${to}`);
          if (full()) return problems;
        }
      }
    }
  }
  for (const [to, ins] of index.inEdges) {
    if (!files.has(to) && ins.length > 0) {
      problems.push(`inEdges key not in files: ${to}`);
      if (full()) return problems;
    }
    for (const from of ins) {
      if (!files.has(from)) {
        problems.push(`inEdges source not in files: ${from} → ${to}`);
        if (full()) return problems;
      }
    }
  }

  // 3. symbol edges' asserted file sides exist (bare class-name targets skipped)
  for (const se of index.symbolEdges) {
    const fromFile = assertedFile(se.from, se.type, 'from');
    const toFile = assertedFile(se.to, se.type, 'to');
    if (fromFile !== null && !files.has(fromFile)) problems.push(`symbolEdge.from file not in files: ${se.from}`);
    else if (toFile !== null && !files.has(toFile)) problems.push(`symbolEdge.to file not in files: ${se.to}`);
    if (full()) return problems;
  }

  // 4. content-token postings reference indexed files
  for (const [token, ids] of index.contentTokenPostings) {
    for (const id of ids) {
      if (!files.has(id)) {
        problems.push(`posting references dead file: "${token}" → ${id}`);
        if (full()) return problems;
      }
    }
  }

  return problems;
}
