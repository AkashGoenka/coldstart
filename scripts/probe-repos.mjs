#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Usage: node scripts/probe-repos.mjs <repo-path> [<repo-path> ...]
// Output: scripts/probe-output/<basename>.json per repo + scripts/probe-output/summary.txt

const repos = process.argv.slice(2);
if (repos.length === 0) {
  console.error('usage: probe-repos.mjs <repo-path> [<repo-path> ...]');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'probe-output');
mkdirSync(outDir, { recursive: true });
const cli = resolve(here, '..', 'dist', 'index.js');
if (!existsSync(cli)) {
  console.error(`dist/index.js missing — run npm run build first`);
  process.exit(1);
}

const summary = [];
for (const repo of repos) {
  const abs = resolve(repo);
  const name = basename(abs);
  process.stderr.write(`[probe] ${name} ... `);
  const t0 = Date.now();
  const res = spawnSync('node', [cli, '--probe', '--root', abs], {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status !== 0) {
    process.stderr.write(`FAILED (${elapsed}s)\n${res.stderr}\n`);
    summary.push(`${name}: FAILED`);
    continue;
  }
  const outPath = resolve(outDir, `${name}.json`);
  writeFileSync(outPath, res.stdout);
  let parsed;
  try { parsed = JSON.parse(res.stdout); } catch { parsed = null; }
  if (parsed) {
    const lines = [`${name} (${elapsed}s, ${parsed.totalFiles} files)`];
    for (const [lang, b] of Object.entries(parsed.languages)) {
      lines.push(`  ${lang}: ${b.resolved}/${b.totalImports} (${(b.resolvedRatio * 100).toFixed(1)}%)`);
    }
    summary.push(lines.join('\n'));
    process.stderr.write(`done (${elapsed}s)\n`);
  } else {
    summary.push(`${name}: malformed JSON`);
    process.stderr.write(`malformed JSON (${elapsed}s)\n`);
  }
}

const summaryPath = resolve(outDir, 'summary.txt');
writeFileSync(summaryPath, summary.join('\n\n') + '\n');
process.stderr.write(`\nSummary written to ${summaryPath}\n`);
process.stderr.write(`\n${summary.join('\n\n')}\n`);
