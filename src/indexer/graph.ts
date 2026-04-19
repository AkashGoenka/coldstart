import type { Edge } from '../types.js';

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
