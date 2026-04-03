export function buildGraph(nodeIds, edges) {
    const outEdges = new Map();
    const inEdges = new Map();
    for (const id of nodeIds) {
        outEdges.set(id, []);
        inEdges.set(id, []);
    }
    for (const edge of edges) {
        const out = outEdges.get(edge.from);
        const inn = inEdges.get(edge.to);
        if (out && !out.includes(edge.to))
            out.push(edge.to);
        if (inn && !inn.includes(edge.from))
            inn.push(edge.from);
    }
    return { outEdges, inEdges };
}
/**
 * Standard PageRank with dangling-node handling.
 * Returns a map from nodeId → score (scores sum to ~1.0).
 */
export function computePageRank(nodeIds, outEdges, damping = 0.85, maxIterations = 20, epsilon = 0.0001) {
    const N = nodeIds.length;
    if (N === 0)
        return new Map();
    const scores = new Map();
    const initial = 1 / N;
    for (const id of nodeIds)
        scores.set(id, initial);
    for (let iter = 0; iter < maxIterations; iter++) {
        // Compute dangling mass (nodes with no outlinks)
        let danglingMass = 0;
        for (const id of nodeIds) {
            const outs = outEdges.get(id) ?? [];
            if (outs.length === 0) {
                danglingMass += scores.get(id) ?? 0;
            }
        }
        const newScores = new Map();
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
            const newScore = (1 - damping) / N +
                damping * inSum +
                damping * danglingMass / N;
            newScores.set(v, newScore);
            delta += Math.abs(newScore - (scores.get(v) ?? 0));
        }
        for (const [id, s] of newScores)
            scores.set(id, s);
        if (delta < epsilon)
            break;
    }
    return scores;
}
/**
 * Find "hot nodes": files imported by at least `threshold` other files.
 */
export function findHotNodes(inEdges, threshold = 5) {
    const hot = [];
    for (const [id, importers] of inEdges) {
        if (importers.length >= threshold)
            hot.push(id);
    }
    return hot;
}
/**
 * DFS-based cycle detection. Returns sets of nodes involved in cycles.
 */
export function detectCycles(outEdges) {
    const visited = new Set();
    const inStack = new Set();
    const cycleNodes = new Set();
    function dfs(node) {
        if (inStack.has(node)) {
            cycleNodes.add(node);
            return;
        }
        if (visited.has(node))
            return;
        visited.add(node);
        inStack.add(node);
        for (const neighbor of outEdges.get(node) ?? []) {
            dfs(neighbor);
        }
        inStack.delete(node);
    }
    for (const node of outEdges.keys())
        dfs(node);
    return cycleNodes;
}
/**
 * BFS from entry points to assign depth to each node.
 * Files not reachable from any entry point get depth = Infinity.
 */
export function computeDepth(entryPoints, outEdges) {
    const depth = new Map();
    const queue = entryPoints.map(e => [e, 0]);
    for (const [start, d] of queue) {
        if (depth.has(start))
            continue;
        depth.set(start, d);
        for (const neighbor of outEdges.get(start) ?? []) {
            if (!depth.has(neighbor)) {
                queue.push([neighbor, d + 1]);
            }
        }
    }
    return depth;
}
//# sourceMappingURL=graph.js.map