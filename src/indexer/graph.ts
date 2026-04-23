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

