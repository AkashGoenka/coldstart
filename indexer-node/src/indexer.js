/**
 * indexer.js — Core indexer: walks directories, farms out parsing to a worker
 * pool, then builds the graph and serializes the output object.
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { Graph } from './graph.js';

const WORKER_PATH = new URL('./worker.js', import.meta.url).pathname;

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.graphql', '.gql']);

const DEFAULT_EXCLUDE = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', '.turbo', 'coverage', '__pycache__',
]);

const HOT_NODE_THRESHOLD = 5;
const INDEXER_VERSION = '1.0.0-node';

/**
 * Run the full indexing pipeline.
 *
 * @param {object} opts
 * @param {string} opts.rootDir        Absolute path to the project root
 * @param {string[]} [opts.extraExclude]  Additional dir names to exclude
 * @param {boolean} [opts.withArchitecture] Include entrypoint/depth/critical-path analysis
 * @returns {Promise<{output: object, stats: object, graph: Graph}>}
 */
export async function runIndexer({ rootDir, extraExclude = [], includePaths = [], withArchitecture = false }) {
  const excludeDirs = new Set([...DEFAULT_EXCLUDE, ...extraExclude]);
  const hasReact = detectReact(rootDir);

  // ── Phase 1: Walk and collect file paths ───────────────────────────────
  const stats = {
    FilesScanned: 0,
    FilesIndexed: 0,
    FilesSkipped: 0,
    TotalTokens: 0,
    EdgesResolved: 0,
  };

  const filePaths = [];
  const roots = includePaths.length > 0 ? includePaths : [rootDir];
  for (const root of roots) {
    walkDir(root, excludeDirs, filePaths);
  }
  stats.FilesScanned = filePaths.length;

  // ── Phase 2: Parse files in worker pool ────────────────────────────────
  const graph = new Graph();
  const numWorkers = Math.max(1, cpus().length);
  const nodes = await parseWithWorkerPool(filePaths, rootDir, hasReact, numWorkers, stats);

  for (const node of nodes) {
    graph.addNode(node);
  }

  // ── Phase 3: Resolve edges ─────────────────────────────────────────────
  graph.resolveEdges(rootDir, stats);

  // ── Phase 3b: Optional architecture tracing ────────────────────────────
  if (withArchitecture) {
    graph.computeDepths();
  }

  // ── Phase 4: Build output ──────────────────────────────────────────────
  const sortedNodes = [...graph.nodes.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  // Normalize node fields to match Go output schema exactly
  const outputNodes = sortedNodes.map(n => normalizeNode(n));

  let architecture_layers;
  let critical_paths = [];
  if (withArchitecture) {
    // Architecture layers — global grouped view by structural role
    const roleToKey = { router: 'routers', service: 'services', repository: 'repositories', middleware: 'middleware' };
    architecture_layers = { routers: [], services: [], repositories: [], middleware: [] };
    for (const node of graph.nodes.values()) {
      const key = roleToKey[node.architectural_role];
      if (key) architecture_layers[key].push(node.id);
    }
    for (const key of Object.keys(architecture_layers)) architecture_layers[key].sort();

    // Critical paths — per-entry-point role chains
    critical_paths = graph.computeCriticalPaths();
  }

  // Hot nodes — sorted by descending dependents count
  const hotNodeIDs = graph.hotNodes(HOT_NODE_THRESHOLD);
  const hotNodes = hotNodeIDs
    .map(id => {
      const node = graph.nodes.get(id);
      return {
        id,
        dependents: graph.dependents(id).length,
        domain: node?.domain ?? '',
      };
    })
    .sort((a, b) => b.dependents - a.dependents);

  const cycles = graph.detectCycles();
  const clusters = graph.clusterByDomain();

  // Edges: rename 'kind' -> 'kind' (Go uses 'type' field name but JSON key is 'kind')
  // Actually Go uses json:"type" not "kind" — let's check:
  // graph.go: Type string `json:"type"` — so output key is "type" not "kind"
  // Our graph stores { from, to, kind } — need to rename to match Go
  const outputEdges = graph.edges.map(e => ({ from: e.from, to: e.to, type: e.kind }));

  const output = {
    meta: {
      generated_at:    new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      root_dir:        rootDir,
      total_files:     outputNodes.length,
      total_edges:     outputEdges.length,
      total_tokens:    stats.TotalTokens,
      indexer_version: INDEXER_VERSION,
    },
    nodes:               outputNodes,
    edges:               outputEdges,
    clusters,
    ...(architecture_layers ? { architecture_layers } : {}),
    hot_nodes:           hotNodes,
    cycles:              cycles.length > 0 ? cycles : undefined,
    ...(critical_paths.length > 0 ? { critical_paths } : {}),
    stats,
  };

  return { output, stats, graph };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walk a directory, collecting files with supported extensions.
 */
function walkDir(dir, excludeDirs, result) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludeDirs.has(entry.name)) {
        walkDir(join(dir, entry.name), excludeDirs, result);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (EXTENSIONS.has(ext)) {
        result.push(join(dir, entry.name));
      }
    }
  }
}

