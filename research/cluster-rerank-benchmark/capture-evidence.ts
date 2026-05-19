#!/usr/bin/env node
/**
 * Dump complete graph evidence per query as JSON.
 * Re-runs of analysis never need to re-index.
 *
 * Usage (from this directory):
 *   npx tsx capture-evidence.ts <repoRoot> <outDir> "<q1>" ["<q2>" ...]
 *
 * Or from coldstart repo root:
 *   npx tsx research/cluster-rerank-benchmark/capture-evidence.ts \
 *     /path/to/target-repo \
 *     research/cluster-rerank-benchmark/evidence/<repo-name> \
 *     "<query1>" "<query2>"
 *
 * Output: one JSON file per query under <outDir>.
 * Schema: see README.md ("Evidence JSON schema").
 */
import { buildIndex } from '../../src/index.js';
import { handleGetOverview } from '../../src/server/tools.js';
import type { CodebaseIndex } from '../../src/types.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const [, , repoArg, outDirArg, ...queries] = process.argv;
if (!repoArg || !outDirArg || queries.length === 0) {
  console.error('Usage: npx tsx capture-evidence.ts <repoRoot> <outDir> "<q1>" ...');
  process.exit(1);
}
const repoRoot = resolve(repoArg);
const outDir = resolve(outDirArg);
mkdirSync(outDir, { recursive: true });

const scriptDir = dirname(fileURLToPath(import.meta.url));
const coldstartCommit = execSync('git rev-parse HEAD', { cwd: scriptDir }).toString().trim();

console.error(`Indexing ${repoRoot} ...`);
const t0 = Date.now();
const index: CodebaseIndex = await buildIndex(repoRoot, [], [], true);
const indexMs = Date.now() - t0;
console.error(`Indexed ${index.files.size} files in ${(indexMs/1000).toFixed(1)}s`);

const pathToId = new Map<string, string>();
const idToPath = new Map<string, string>();
for (const [id, f] of index.files) { pathToId.set(f.relativePath, id); idToPath.set(id, f.relativePath); }

const outSetOf = (id: string): string[] => index.outEdges.get(id) ?? [];
const inSetOf  = (id: string): string[] => index.inEdges.get(id)  ?? [];

for (let qi = 0; qi < queries.length; qi++) {
  const q = queries[qi];
  const result = handleGetOverview(index, { domain_filter: q, max_results: 20 }) as any;
  const candidates: any[] = result.results ?? result.matches ?? [];
  const candidatePaths: string[] = candidates.map((c: any) =>
    typeof c === 'string' ? c : (c.path ?? c.file ?? c.relativePath),
  );
  const candidateIds = candidatePaths.map(p => pathToId.get(p) ?? null);
  const candidateIdSet = new Set(candidateIds.filter((x): x is string => !!x));

  const candidateDump = candidatePaths.map((p, i) => {
    const id = candidateIds[i];
    if (!id) return { rank: i+1, path: p, fileId: null, missing: true };
    const f = index.files.get(id)!;
    return {
      rank: i+1,
      path: p,
      fileId: id,
      isTestFile: f.isTestFile,
      inEdges:  inSetOf(id),
      outEdges: outSetOf(id),
      inEdgesCount:  inSetOf(id).length,
      outEdgesCount: outSetOf(id).length,
    };
  });

  // pairwise: for every (i,j) i<j, list actual shared importers/importees
  const pairwise: Record<string, { sharedImporters: string[]; sharedImportees: string[] }> = {};
  for (let i = 0; i < candidateIds.length; i++) {
    for (let j = i+1; j < candidateIds.length; j++) {
      const a = candidateIds[i]; const b = candidateIds[j];
      if (!a || !b) continue;
      const aIn = new Set(inSetOf(a)); const aOut = new Set(outSetOf(a));
      const sharedImp: string[]  = [];
      const sharedImpe: string[] = [];
      for (const x of inSetOf(b))  if (aIn.has(x))  sharedImp.push(x);
      for (const x of outSetOf(b)) if (aOut.has(x)) sharedImpe.push(x);
      if (sharedImp.length || sharedImpe.length) {
        pairwise[`${i+1}-${j+1}`] = { sharedImporters: sharedImp, sharedImportees: sharedImpe };
      }
    }
  }

  // bridges: for every non-candidate file, count its relationship to candidates
  const bridgeRaw: Record<string, {
    path: string;
    importsHowManyCandidates: number;
    importedByHowManyCandidates: number;
    whichCandidatesItImports: number[];
    whichCandidatesImportIt: number[];
  }> = {};
  for (const [otherId] of index.files) {
    if (candidateIdSet.has(otherId)) continue;
    const out = new Set(outSetOf(otherId));
    const whichItImports: number[] = [];
    const whichImportIt:  number[] = [];
    candidateIds.forEach((cid, ci) => {
      if (!cid) return;
      if (out.has(cid)) whichItImports.push(ci+1);
      if ((outSetOf(cid) || []).includes(otherId)) whichImportIt.push(ci+1);
    });
    if (whichItImports.length > 0 || whichImportIt.length > 0) {
      bridgeRaw[otherId] = {
        path: idToPath.get(otherId)!,
        importsHowManyCandidates:    whichItImports.length,
        importedByHowManyCandidates: whichImportIt.length,
        whichCandidatesItImports: whichItImports,
        whichCandidatesImportIt:  whichImportIt,
      };
    }
  }

  // tokenDocFreq snapshot — useful for any future IDF experiments without re-indexing
  const tokenDocFreqSnap: Record<string, number> = {};
  for (const id of candidateIds) {
    if (!id) continue;
    const f = index.files.get(id)!;
    for (const tok of Object.keys(f.domainMap)) {
      if (!(tok in tokenDocFreqSnap)) {
        tokenDocFreqSnap[tok] = index.tokenDocFreq.get(tok) ?? 0;
      }
    }
  }

  const dump = {
    schemaVersion: 1,
    query: q,
    repo: repoRoot,
    coldstartCommit,
    fileCount: index.files.size,
    indexedAt: new Date().toISOString(),
    goMeta: {
      fallback: !!result.fallback,
      truncated: !!result.truncated,
      excluded_test_files: result.excluded_test_files ?? 0,
      note: result.note ?? null,
    },
    K: candidatePaths.length,
    candidates: candidateDump,
    pairwise,
    bridgeRaw,
    tokenDocFreqSnap,
  };

  const slug = q.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 60);
  writeFileSync(`${outDir}/q${qi+1}_${slug}.json`, JSON.stringify(dump, null, 2));
  const bridgeCount = Object.keys(bridgeRaw).length;
  const pairwiseCount = Object.keys(pairwise).length;
  console.error(`  q${qi+1} "${q}" → K=${candidatePaths.length}, ${pairwiseCount} pairs w/ overlap, ${bridgeCount} bridge files`);
}
console.error('Done.');
