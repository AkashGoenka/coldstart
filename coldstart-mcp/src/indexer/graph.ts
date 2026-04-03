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
 * Standard PageRank with dangling-node handling.
 * Returns a map from nodeId → score (scores sum to ~1.0).
 */
export function computePageRank(
  nodeIds: string[],
  outEdges: Map<string, string[]>,
  damping = 0.85,
  maxIterations = 20,
  epsilon = 0.0001,
): Map<string, number> {
  const N = nodeIds.length;
  if (N === 0) return new Map();

  const scores = new Map<string, number>();
  const initial = 1 / N;
  for (const id of nodeIds) scores.set(id, initial);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Compute dangling mass (nodes with no outlinks)
    let danglingMass = 0;
    for (const id of nodeIds) {
      const outs = outEdges.get(id) ?? [];
      if (outs.length === 0) {
        danglingMass += scores.get(id) ?? 0;
      }
    }

    const newScores = new Map<string, number>();
    let delta = 0;

    for (const v of nodeIds) {
      // Contributions from inlinks
      let inSum = 0;
      for (const id of nodeIds) {
        const outs = outEdges.get(id) ?? [];
        if (outs.includes(v)) {
          inSum += (scores.get(id) ?? 0) / outs.length;
        }
      }

      const newScore =
        (1 - damping) / N +
        damping * inSum +
        damping * danglingMass / N;

      newScores.set(v, newScore);
      delta += Math.abs(newScore - (scores.get(v) ?? 0));
    }

    for (const [id, s] of newScores) scores.set(id, s);
    if (delta < epsilon) break;
  }

  return scores;
}

/**
 * Find "hot nodes": files imported by at least `threshold` other files.
 */
export function findHotNodes(
  inEdges: Map<string, string[]>,
  threshold = 5,
): string[] {
  const hot: string[] = [];
  for (const [id, importers] of inEdges) {
    if (importers.length >= threshold) hot.push(id);
  }
  return hot;
}

/**
 * DFS-based cycle detection. Returns sets of nodes involved in cycles.
 */
export function detectCycles(outEdges: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycleNodes = new Set<string>();

  function dfs(node: string): void {
    if (inStack.has(node)) {
      cycleNodes.add(node);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    for (const neighbor of outEdges.get(node) ?? []) {
      dfs(neighbor);
    }
    inStack.delete(node);
  }

  for (const node of outEdges.keys()) dfs(node);
  return cycleNodes;
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