/**
 * Distribute file parsing across a pool of workers.
 */
function parseWithWorkerPool(filePaths, rootDir, hasReact, numWorkers, stats) {
  return new Promise((resolve, reject) => {
    if (filePaths.length === 0) {
      resolve([]);
      return;
    }

    const nodes = [];
    const actualWorkers = Math.min(numWorkers, filePaths.length);
    let jobIndex = 0;
    let finished = 0;

    const workers = [];

    function dispatchNext(worker) {
      if (jobIndex >= filePaths.length) {
        // No more jobs for this worker — terminate it when all are done
        worker.postMessage(null); // sentinel to signal termination
        return;
      }

      const absPath = filePaths[jobIndex++];
      const relPath = relative(rootDir, absPath).replace(/\\/g, '/');
      worker.postMessage({ absPath, relPath, hasReact });
    }

    for (let i = 0; i < actualWorkers; i++) {
      const worker = new Worker(WORKER_PATH);

      worker.on('message', ({ node, error, relPath }) => {
        if (node) {
          nodes.push(node);
          stats.FilesIndexed++;
          stats.TotalTokens += node.token_estimate ?? 0;
        } else {
          stats.FilesSkipped++;
        }
        dispatchNext(worker);
      });

      worker.on('error', (err) => {
        stats.FilesSkipped++;
        dispatchNext(worker);
      });

      worker.on('exit', () => {
        finished++;
        if (finished === actualWorkers) {
          resolve(nodes);
        }
      });

      workers.push(worker);
      dispatchNext(worker);
    }
  });
}

/**
 * Check if root/package.json lists react as a dependency.
 */
function detectReact(rootDir) {
  try {
    const raw = readFileSync(join(rootDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    return !!(
      pkg.dependencies?.react ||
      pkg.devDependencies?.react ||
      pkg.peerDependencies?.react
    );
  } catch {
    return false;
  }
}

/**
 * Normalize a node to match the Go output schema exactly.
 * Ensures all required fields are present and optional fields follow the same rules.
 */
function normalizeNode(n) {
  return {
    id:             n.id,
    language:       n.language,
    summary:        n.summary ?? '',
    exports:        n.exports ?? [],
    imports:        n.imports ?? [],
    domain:         n.domain ?? 'misc',
    is_entry_point: n.is_entry_point ?? false,
    line_count:     n.line_count ?? 0,
    token_estimate: n.token_estimate ?? 0,
    hash:           n.hash ?? '',
    // omitempty equivalents
    ...(n.depth !== undefined ? { depth: n.depth } : {}),
    ...(n.reachable !== undefined ? { reachable: n.reachable } : {}),
    ...(n.architectural_role ? { architectural_role: n.architectural_role } : {}),
    ...(n.hook_names && n.hook_names.length > 0 ? { hook_names: n.hook_names } : {}),
    ...(n.jsx_components && n.jsx_components.length > 0 ? { jsx_components: n.jsx_components } : {}),
    ...(n.props_types && n.props_types.length > 0 ? { props_types: n.props_types } : {}),
    ...(n.internal_hooks && n.internal_hooks.length > 0 ? { internal_hooks: n.internal_hooks } : {}),
    ...(n.gql ? { gql: n.gql } : {}),
  };
}
