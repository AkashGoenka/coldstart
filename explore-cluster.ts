#!/usr/bin/env node
/**
 * Spot-check exploratory script — characterize graph structure around
 * get-overview candidates for ONE query. No thresholds, no benchmarks.
 *
 * Usage: npx tsx explore-cluster.ts <repoRoot> <queryFilter> [groundTruthPath,...]
 */
import { buildIndex } from './src/index.js';
import { handleGetOverview } from './src/server/tools.js';
import type { CodebaseIndex } from './src/types.js';
import { resolve } from 'node:path';

const [, , repoArg, queryArg, gtArg] = process.argv;
if (!repoArg || !queryArg) {
  console.error('Usage: npx tsx explore-cluster.ts <repoRoot> <queryFilter> [gt1,gt2,...]');
  process.exit(1);
}
const repoRoot = resolve(repoArg);
const groundTruth = (gtArg ?? '').split(',').map(s => s.trim()).filter(Boolean);

console.error(`Indexing ${repoRoot} ...`);
const index: CodebaseIndex = await buildIndex(repoRoot, [], [], true);
console.error(`Indexed ${index.files.size} files. Querying: "${queryArg}"`);

const result = handleGetOverview(index, { domain_filter: queryArg, max_results: 20 }) as any;
const candidates: any[] = result.results ?? result.matches ?? [];
const candidatePaths: string[] = candidates.map((c: any) =>
  typeof c === 'string' ? c : (c.path ?? c.file ?? c.relativePath),
);

console.log('\n# GO RESULTS (top 20)');
candidatePaths.forEach((p, i) => console.log(`  ${i+1}. ${p}`));

// Build path -> fileId map
const pathToId = new Map<string, string>();
for (const [id, f] of index.files) pathToId.set(f.relativePath, id);

const candidateIds = candidatePaths.map(p => pathToId.get(p)).filter((x): x is string => !!x);

// inEdges = who imports me; outEdges = what I import
const inSetOf = (id: string): Set<string> => new Set(index.inEdges.get(id) ?? []);
const outSetOf = (id: string): Set<string> => new Set(index.outEdges.get(id) ?? []);

console.log('\n# CANDIDATE NEIGHBOR PROFILE');
console.log('Path | importedBy | importsOut');
console.log('---');
candidateIds.forEach((id, i) => {
  const f = index.files.get(id)!;
  console.log(`${i+1}. ${f.relativePath} | in=${(index.inEdges.get(id)??[]).length} | out=${(index.outEdges.get(id)??[]).length}`);
});

function pairwiseIntersection(getSet: (id: string) => Set<string>, label: string) {
  console.log(`\n# PAIRWISE ${label} INTERSECTION (size)`);
  const header = ['  ', ...candidateIds.map((_, i) => String(i+1).padStart(3))].join(' ');
  console.log(header);
  candidateIds.forEach((a, i) => {
    const setA = getSet(a);
    const row = [String(i+1).padStart(2)];
    candidateIds.forEach((b, j) => {
      if (j <= i) { row.push('  -'); return; }
      const setB = getSet(b);
      let n = 0;
      for (const x of setA) if (setB.has(x)) n++;
      row.push(String(n).padStart(3));
    });
    console.log(row.join(' '));
  });
}
pairwiseIntersection(inSetOf, 'importer (bibliographic-coupling: shared importers)');
pairwiseIntersection(outSetOf, 'import (co-citation: files both candidates import)');

// Bridge nodes: files NOT in candidate set that import >=2 candidates (co-citation seeds)
// or that are imported by >=2 candidates (bibliographic-coupling seeds)
console.log('\n# BRIDGE NODES (outside top-20)');
const candidateIdSet = new Set(candidateIds);
const coCitationBridges = new Map<string, number>();  // file imports >=2 candidates
const bibCouplingBridges = new Map<string, number>(); // file is imported by >=2 candidates

for (const [otherId] of index.files) {
  if (candidateIdSet.has(otherId)) continue;
  let imports = 0, importedBy = 0;
  const out = outSetOf(otherId);
  for (const cid of candidateIds) if (out.has(cid)) imports++;
  for (const cid of candidateIds) {
    const cOut = outSetOf(cid);
    if (cOut.has(otherId)) importedBy++;
  }
  if (imports >= 2) coCitationBridges.set(otherId, imports);
  if (importedBy >= 2) bibCouplingBridges.set(otherId, importedBy);
}

function dump(label: string, m: Map<string, number>) {
  console.log(`\n## ${label} — files connected to >=2 candidates`);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  for (const [id, n] of sorted) {
    const f = index.files.get(id)!;
    console.log(`  ${n}  ${f.relativePath}`);
  }
  if (sorted.length === 0) console.log('  (none)');
}
dump('Co-citation bridges (X imports >=2 candidates)', coCitationBridges);
dump('Bibliographic-coupling bridges (>=2 candidates import X)', bibCouplingBridges);

// Ground-truth structural reachability
if (groundTruth.length) {
  console.log('\n# GROUND TRUTH STRUCTURAL REACHABILITY');
  for (const gt of groundTruth) {
    const gtId = pathToId.get(gt);
    if (!gtId) { console.log(`  ${gt}: NOT IN INDEX`); continue; }
    const inCand = candidateIdSet.has(gtId);
    const importsAnyCand = [...outSetOf(gtId)].filter(x => candidateIdSet.has(x)).length;
    const importedByAnyCand = candidateIds.filter(cid => outSetOf(cid).has(gtId)).length;
    console.log(`  ${gt}: inCandidates=${inCand} | imports ${importsAnyCand} candidates | imported by ${importedByAnyCand} candidates`);
  }
}
