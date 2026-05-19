#!/usr/bin/env node
/**
 * Analyze evidence dumps against labels. Pure transformation — no re-indexing.
 *
 * Run from this directory:
 *   node analyze.mjs
 *
 * Reads:  ./labels.json, ./evidence/<repo>/q*.json
 * Writes: stdout (markdown summary). Pipe to a file if you want to save it.
 *
 * Add a new metric: copy a block in the per-query loop, give it a numerator
 * and denominator with a plain-language meaning, add a column to the summary
 * table. No re-indexing needed.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const labelsPath = join(here, 'labels.json');
const evidenceDir = join(here, 'evidence');
if (!existsSync(labelsPath)) { console.error(`Missing ${labelsPath}`); process.exit(1); }
if (!existsSync(evidenceDir)) { console.error(`Missing ${evidenceDir}`); process.exit(1); }

const labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
const repos = readdirSync(evidenceDir).filter(d => !d.startsWith('.'));

function pctOrNull(n, d) { return d === 0 ? null : (100 * n / d); }

const report = [];

for (const repo of repos) {
  const dir = join(evidenceDir, repo);
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  for (const fname of files) {
    const dump = JSON.parse(readFileSync(join(dir, fname), 'utf8'));
    const qkey = fname.split('_')[0]; // q1, q2, ...
    const lbl = labels[repo]?.[qkey];
    if (!lbl) { console.warn(`No labels for ${repo}/${qkey}`); continue; }

    const K = dump.K;
    const candPaths = dump.candidates.map(c => c.path);
    const candPathSet = new Set(candPaths);

    // ---- Cohesion density ----
    // numerator: pairs in top-K that share at least one importer (or importee)
    // denominator: K choose 2 = K * (K-1) / 2
    // plain meaning: pick two random top-K files — chance the codebase mentions both together
    const possiblePairs = K * (K - 1) / 2;
    const pairsWithImporterOverlap = Object.values(dump.pairwise).filter(p => p.sharedImporters.length > 0).length;
    const pairsWithImporteeOverlap = Object.values(dump.pairwise).filter(p => p.sharedImportees.length > 0).length;
    const pairsWithAnyOverlap     = Object.keys(dump.pairwise).length;
    const cohesionDensityImporters = pairsWithImporterOverlap / possiblePairs;
    const cohesionDensityImportees = pairsWithImporteeOverlap / possiblePairs;
    const cohesionDensityAny       = pairsWithAnyOverlap     / possiblePairs;

    // ---- Bridge counts ----
    const bridges = Object.values(dump.bridgeRaw);
    const callerBridges = bridges.filter(b => b.importsHowManyCandidates    >= 2);
    const depBridges    = bridges.filter(b => b.importedByHowManyCandidates >= 2);
    const callerMax = callerBridges.length ? Math.max(...callerBridges.map(b => b.importsHowManyCandidates))    : 0;
    const depMax    = depBridges.length    ? Math.max(...depBridges.map(b => b.importedByHowManyCandidates))    : 0;

    // ---- Top-K shape ----
    // numerator: sum of inEdges across top-K  /  denominator: K
    // plain meaning: average importers per candidate. Near zero = leaf-heavy top-K (migrations/scripts).
    const inEdgeCounts = dump.candidates.map(c => c.inEdgesCount ?? 0);
    const meanIn = inEdgeCounts.reduce((a,b)=>a+b,0)/K;
    const candidatesWithZeroIn = inEdgeCounts.filter(x => x === 0).length;

    // ---- Recall against labels ----
    const t1 = lbl.tier1 ?? []; const t2 = lbl.tier2 ?? []; const t3 = lbl.tier3 ?? [];
    function hitsInTopN(setPaths, N) {
      const top = new Set(candPaths.slice(0, N));
      const hits = [...setPaths].filter(p => top.has(p));
      return { n: hits.length, total: setPaths.length, hits };
    }
    const goT1_7  = hitsInTopN(t1, 7);
    const goT1_20 = hitsInTopN(t1, 20);
    const goT2_20 = hitsInTopN(t2, 20);
    const goT3_20 = hitsInTopN(t3, 20);

    // ---- "Indexed" check via bridge dump presence (approximate) ----
    const bridgePathSet = new Set(bridges.map(b => b.path));
    const labelKnown = (p) => candPathSet.has(p) || bridgePathSet.has(p);
    const t1NotSeenInDump = t1.filter(p => !labelKnown(p));

    // ---- GO + bridges recall ----
    function bridgeUnionRecall(t, minCount) {
      const reach = new Set(candPaths);
      for (const b of bridges) {
        if (b.importsHowManyCandidates >= minCount || b.importedByHowManyCandidates >= minCount) {
          reach.add(b.path);
        }
      }
      const hits = [...t].filter(p => reach.has(p));
      return { n: hits.length, total: t.length, reachSize: reach.size, hits };
    }
    const t1Bridges2 = bridgeUnionRecall(t1, 2);

    const t1MissedByGo20 = t1.filter(p => !candPathSet.has(p));
    const t1RecoveredByBridges2 = t1MissedByGo20.filter(p =>
      bridges.some(b => b.path === p && (b.importsHowManyCandidates >= 2 || b.importedByHowManyCandidates >= 2)));
    const t1IndexedButLost = t1MissedByGo20.filter(p => labelKnown(p) && !t1RecoveredByBridges2.includes(p));

    report.push({
      repo, qkey, query: dump.query,
      fileCount: dump.fileCount,
      labelSizes: { t1: t1.length, t2: t2.length, t3: t3.length },
      t1NotSeenInDump,
      goRecall: {
        'T1@7':  { hits: goT1_7.n,  of: goT1_7.total,  pct: pctOrNull(goT1_7.n,  goT1_7.total) },
        'T1@20': { hits: goT1_20.n, of: goT1_20.total, pct: pctOrNull(goT1_20.n, goT1_20.total) },
        'T2@20': { hits: goT2_20.n, of: goT2_20.total, pct: pctOrNull(goT2_20.n, goT2_20.total) },
        'T3@20': { hits: goT3_20.n, of: goT3_20.total, pct: pctOrNull(goT3_20.n, goT3_20.total) },
      },
      bridgeRecall: {
        'T1 w/ bridges(>=2)': { hits: t1Bridges2.n, of: t1Bridges2.total, pct: pctOrNull(t1Bridges2.n, t1Bridges2.total) },
      },
      tier1MissedByGo20: t1MissedByGo20,
      tier1RecoveredByBridges: t1RecoveredByBridges2,
      tier1IndexedButLost: t1IndexedButLost,
      cohesionDensity: {
        importers: +cohesionDensityImporters.toFixed(3),
        importees: +cohesionDensityImportees.toFixed(3),
        anyOverlap: +cohesionDensityAny.toFixed(3),
      },
      topKShape: { meanIn: +meanIn.toFixed(1), candidatesWithZeroIn },
      bridges: {
        callerBridgeCount: callerBridges.length, callerMax,
        depBridgeCount: depBridges.length, depMax,
      },
    });
  }
}

console.log('# Coldstart cluster-rerank — benchmark results\n');

console.log('## Summary\n');
console.log('| Query | Density(imp) | Density(any) | mean inEdges | GO T1@7 | GO T1@20 | T1+bridges≥2 | Recovered by bridges |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of report) {
  const t1_7  = `${r.goRecall['T1@7'].hits}/${r.goRecall['T1@7'].of}`;
  const t1_20 = `${r.goRecall['T1@20'].hits}/${r.goRecall['T1@20'].of}`;
  const t1_br = `${r.bridgeRecall['T1 w/ bridges(>=2)'].hits}/${r.bridgeRecall['T1 w/ bridges(>=2)'].of}`;
  const rec   = r.tier1RecoveredByBridges.length > 0 ? r.tier1RecoveredByBridges.join('; ') : '—';
  console.log(`| **${r.repo}/${r.qkey}** ${r.query} | ${r.cohesionDensity.importers} | ${r.cohesionDensity.anyOverlap} | ${r.topKShape.meanIn} | ${t1_7} | ${t1_20} | ${t1_br} | ${rec} |`);
}

console.log('\n## Per-query detail\n');
for (const r of report) {
  console.log(`### ${r.repo}/${r.qkey} — "${r.query}"`);
  console.log(`- fileCount: ${r.fileCount}`);
  console.log(`- Labels: T1=${r.labelSizes.t1}, T2=${r.labelSizes.t2}, T3=${r.labelSizes.t3}` + (r.t1NotSeenInDump.length ? `; T1 not seen in dump: ${r.t1NotSeenInDump.join(', ')}` : ''));
  console.log(`- GO recall: T1@7=${r.goRecall['T1@7'].hits}/${r.goRecall['T1@7'].of}, T1@20=${r.goRecall['T1@20'].hits}/${r.goRecall['T1@20'].of}, T2@20=${r.goRecall['T2@20'].hits}/${r.goRecall['T2@20'].of}, T3@20=${r.goRecall['T3@20'].hits}/${r.goRecall['T3@20'].of}`);
  console.log(`- T1 missed by GO@20: ${r.tier1MissedByGo20.length ? r.tier1MissedByGo20.join(', ') : '—'}`);
  console.log(`- T1 recovered by bridges(>=2): ${r.tier1RecoveredByBridges.length ? r.tier1RecoveredByBridges.join(', ') : '—'}`);
  if (r.tier1IndexedButLost.length) console.log(`- T1 indexed but unreachable: ${r.tier1IndexedButLost.join(', ')}`);
  console.log(`- Cohesion density: importers=${r.cohesionDensity.importers}, importees=${r.cohesionDensity.importees}, any=${r.cohesionDensity.anyOverlap}`);
  console.log(`- Top-K shape: mean inEdges=${r.topKShape.meanIn}, candidates w/ inEdges=0: ${r.topKShape.candidatesWithZeroIn}/20`);
  console.log(`- Bridges: caller≥2 = ${r.bridges.callerBridgeCount} files (max ${r.bridges.callerMax}); dep≥2 = ${r.bridges.depBridgeCount} files (max ${r.bridges.depMax})`);
  console.log();
}

console.log('## Cohesion-density vs GO T1@7 correlation\n');
console.log('| Query | Density(importers) | GO T1@7 recall |');
console.log('|---|---|---|');
for (const r of report) {
  console.log(`| ${r.repo}/${r.qkey} | ${r.cohesionDensity.importers} | ${r.goRecall['T1@7'].pct?.toFixed(0)}% |`);
}
