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

/** Add Rails controller→view file edges for discovered controller/view pairs */
export function addRailsControllerViewEdges(
  nodeIds: Set<string>,
  outEdges: Map<string, string[]>,
  inEdges: Map<string, string[]>,
): void {
  const controllerRegex = /^(.+\/)?app\/controllers\/(.+)_controller\.rb$/;
  const viewsByDir = new Map<string, Set<string>>();

  for (const nodeId of nodeIds) {
    const match = nodeId.match(/^(.+\/)?app\/views\/(.+)\/(.+)\.(.+)$/);
    if (match) {
      const viewDir = match[2];
      if (!viewsByDir.has(viewDir)) viewsByDir.set(viewDir, new Set());
      viewsByDir.get(viewDir)!.add(nodeId);
    }
  }

  for (const nodeId of nodeIds) {
    const match = nodeId.match(controllerRegex);
    if (match) {
      const controllerName = match[2];
      const viewDirFiles = viewsByDir.get(controllerName);
      if (viewDirFiles) {
        const currentOutEdges = outEdges.get(nodeId) ?? [];
        for (const viewFile of viewDirFiles) {
          if (!currentOutEdges.includes(viewFile)) {
            currentOutEdges.push(viewFile);
            const currentInEdges = inEdges.get(viewFile) ?? [];
            if (!currentInEdges.includes(nodeId)) {
              currentInEdges.push(nodeId);
            }
            inEdges.set(viewFile, currentInEdges);
          }
        }
        outEdges.set(nodeId, currentOutEdges);
      }
    }
  }
}
