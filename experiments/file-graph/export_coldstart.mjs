// Export coldstart's file-level import graph to the same JSON shape as the
// standalone builder, so the two can be compared head-to-head.
//
// Usage: node export_coldstart.mjs <repo_root> [out.json]

import { buildIndex } from "../../dist/index.js";
import { resolve } from "node:path";

const root = process.argv[2] ? resolve(process.argv[2]) : undefined;
const outPath = process.argv[3] ?? "arches_coldstart.json";
if (!root) {
  console.error("usage: node export_coldstart.mjs <repo_root> [out.json]");
  process.exit(1);
}

// Match the standalone builder's exclusions so the node universe lines up.
const excludes = ["migrations", "tests", "test", "docs"];

const idx = await buildIndex(root, excludes, [], true);

const nodes = [];
for (const f of idx.files.values()) {
  nodes.push({ id: f.id, language: f.language });
}

const edges = [];
for (const [from, tos] of idx.outEdges) {
  for (const to of tos) edges.push([from, to]);
}
edges.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));

const langCounts = {};
for (const n of nodes) langCounts[n.language] = (langCounts[n.language] ?? 0) + 1;

const result = {
  meta: {
    tool: "coldstart",
    root,
    files: nodes.length,
    edges: edges.length,
    languages: langCounts,
    excluded_dirs: excludes,
  },
  nodes: nodes.map((n) => n.id).sort(),
  nodeLang: Object.fromEntries(nodes.map((n) => [n.id, n.language])),
  edges,
};

const { writeFileSync } = await import("node:fs");
writeFileSync(outPath, JSON.stringify(result, null, 0));
console.log(
  `[coldstart] ${result.meta.files} files, ${result.meta.edges} edges -> ${outPath}`,
);
