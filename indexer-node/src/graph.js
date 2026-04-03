/**
 * graph.js — In-memory dependency graph with edge resolution, hot node detection,
 * cycle detection, and domain clustering.
 */

export class Graph {
  constructor() {
    /** @type {Map<string, object>} */
    this.nodes = new Map();
    /** @type {Array<{from: string, to: string, kind: string}>} */
    this.edges = [];
    /** @type {Map<string, string[]>} adjOut: file -> files it imports */
    this._adjOut = new Map();
    /** @type {Map<string, string[]>} adjIn: file -> files that import it */
    this._adjIn = new Map();
  }

  addNode(node) {
    this.nodes.set(node.id, node);
  }

  addEdge(from, to, kind = 'imports') {
    this.edges.push({ from, to, kind });

    if (!this._adjOut.has(from)) this._adjOut.set(from, []);
    this._adjOut.get(from).push(to);

    if (!this._adjIn.has(to)) this._adjIn.set(to, []);
    this._adjIn.get(to).push(from);
  }

  /**
   * Resolve relative import strings to actual node IDs.
   * Only handles imports starting with '.' or '..'.
   */
  resolveEdges(rootDir, stats) {
    const knownIDs = new Set(this.nodes.keys());
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    for (const [id, node] of this.nodes) {
      for (const imp of (node.imports ?? [])) {
        if (!imp.startsWith('.')) continue;

        const resolved = resolveRelativeImport(id, imp, knownIDs, extensions);
        if (resolved) {
          this.addEdge(id, resolved, 'imports');
          stats.EdgesResolved++;
        }
      }
    }
  }

  /**
   * Return nodes imported by >= threshold other files.
   * @param {number} threshold
   * @returns {string[]} node IDs
   */
  hotNodes(threshold = 5) {
    const hot = [];
    for (const [id, importers] of this._adjIn) {
      if (importers.length >= threshold) {
        hot.push(id);
      }
    }
    return hot;
  }

  /**
   * DFS-based cycle detection.
   * @returns {string[][]}
   */
  detectCycles() {
    const visited = new Set();
    const recStack = new Set();
    const cycles = [];

    const dfs = (id, path) => {
      visited.add(id);
      recStack.add(id);
      path.push(id);

      for (const neighbor of (this._adjOut.get(id) ?? [])) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, path);
        } else if (recStack.has(neighbor)) {
          cycles.push([...path]);
        }
      }

      recStack.delete(id);
      path.pop();
    };

    for (const id of this.nodes.keys()) {
      if (!visited.has(id)) {
        dfs(id, []);
      }
    }

    return cycles;
  }

  /**
   * Group node IDs by domain.
   * @returns {Object.<string, string[]>}
   */
  clusterByDomain() {
    const clusters = {};
    for (const [id, node] of this.nodes) {
      const domain = node.domain || 'misc';
      if (!clusters[domain]) clusters[domain] = [];
      clusters[domain].push(id);
    }
    return clusters;
  }

  /**
   * Return node IDs that import `id`.
   * @param {string} id
   * @returns {string[]}
   */
  dependents(id) {
    return this._adjIn.get(id) ?? [];
  }

  /**
   * BFS from all entry-point nodes to assign depth and reachability.
   * Mutates each node in this.nodes with { depth, reachable }.
   * Returns the depths Map for callers that need it.
   *
   * depth 0  = entry point itself
   * depth N  = N hops from the nearest entry point
   * depth -1 = unreachable from any entry point (reachable: false)
   *
   * If no entry points are detected, all nodes get depth -1 and reachable null
   * (unknown rather than false, so callers can distinguish the two cases).
   */
  computeDepths() {
    const entryPoints = [];
    for (const [id, node] of this.nodes) {
      if (node.is_entry_point) entryPoints.push(id);
    }

    if (entryPoints.length === 0) {
      for (const node of this.nodes.values()) {
        node.depth = -1;
        node.reachable = null; // null = unknown, not confirmed unreachable
      }
      return new Map();
    }

    const depths = new Map();
    const queue = [];

    for (const id of entryPoints) {
      depths.set(id, 0);
      queue.push(id);
    }

    let i = 0;
    while (i < queue.length) {
      const id = queue[i++];
      const d = depths.get(id);
      for (const neighbour of (this._adjOut.get(id) ?? [])) {
        if (!depths.has(neighbour)) {
          depths.set(neighbour, d + 1);
          queue.push(neighbour);
        }
      }
    }

    for (const [id, node] of this.nodes) {
      if (depths.has(id)) {
        node.depth    = depths.get(id);
        node.reachable = true;
      } else {
        node.depth    = -1;
        node.reachable = false;
      }
    }

    return depths;
  }

  /**
   * For each entry point, collect all reachable files grouped by architectural
   * role (router / middleware / service / repository).
   *
   * Requires computeDepths() to have been called first so that
   * node.architectural_role is already set on each node.
   *
   * @returns {Array<{entry: string, routers?: string[], middleware?: string[],
   *                  services?: string[], repositories?: string[]}>}
   */
  computeCriticalPaths() {
    const paths = [];

    for (const [id, node] of this.nodes) {
      if (!node.is_entry_point) continue;

      const visited = new Set([id]);
      const queue   = [id];
      const byRole  = { router: [], service: [], repository: [], middleware: [] };

      let qi = 0;
      while (qi < queue.length) {
        const curr = queue[qi++];
        if (curr !== id) {
          const role = this.nodes.get(curr)?.architectural_role;
          if (role && Object.prototype.hasOwnProperty.call(byRole, role)) {
            byRole[role].push(curr);
          }
        }
        for (const neighbour of (this._adjOut.get(curr) ?? [])) {
          if (!visited.has(neighbour)) {
            visited.add(neighbour);
            queue.push(neighbour);
          }
        }
      }

      const hasRoles = Object.values(byRole).some(arr => arr.length > 0);
      if (!hasRoles) continue;

      paths.push({
        entry: id,
        ...(byRole.router.length      ? { routers:      byRole.router.slice(0, 20) }     : {}),
        ...(byRole.middleware.length   ? { middleware:   byRole.middleware.slice(0, 10) }  : {}),
        ...(byRole.service.length      ? { services:     byRole.service.slice(0, 20) }    : {}),
        ...(byRole.repository.length   ? { repositories: byRole.repository.slice(0, 20) } : {}),
      });
    }

    return paths;
  }
}

/**
 * Resolve a relative import specifier to a known node ID.
 * Tries direct extension append then /index variants.
 */
function resolveRelativeImport(fromID, importSpec, knownIDs, extensions) {
  // Compute the base path relative to the fromID's directory
  const fromParts = fromID.split('/');
  fromParts.pop(); // remove the filename
  const fromDir = fromParts.join('/');

  // Join dir + importSpec and normalise '..' segments
  const raw = fromDir ? `${fromDir}/${importSpec}` : importSpec;
  const base = normalizePath(raw);

  // Try direct extension append
  for (const ext of extensions) {
    const candidate = base + ext;
    if (knownIDs.has(candidate)) return candidate;
  }

  // Try /index variants
  for (const ext of extensions) {
    const candidate = `${base}/index${ext}`;
    if (knownIDs.has(candidate)) return candidate;
  }

  return null;
}

/**
 * Normalize a slash-separated path by resolving . and .. segments.
 */
function normalizePath(p) {
  const parts = p.split('/');
  const stack = [];
  for (const part of parts) {
    if (part === '..') {
      stack.pop();
    } else if (part !== '.') {
      stack.push(part);
    }
  }
  return stack.join('/');
}
