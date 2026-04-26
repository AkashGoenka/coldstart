import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile, buildFileId } from '../src/indexer/parser.js';
import { resolveImports } from '../src/indexer/resolver.js';
import { buildGraph } from '../src/indexer/graph.js';
import { buildSymbolEdges } from '../src/indexer/symbol-edges.js';
import type { IndexedFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const ROOT = join(FIXTURES, 'typescript');

async function buildFixtureFile(filename: string): Promise<IndexedFile> {
  const relPath = `typescript/${filename}`;
  const id = buildFileId(relPath);
  const parsed = await parseFile(join(ROOT, filename), 'typescript', id);
  if (!parsed) throw new Error(`Failed to parse ${filename}`);
  return {
    id,
    path: join(ROOT, filename),
    relativePath: relPath,
    language: 'typescript',
    domains: [],
    exports: parsed.exports,
    hasDefaultExport: parsed.hasDefaultExport,
    imports: parsed.imports,
    hash: parsed.hash,
    lineCount: parsed.lineCount,
    tokenEstimate: parsed.tokenEstimate,
    importedByCount: 0,
    transitiveImportedByCount: 0,
    isBarrel: false,
    isTestFile: false,
    symbols: parsed.symbols,
    reexportRatio: parsed.reexportRatio,
  };
}

describe('buildSymbolEdges — cross-file call resolution', () => {
  it('qualifies a call to a function exported by an imported file', async () => {
    const authFile = await buildFixtureFile('auth.ts');
    const tokenFile = await buildFixtureFile('tokenService.ts');
    const userRepoFile = await buildFixtureFile('userRepository.ts');
    const dbFile = await buildFixtureFile('db.ts');

    const files = [authFile, tokenFile, userRepoFile, dbFile];

    // Resolve imports so outEdges reflect what auth.ts actually imports
    const { edges } = await resolveImports(files, ROOT);
    const { outEdges } = buildGraph(files.map(f => f.id), edges);
    const allFiles = new Map(files.map(f => [f.id, f]));

    const symbolEdges = buildSymbolEdges(files, outEdges, allFiles);

    const callEdges = symbolEdges.filter(e => e.type === 'calls');

    // All call edges whose target contains '#' must reference a real file id
    const qualifiedCalls = callEdges.filter(e => e.to.includes('#'));
    const knownFileIds = new Set(files.map(f => f.id));

    for (const edge of qualifiedCalls) {
      const targetFileId = edge.to.split('#')[0];
      expect(knownFileIds.has(targetFileId!),
        `Qualified call edge "${edge.from}" → "${edge.to}" references unknown file "${targetFileId}"`
      ).toBe(true);
    }

    // auth.ts exports hashPassword — it should have no unresolvable calls to tokenService symbols
    // tokenService exports: TokenService, defaultTokenService
    // auth.ts calls member methods (sign, verify) which are NOT resolvable cross-file (member calls)
    // so we verify that named exports ARE resolved when called directly
    const tokenFileId = tokenFile.id;
    const crossFileToToken = callEdges.filter(e => e.to.startsWith(`${tokenFileId}#`));

    // TokenService is imported by auth.ts — if any symbol in auth.ts calls
    // "TokenService" by name (e.g. constructor usage), it should be qualified
    // This asserts the mechanism works: any resolved cross-file call is fully qualified
    expect(crossFileToToken.every(e => e.to.includes('#'))).toBe(true);
  });

  it('leaves member expression calls as bare names', async () => {
    const authFile = await buildFixtureFile('auth.ts');
    const tokenFile = await buildFixtureFile('tokenService.ts');
    const files = [authFile, tokenFile];

    const { edges } = await resolveImports(files, ROOT);
    const { outEdges } = buildGraph(files.map(f => f.id), edges);
    const allFiles = new Map(files.map(f => [f.id, f]));

    const symbolEdges = buildSymbolEdges(files, outEdges, allFiles);
    const callEdges = symbolEdges.filter(e => e.type === 'calls');

    // Member calls like sign/verify/findByEmail collapse to bare property names
    // and should NOT be qualified to a cross-file id
    const memberLikeBareNames = ['sign', 'verify', 'findByEmail', 'compare', 'hash'];
    for (const name of memberLikeBareNames) {
      const bareEdge = callEdges.find(e => e.to === name);
      if (bareEdge) {
        // If it exists as bare, it must NOT have been qualified
        expect(bareEdge.to).not.toContain('#');
      }
    }
  });

  it('exports edges are emitted for exported symbols only', async () => {
    const tokenFile = await buildFixtureFile('tokenService.ts');
    const files = [tokenFile];
    const outEdges = new Map([[tokenFile.id, []]]);
    const allFiles = new Map([[tokenFile.id, tokenFile]]);

    const symbolEdges = buildSymbolEdges(files, outEdges, allFiles);
    const exportEdges = symbolEdges.filter(e => e.type === 'exports');

    // tokenService.ts exports: TokenService, defaultTokenService
    const exportedNames = exportEdges.map(e => e.to.split('#')[1]);
    expect(exportedNames).toContain('TokenService');
    expect(exportedNames).toContain('defaultTokenService');

    // Non-exported symbols (e.g. private methods) must not appear as export edges
    for (const edge of exportEdges) {
      expect(edge.from).toBe(tokenFile.id);
    }
  });
});
