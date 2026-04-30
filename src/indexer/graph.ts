import type { Edge } from '../types.js';

export interface GraphData {
  outEdges: Map<string, string[]>;
  inEdges: Map<string, string[]>;
}

export function buildGraph(nodeIds: string[], edges: Edge[]): GraphData {
  const outSets = new Map<string, Set<string>>();
  const inSets = new Map<string, Set<string>>();

  for (const id of nodeIds) {
    outSets.set(id, new Set());
    inSets.set(id, new Set());
  }

  for (const edge of edges) {
    outSets.get(edge.from)?.add(edge.to);
    inSets.get(edge.to)?.add(edge.from);
  }

  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();
  for (const [id, set] of outSets) outEdges.set(id, [...set]);
  for (const [id, set] of inSets) inEdges.set(id, [...set]);

  return { outEdges, inEdges };
}
