#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { runIndexer } from './indexer.js';

const banner = `
 ██████╗ ██████╗ ██╗     ██████╗     ███████╗████████╗ █████╗ ██████╗ ████████╗
██╔════╝██╔═══██╗██║     ██╔══██╗    ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
██║     ██║   ██║██║     ██║  ██║    ███████╗   ██║   ███████║██████╔╝   ██║
██║     ██║   ██║██║     ██║  ██║    ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
╚██████╗╚██████╔╝███████╗██████╔╝    ███████║   ██║   ██║  ██║██║  ██║   ██║
 ╚═════╝ ╚═════╝ ╚══════╝╚═════╝     ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝
              eliminate the AI agent cold start problem   v1.0.0-node
`;

const { values } = parseArgs({
  options: {
    root:              { type: 'string',  default: '.' },
    output:            { type: 'string',  default: 'coldstart_map.json' },
    exclude:           { type: 'string',  default: '' },
    include:           { type: 'string',  default: '' },     // comma-separated subtree paths to restrict walk to
    workers:           { type: 'string',  default: '16' },  // accepted but ignored — Node uses os.cpus()
    quiet:             { type: 'boolean', default: false },
    'with-architecture': { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const rootDir    = resolve(values.root);
const outputPath = resolve(values.output);
const quiet      = values.quiet;
const withArchitecture = values['with-architecture'];
const extraExclude = values.exclude
  ? values.exclude.split(',').map(s => s.trim()).filter(Boolean)
  : [];
const includePaths = values.include
  ? values.include.split(',').map(s => resolve(rootDir, s.trim())).filter(Boolean)
  : [];

if (!quiet) {
  process.stdout.write(banner);
}

if (!existsSync(rootDir)) {
  process.stderr.write(`❌  Root directory not found: ${rootDir}\n`);
  process.exit(1);
}

if (!quiet) {
  process.stdout.write(`📂  Scanning:  ${rootDir}\n`);
  process.stdout.write(`⚙️   Workers:   ${cpus().length} (auto)\n\n`);
  if (withArchitecture) {
    process.stdout.write(`🏗️   Architecture tracing: enabled\n\n`);
  }
}

const startTime = Date.now();

let result;
try {
  result = await runIndexer({ rootDir, extraExclude, includePaths, withArchitecture });
} catch (err) {
  process.stderr.write(`❌  Indexing failed: ${err.message}\n`);
  process.exit(1);
}

const { output, stats, graph } = result;

try {
  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
} catch (err) {
  process.stderr.write(`❌  Failed to write output file: ${err.message}\n`);
  process.exit(1);
}

const elapsed = Date.now() - startTime;
const elapsedStr = elapsed >= 1000
  ? `${(elapsed / 1000).toFixed(2)}s`
  : `${elapsed}ms`;

if (!quiet) {
  const cycles = output.cycles ?? [];
  process.stdout.write(`✅  Done in ${elapsedStr}\n\n`);
  process.stdout.write(`   Files scanned:   ${stats.FilesScanned}\n`);
  process.stdout.write(`   Files indexed:   ${stats.FilesIndexed}\n`);
  process.stdout.write(`   Files skipped:   ${stats.FilesSkipped}\n`);
  process.stdout.write(`   Edges resolved:  ${stats.EdgesResolved}\n`);
  process.stdout.write(`   Total tokens:    ~${stats.TotalTokens}\n`);
  process.stdout.write(`   Circular deps:   ${cycles.length}\n`);
  process.stdout.write(`\n📄  Map written to: ${outputPath}\n`);

  if (cycles.length > 0) {
    process.stdout.write(`\n⚠️   Circular dependencies detected:\n`);
    const shown = cycles.slice(0, 5);
    for (const cycle of shown) {
      process.stdout.write(`     ${cycle.join(' → ')}\n`);
    }
    if (cycles.length > 5) {
      process.stdout.write(`     ... and ${cycles.length - 5} more\n`);
    }
  }

  const hotNodes = output.hot_nodes ?? [];
  if (hotNodes.length > 0) {
    process.stdout.write(`\n🔥  Hot nodes (imported by 5+ files):\n`);
    const shown = hotNodes.slice(0, 5);
    for (const hn of shown) {
      process.stdout.write(`     ${hn.id} (${hn.dependents} dependents)\n`);
    }
    if (hotNodes.length > 5) {
      process.stdout.write(`     ... and ${hotNodes.length - 5} more (see coldstart_map.json)\n`);
    }
  }

  if (withArchitecture) {
    const layers = output.architecture_layers ?? {};
    const layerEntries = [
      ['routers',      '🔀'],
      ['middleware',   '🔗'],
      ['services',     '⚙️ '],
      ['repositories', '🗄️ '],
    ].filter(([key]) => (layers[key] ?? []).length > 0);

    if (layerEntries.length > 0) {
      process.stdout.write(`\n🏗️   Architecture layers:\n`);
      for (const [key, icon] of layerEntries) {
        process.stdout.write(`   ${icon}  ${key}: ${layers[key].length} files\n`);
      }
    }

    const paths = output.critical_paths ?? [];
    if (paths.length > 0) {
      process.stdout.write(`\n📍  Critical paths (${paths.length} entry point${paths.length > 1 ? 's' : ''}):\n`);
      for (const p of paths.slice(0, 3)) {
        process.stdout.write(`     ${p.entry}\n`);
        if (p.routers?.length)      process.stdout.write(`       → routers:      ${p.routers.slice(0, 3).join(', ')}\n`);
        if (p.middleware?.length)   process.stdout.write(`       → middleware:   ${p.middleware.slice(0, 3).join(', ')}\n`);
        if (p.services?.length)     process.stdout.write(`       → services:     ${p.services.slice(0, 3).join(', ')}\n`);
        if (p.repositories?.length) process.stdout.write(`       → repos:        ${p.repositories.slice(0, 3).join(', ')}\n`);
      }
    }
  }
}
