import type { Edge, CodebaseIndex } from '../types.js';

export interface GraphData {
  outEdges: Map<string, string[]>;
  inEdges: Map<string, string[]>;
}

export function buildGraph(nodeIds: string[], edges: Edge[]): GraphData {
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();

  for (const id of nodeIds) {
    outEdges.set(id, []);
    inEdges.set(id, []);
  }

  for (const edge of edges) {
    const out = outEdges.get(edge.from);
    const inn = inEdges.get(edge.to);
    if (out && !out.includes(edge.to)) out.push(edge.to);
    if (inn && !inn.includes(edge.from)) inn.push(edge.from);
  }

  return { outEdges, inEdges };
}

// Directory prefixes that don't convey domain meaning on their own
const GENERIC_TOP_DIRS = new Set(['src', 'lib', 'app', 'apps', 'packages', 'pkg', 'source', 'code']);

/**
 * Assign domain to every file in the index based on:
 * 1. First non-generic directory segment in the file path
 * 2. Majority domain among the file's importers (graph-based fallback)
 * 3. 'core' as final default
 *
 * Must be called after the graph (inEdges) is built.
 */
export function assignDomains(index: CodebaseIndex): void {
  // Pass 1: directory-based
  for (const file of index.files.values()) {
    const parts = file.relativePath.replace(/\\/g, '/').split('/');
    const dirParts = parts.slice(0, -1); // exclude filename

    for (const part of dirParts) {
      const lower = part.toLowerCase();
      if (lower && !GENERIC_TOP_DIRS.has(lower)) {
        file.domain = lower;
        break;
      }
    }
    // Files at root or under only generic dirs stay 'unknown' for now
  }

  // Pass 2: graph-based fallback — use majority domain of importers
  for (const file of index.files.values()) {
    if (file.domain !== 'unknown') continue;

    const importerIds = index.inEdges.get(file.id) ?? [];
    const domainCount = new Map<string, number>();
    for (const importerId of importerIds) {
      const importer = index.files.get(importerId);
      if (importer && importer.domain !== 'unknown') {
        domainCount.set(importer.domain, (domainCount.get(importer.domain) ?? 0) + 1);
      }
    }

    if (domainCount.size > 0) {
      const top = [...domainCount.entries()].sort((a, b) => b[1] - a[1])[0];
      file.domain = top[0];
    }
  }

  // Pass 3: default remaining to 'core'
  for (const file of index.files.values()) {
    if (file.domain === 'unknown') {
      file.domain = 'core';
    }
  }
}

/**
 * BFS from entry points to assign depth to each node.
 * Files not reachable from any entry point get depth = Infinity.
 */
export function computeDepth(
  entryPoints: string[],
  outEdges: Map<string, string[]>,
): Map<string, number> {
  const depth = new Map<string, number>();
  const queue: Array<[string, number]> = entryPoints.map(e => [e, 0]);

  for (const [start, d] of queue) {
    if (depth.has(start)) continue;
    depth.set(start, d);
    for (const neighbor of outEdges.get(start) ?? []) {
      if (!depth.has(neighbor)) {
        queue.push([neighbor, d + 1]);
      }
    }
  }

  return depth;
}
