#!/usr/bin/env node
// Dump the resolved ruby edges (imports + Rails synthetic) for a repo, so a
// native-vs-wasm diff pinpoints which edges differ. Usage:
//   COLDSTART_WASM=1 node diff-ruby-edges.mjs <repo> > /tmp/wasm.txt
//   node diff-ruby-edges.mjs <repo> > /tmp/native.txt ; diff them
import { resolve } from 'node:path';
import { walkDirectory } from '../../dist/indexer/walker.js';
import { parseFile, buildFileId } from '../../dist/indexer/parser.js';
import { baseIndexedFile } from '../../dist/indexer/indexed-file.js';
import { resolveImportsForFiles, buildPackageIndex } from '../../dist/indexer/resolvers/index.js';
import { addRailsSyntheticEdges } from '../../dist/indexer/rails-synthetic.js';

const rootDir = resolve(process.argv[2]);
const walked = await walkDirectory({ rootDir, excludes: [], includes: [] });
const indexedFiles = [];
for (let i = 0; i < walked.length; i += 100) {
  const batch = walked.slice(i, i + 100);
  await Promise.all(batch.map(async (wf) => {
    try {
      const id = buildFileId(wf.relativePath);
      const parsed = await parseFile(wf.absolutePath, wf.language, id);
      if (!parsed) return;
      indexedFiles.push({
        ...baseIndexedFile(id, wf.absolutePath, wf.relativePath, wf.language, parsed),
        domainMap: {}, importedByCount: 0, transitiveImportedByCount: 0, isBarrel: false, isTestFile: false,
      });
    } catch { /* skip */ }
  }));
}
const fullFileIdSet = new Set(indexedFiles.map(f => f.id));
const pkgById = buildPackageIndex(indexedFiles);
const rubyFiles = indexedFiles.filter(f => f.language === 'ruby');
const { edges } = await resolveImportsForFiles(rubyFiles, fullFileIdSet, rootDir, pkgById);
await addRailsSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
const lines = edges.map(e => `${e.from}|${e.to}|${e.specifier ?? ''}`).sort();
for (const l of lines) console.log(l);
process.stderr.write(`ruby edges: ${edges.length}\n`);
