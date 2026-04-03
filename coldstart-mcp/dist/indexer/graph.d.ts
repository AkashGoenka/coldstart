import type { Edge } from '../types.js';
export interface GraphData {
    outEdges: Map<string, string[]>;
    inEdges: Map<string, string[]>;
}
export declare function buildGraph(nodeIds: string[], edges: Edge[]): GraphData;
/**
 * Standard PageRank with dangling-node handling.
 * Returns a map from nodeId → score (scores sum to ~1.0).
 */
export declare function computePageRank(nodeIds: string[], outEdges: Map<string, string[]>, damping?: number, maxIterations?: number, epsilon?: number): Map<string, number>;
/**
 * Find "hot nodes": files imported by at least `threshold` other files.
 */
export declare function findHotNodes(inEdges: Map<string, string[]>, threshold?: number): string[];
/**
 * DFS-based cycle detection. Returns sets of nodes involved in cycles.
 */
export declare function detectCycles(outEdges: Map<string, string[]>): Set<string>;
/**
 * BFS from entry points to assign depth to each node.
 * Files not reachable from any entry point get depth = Infinity.
 */
export declare function computeDepth(entryPoints: string[], outEdges: Map<string, string[]>): Map<string, number>;
//# sourceMappingURL=graph.d.ts.map