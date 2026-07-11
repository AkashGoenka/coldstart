#!/usr/bin/env node
// Compare coldstart's --probe in native vs WASM mode per repo.
// Asserts per-language resolution is identical and reports parse-time speedup.
//   node scripts/wasm-probe-compare.mjs <repo> [<repo> ...]
// Native = COLDSTART_WASM unset; WASM = COLDSTART_WASM=1 (same child, same code).
import { spawnSync } from 'node:child_process';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, '..', 'dist', 'index.js');
if (!existsSync(CLI)) { console.error('dist/index.js missing — run `npm run build` first'); process.exit(1); }

const REPOS = process.argv.slice(2).map(r => resolve(r));
if (!REPOS.length) { console.error('usage: wasm-probe-compare.mjs <repo> [<repo> ...]'); process.exit(1); }

function probe(repo, wasm) {
  const env = { ...process.env };
  if (wasm) env.COLDSTART_WASM = '1'; else delete env.COLDSTART_WASM;
  const t0 = Date.now();
  const res = spawnSync('node', [CLI, '--probe', '--root', repo], { encoding: 'utf-8', maxBuffer: 200 * 1024 * 1024, env });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status !== 0) return { error: (res.stderr || '').split('\n').slice(-6).join('\n'), wall };
  try { return { json: JSON.parse(res.stdout), wall }; } catch { return { error: 'bad JSON: ' + res.stdout.slice(0, 200), wall }; }
}

const rows = [];
for (const repo of REPOS) {
  const name = basename(repo);
  process.stderr.write(`[${name}] native... `);
  const n = probe(repo, false);
  process.stderr.write(`wasm... `);
  const w = probe(repo, true);
  if (n.error || w.error) { rows.push({ name, bad: n.error || w.error }); process.stderr.write(`ERR\n`); continue; }
  const langs = new Set([...Object.keys(n.json.languages || {}), ...Object.keys(w.json.languages || {})]);
  const diffs = [];
  for (const l of langs) {
    const a = n.json.languages[l] || {}, b = w.json.languages[l] || {};
    if (a.resolved !== b.resolved || a.totalImports !== b.totalImports || a.unresolved !== b.unresolved)
      diffs.push(`${l}: native ${a.resolved}/${a.totalImports}(u${a.unresolved}) vs wasm ${b.resolved}/${b.totalImports}(u${b.unresolved})`);
  }
  const edgesMatch = n.json.totalEdges === w.json.totalEdges && n.json.totalUnresolved === w.json.totalUnresolved;
  rows.push({
    name, files: n.json.totalFiles, nEdges: n.json.totalEdges, wEdges: w.json.totalEdges,
    nUnres: n.json.totalUnresolved, wUnres: w.json.totalUnresolved,
    nParse: n.json.phaseMs?.parse, wParse: w.json.phaseMs?.parse,
    equiv: edgesMatch && diffs.length === 0, diffs,
  });
  process.stderr.write((edgesMatch && diffs.length === 0) ? `OK\n` : `MISMATCH\n`);
}

console.log('\n=== EQUIVALENCE + PARSE TIMING (native vs wasm) ===\n');
console.log('repo'.padEnd(16) + 'files'.padStart(7) + 'edges(n=w)'.padStart(14) + '  parse native→wasm'.padEnd(24) + 'equiv');
for (const r of rows) {
  if (r.bad) { console.log(r.name.padEnd(16) + '  FAILED: ' + r.bad.slice(0, 60)); continue; }
  const edges = `${r.nEdges}${r.nEdges === r.wEdges ? '=' : '≠' + r.wEdges}`;
  const speed = r.nParse && r.wParse ? `${r.nParse}ms→${r.wParse}ms (${(r.nParse / r.wParse).toFixed(2)}x)` : 'n/a';
  console.log(r.name.padEnd(16) + String(r.files).padStart(7) + edges.padStart(14) + '  ' + speed.padEnd(22) + (r.equiv ? 'IDENTICAL ✓' : 'DIFF ✗'));
  if (!r.equiv) for (const d of r.diffs) console.log('    ' + d);
}
const ok = rows.filter(r => r.equiv).length, tot = rows.filter(r => !r.bad).length;
console.log(`\n${ok}/${tot} repos: identical resolution native vs wasm`);
const sp = rows.filter(r => r.nParse && r.wParse).map(r => r.nParse / r.wParse);
if (sp.length) console.log(`parse speedup (native/wasm): min ${Math.min(...sp).toFixed(2)}x max ${Math.max(...sp).toFixed(2)}x  (>1 = wasm faster)`);
