import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkDirectory } from '../src/indexer/walker.js';
import { parseFile, buildFileId } from '../src/indexer/parser.js';
import { resolveImports } from '../src/indexer/resolvers/index.js';
import { buildGraph } from '../src/indexer/graph.js';
import { addCSharpSyntheticEdges } from '../src/indexer/csharp-synthetic.js';
import { buildFileDomains, isTestPath } from '../src/indexer/tokenize.js';
import type { CodebaseIndex, IndexedFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildCSharpTestIndex(rootDir: string): Promise<CodebaseIndex> {
  const walkedFiles = await walkDirectory({ rootDir, excludes: [], includes: [] });
  const indexedFiles: IndexedFile[] = [];

  await Promise.all(
    walkedFiles.map(async (wf) => {
      try {
        const id = buildFileId(wf.relativePath);
        const parsed = await parseFile(wf.absolutePath, wf.language, id);
        if (!parsed) return;

        const file: IndexedFile = {
          id,
          path: wf.absolutePath,
          relativePath: wf.relativePath,
          language: wf.language,
          domainMap: buildFileDomains(wf.relativePath, parsed.exports),
          exports: parsed.exports,
          hasDefaultExport: parsed.hasDefaultExport,
          imports: parsed.imports,
          hash: parsed.hash,
          lineCount: parsed.lineCount,
          tokenEstimate: parsed.tokenEstimate,
          importedByCount: 0,
          transitiveImportedByCount: 0,
          isBarrel: false,
          isTestFile: isTestPath(wf.relativePath),
          symbols: parsed.symbols,
          reexportRatio: parsed.reexportRatio,
          partialDeclarations: parsed.partialDeclarations,
        };
        indexedFiles.push(file);
      } catch {
        // skip
      }
    }),
  );

  const { edges } = await resolveImports(indexedFiles, rootDir);
  const fullFileIdSet = new Set(indexedFiles.map(f => f.id));
  await addCSharpSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  const nodeIds = indexedFiles.map(f => f.id);
  const { outEdges, inEdges } = buildGraph(nodeIds, edges);

  for (const file of indexedFiles) {
    file.importedByCount = inEdges.get(file.id)?.length ?? 0;
  }

  const filesMap = new Map<string, IndexedFile>(indexedFiles.map(f => [f.id, f]));
  return {
    rootDir,
    files: filesMap,
    edges,
    outEdges,
    inEdges,
    tokenDocFreq: new Map(),
    indexedAt: Date.now(),
    gitHead: '',
  };
}

describe('C# partials synthetic edges', () => {
  let index: CodebaseIndex;
  const FIXTURE_ROOT = join(__dirname, 'fixtures/csharp-partials');

  beforeAll(async () => {
    index = await buildCSharpTestIndex(FIXTURE_ROOT);
    // Debug: log the partial declarations
    for (const [id, file] of index.files) {
      if (file.partialDeclarations) {
        console.log(`${id}: ${JSON.stringify(file.partialDeclarations)}`);
      }
    }
    console.log('Total edges:', index.edges.length);
    console.log('Partial edges:', index.edges.filter(e => e.specifier.startsWith('partial:')).length);
  });

  it('UserService.cs and UserService.Extensions.cs should have bidirectional partial edges', () => {
    const userServiceId = 'UserService.cs';
    const userServiceExtId = 'UserService.Extensions.cs';

    // Find edges between these files
    const edgesFromMain = index.edges.filter(
      e => e.from === userServiceId && e.to === userServiceExtId && e.specifier.startsWith('partial:'),
    );
    const edgesFromExt = index.edges.filter(
      e => e.from === userServiceExtId && e.to === userServiceId && e.specifier.startsWith('partial:'),
    );

    expect(edgesFromMain.length).toBeGreaterThan(0);
    expect(edgesFromExt.length).toBeGreaterThan(0);
    expect(edgesFromMain[0].specifier).toBe('partial:UserService');
    expect(edgesFromExt[0].specifier).toBe('partial:UserService');
  });

  it('ConfigHelper should have bidirectional edges between Config.cs and Config.Extensions.cs', () => {
    const configId = 'Config.cs';
    const configExtId = 'Config.Extensions.cs';

    const edgesFromMain = index.edges.filter(
      e => e.from === configId && e.to === configExtId && e.specifier === 'partial:ConfigHelper',
    );
    const edgesFromExt = index.edges.filter(
      e => e.from === configExtId && e.to === configId && e.specifier === 'partial:ConfigHelper',
    );

    expect(edgesFromMain.length).toBeGreaterThan(0);
    expect(edgesFromExt.length).toBeGreaterThan(0);
  });

  it('Point struct should have bidirectional edges between Struct.cs and Struct.Extensions.cs', () => {
    const structId = 'Struct.cs';
    const structExtId = 'Struct.Extensions.cs';

    const edgesFromMain = index.edges.filter(
      e => e.from === structId && e.to === structExtId && e.specifier === 'partial:Point',
    );
    const edgesFromExt = index.edges.filter(
      e => e.from === structExtId && e.to === structId && e.specifier === 'partial:Point',
    );

    expect(edgesFromMain.length).toBeGreaterThan(0);
    expect(edgesFromExt.length).toBeGreaterThan(0);
  });

  it('AppConfig (non-partial) should NOT have partial edges', () => {
    const configId = 'Config.cs';
    const appConfigEdges = index.edges.filter(
      e => (e.from === configId || e.to === configId) && e.specifier === 'partial:AppConfig',
    );
    expect(appConfigEdges.length).toBe(0);
  });
});
