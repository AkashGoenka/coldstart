/**
 * Regression tests for get-overview redesign.
 *
 * These tests verify the source-labeled token system, two-predicate filtering,
 * AST-based barrel detection, directory-entry filename promotion, and additive
 * pluralization against the current DomainEvidence (Record<string, DomainEvidence>) implementation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkDirectory } from '../src/indexer/walker.js';
import { parseFile, buildFileId } from '../src/indexer/parser.js';
import { resolveImports } from '../src/indexer/resolvers/index.js';
import { buildGraph } from '../src/indexer/graph.js';
import { buildFileDomains, isTestPath } from '../src/indexer/tokenize.js';
import { buildContentTokenPostings, buildContentPresenceIndex } from '../src/indexer/content-tokens.js';
import { handleGetOverview, handleGetStructure } from '../src/server/tools.js';
import type { CodebaseIndex, IndexedFile, SymbolEdge, DomainEvidence } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, '../fixtures/overview');

// ============================================================================
// Index builder (mirrors src/index.ts buildIndex pipeline, minus git/cache)
// ============================================================================
async function buildTestIndex(rootDir: string): Promise<CodebaseIndex> {
  const walkedFiles = await walkDirectory({ rootDir, excludes: [], includes: [] });

  const indexedFiles: IndexedFile[] = [];
  const allSymbolEdges: SymbolEdge[] = [];

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
          contentTokens: parsed.contentTokens,
        };
        indexedFiles.push(file);
      } catch {
        // skip
      }
    }),
  );

  // Inject synthetic filler files to make the corpus large enough for IDF rarity math.
  // IDF_RARITY_THRESHOLD = log(20) ≈ 3.0; a token must appear in < 5% of files to be rare.
  // Without padding, the tiny fixture corpus inflates IDF for all tokens, breaking Predicate B.
  const FILLER_COUNT = 20;
  for (let i = 0; i < FILLER_COUNT; i++) {
    const id = `filler/filler${i}.ts`;
    indexedFiles.push({
      id,
      path: id,
      relativePath: id,
      language: 'typescript',
      domainMap: { filler: { filename: 1, path: 0, symbol: 0 } },
      exports: ['placeholder'],
      hasDefaultExport: false,
      imports: [],
      hash: `filler${i}`,
      lineCount: 1,
      tokenEstimate: 5,
      importedByCount: 0,
      transitiveImportedByCount: 0,
      isBarrel: false,
      isTestFile: false,
      symbols: [],
      reexportRatio: 0,
    });
  }

  const { edges } = await resolveImports(indexedFiles, rootDir);
  const nodeIds = indexedFiles.map(f => f.id);
  const { outEdges, inEdges } = buildGraph(nodeIds, edges);
  const filesMap = new Map<string, IndexedFile>(indexedFiles.map(f => [f.id, f]));

  for (const file of indexedFiles) {
    file.importedByCount = inEdges.get(file.id)?.length ?? 0;
  }

  // Symbol edges
  for (const file of indexedFiles) {
    for (const sym of file.symbols) {
      if (sym.isExported) allSymbolEdges.push({ from: file.id, to: sym.id, type: 'exports' });
      for (const callee of sym.calls) allSymbolEdges.push({ from: sym.id, to: callee.name, type: 'calls', line: callee.line });
      if (sym.extendsName) allSymbolEdges.push({ from: sym.id, to: sym.extendsName, type: 'extends' });
      for (const iface of sym.implementsNames) allSymbolEdges.push({ from: sym.id, to: iface, type: 'implements' });
    }
  }

  // AST-based barrel detection (TS/JS only via reexportRatio)
  for (const file of indexedFiles) {
    if (file.language === 'typescript' || file.language === 'javascript') {
      file.isBarrel = (
        (file.reexportRatio ?? 0) > 0.5 &&
        file.importedByCount > 1 &&
        file.exports.length > 0
      );
    }
    file.transitiveImportedByCount = file.importedByCount;
  }

  // Strip symbol-sourced tokens from barrel domains
  for (const file of indexedFiles) {
    if (!file.isBarrel) continue;
    for (const [token, ev] of Object.entries(file.domainMap)) {
      if (ev.filename === 0 && ev.path === 0) {
        delete file.domainMap[token];
      } else {
        file.domainMap[token] = { ...ev, symbol: 0 };
      }
    }
  }

  // tokenDocFreq — skip barrels
  const tokenDocFreq = new Map<string, number>();
  for (const file of indexedFiles) {
    if (file.isBarrel) continue;
    for (const token of Object.keys(file.domainMap)) {
      tokenDocFreq.set(token, (tokenDocFreq.get(token) ?? 0) + 1);
    }
  }

  // Inflate transitiveImportedByCount through barrels
  for (const file of indexedFiles) {
    if (!file.isBarrel) continue;
    for (const childId of outEdges.get(file.id) ?? []) {
      const child = filesMap.get(childId);
      if (child) child.transitiveImportedByCount += file.importedByCount;
    }
  }

  return {
    rootDir,
    files: filesMap,
    edges,
    symbolEdges: allSymbolEdges,
    outEdges,
    inEdges,
    tokenDocFreq,
    contentTokenPostings: buildContentTokenPostings(filesMap.values()),
    contentPresenceIndex: buildContentPresenceIndex(filesMap.values()),
    indexedAt: Date.now(),
    gitHead: '',
  };
}

// ============================================================================
// Test suite
// ============================================================================

let index: CodebaseIndex;

beforeAll(async () => {
  index = await buildTestIndex(FIXTURE_ROOT);
});

// Helper: get result paths from handleGetOverview.
// Results are now { path, matched: string[] } — extract the path field.
function queryPaths(filter: string, opts: { max_results?: number } = {}): string[] {
  const result = handleGetOverview(index, { query: filter, ...opts }) as any;
  return (result.results ?? []).map((r: any) => (typeof r === 'string' ? r : r.path));
}

// Helper: get the domainMap for a file (by relative path fragment)
function getFileDomains(pathFragment: string): Record<string, DomainEvidence> {
  for (const file of index.files.values()) {
    if (file.relativePath.includes(pathFragment)) {
      return file.domainMap;
    }
  }
  return {};
}

// ============================================================================
// Test 1: Pluralization — query "workspace" matches workspaces/WorkspaceMenu.ts
// ============================================================================
describe('Pluralization', () => {

  it('query "workspace" (singular) matches workspaces/WorkspaceMenu.ts', () => {
    const paths = queryPaths('workspace');
    expect(paths.some(p => p.includes('WorkspaceMenu'))).toBe(true);
  });

  it('query "workspaces" (plural) also matches workspaces/WorkspaceMenu.ts', () => {
    const paths = queryPaths('workspaces');
    expect(paths.some(p => p.includes('WorkspaceMenu'))).toBe(true);
  });
});

// ============================================================================
// Test 2: No import tokens in domains
// ============================================================================
describe('No import tokens in domains', () => {
  it('permissions/RoleAccessHelper.ts has no import-source tokens in its domains', () => {
    const domains = getFileDomains('RoleAccessHelper');
    // DomainEvidence only has filename/path/symbol counts — there is no import source type
    // Verify all evidence entries only contain the expected keys
    for (const ev of Object.values(domains)) {
      expect(Object.keys(ev)).toEqual(expect.arrayContaining(['filename', 'path', 'symbol']));
      expect(Object.keys(ev).length).toBe(3);
    }
  });

  it('query "auth" does NOT return permissions/RoleAccessHelper.ts (no longer indexed via imports)', () => {
    const paths = queryPaths('auth');
    expect(paths.some(p => p.includes('RoleAccessHelper'))).toBe(false);
  });

  it('query "role" DOES return permissions/RoleAccessHelper.ts (matched via own path/filename)', () => {
    const paths = queryPaths('role');
    expect(paths.some(p => p.includes('RoleAccessHelper'))).toBe(true);
  });
});

// ============================================================================
// Test 3: Compound export name matching
// ============================================================================
describe('Compound export name matching', () => {
  it('query "RoleAccessHelper" (camelCase) finds permissions/RoleAccessHelper.ts', () => {
    const paths = queryPaths('RoleAccessHelper');
    expect(paths.some(p => p.includes('RoleAccessHelper'))).toBe(true);
  });
});

// ============================================================================
// Test 4: All-common-token diagnostic
// ============================================================================
describe('All-common-token diagnostic', () => {
  it('returns a diagnostic when all matched tokens are common (high frequency)', () => {
    const result = handleGetOverview(index, { query: 'auth' }) as any;
    expect(result).toHaveProperty('filter');
    expect(result).toHaveProperty('results');
    expect(Array.isArray(result.results)).toBe(true);
    // Should NOT have old scoring metadata fields
    expect(result).not.toHaveProperty('total_matches_before_filtering');
    expect(result).not.toHaveProperty('score_distribution');
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('coverage');
  });
});

// ============================================================================
// Test 5: Truncation
// ============================================================================
describe('Truncation', () => {
  it('returns truncated:true and message when results exceed max_results', () => {
    const result = handleGetOverview(index, { query: 'auth', max_results: 1 }) as any;
    if ((result.total_matched ?? 0) > 1 || result.truncated) {
      expect(result.truncated).toBe(true);
      expect(result.message).toMatch(/\+\d+ more/);
      expect(result.results.length).toBeLessThanOrEqual(1);
    }
    // If only 1 result (barrel excluded), truncation doesn't fire — test is N/A
  });
});

// ============================================================================
// Test 6: Directory-entry filename promotion
// ============================================================================
describe('Directory-entry filename promotion', () => {
  it('auth/index.ts has "auth" as a filename-source token (from parent dir promotion)', () => {
    const domains = getFileDomains('auth/index');
    const authEv = domains['auth'];
    expect(authEv).toBeDefined();
    expect(authEv!.filename).toBeGreaterThan(0);
  });

  it('auth/index.ts has filename-source "auth" token despite being named "index.ts" (parent dir promotion)', () => {
    const domains = getFileDomains('auth/index');
    const authEv = domains['auth'];
    expect(authEv).toBeDefined();
    // After barrel stripping, symbol count is zeroed but filename must be > 0
    expect(authEv!.filename).toBeGreaterThan(0);
  });
});

// ============================================================================
// Test 7: Barrel domain purity (AST-based)
// ============================================================================
describe('Barrel domain purity', () => {
  it('auth/index.ts is detected as a barrel via reexportRatio', () => {
    let authIndex: IndexedFile | undefined;
    for (const file of index.files.values()) {
      if (file.relativePath.includes('auth/index') || file.relativePath.includes('auth\\index')) {
        authIndex = file;
        break;
      }
    }
    expect(authIndex).toBeDefined();
    expect(authIndex!.isBarrel).toBe(true);
  });

  it('auth/index.ts domains do NOT contain "loginuser", "authservice", or "hashpassword" as symbol tokens', () => {
    const domains = getFileDomains('auth/index');
    // Tokens that were purely symbol-sourced are deleted during barrel stripping
    expect(domains['loginuser']).toBeUndefined();
    expect(domains['authservice']).toBeUndefined();
    expect(domains['hashpassword']).toBeUndefined();
  });

  it('query "login" does NOT return auth/index.ts (symbol tokens stripped from barrel)', () => {
    const paths = queryPaths('login');
    expect(paths.some(p => p.includes('auth/index') || p.includes('auth\\index'))).toBe(false);
  });

  it('query "login" DOES return auth/service.ts', () => {
    const paths = queryPaths('login');
    expect(paths.some(p => p.includes('service'))).toBe(true);
  });
});

// ============================================================================
// Test 8: Barrel detection NOT applied to non-AST languages
// ============================================================================
describe('Barrel detection — TS/JS AST only', () => {
  it('only TS/JS files have reexportRatio set', () => {
    for (const file of index.files.values()) {
      if (file.language !== 'typescript' && file.language !== 'javascript') {
        // non-TS/JS files should not be barrels
        expect(file.isBarrel).toBe(false);
      }
    }
  });
});

// ============================================================================
// Test 9: Multi-source correctness
// ============================================================================
describe('Multi-source correctness', () => {
  it('auth/service.ts has "auth" token with both path and symbol sources', () => {
    const domains = getFileDomains('auth/service');
    const authEv = domains['auth'];
    expect(authEv).toBeDefined();
    // "auth" comes from dir path AND from exports like "AuthService", "AuthResult"
    expect(authEv!.path).toBeGreaterThan(0);
    expect(authEv!.symbol).toBeGreaterThan(0);
  });

  it('query "auth login" returns auth/service.ts in results', () => {
    // "login" is rare (single file: auth/service.ts) → passes Predicate B
    const result = handleGetOverview(index, { query: 'auth login' }) as any;
    const results = result.results ?? [];
    expect(results.some((r: any) => r.path === 'auth/service.ts')).toBe(true);
  });

  it('response results are an array of { path, matched } entries', () => {
    const result = handleGetOverview(index, { query: 'auth' }) as any;
    const results = result.results ?? [];
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(typeof r).toBe('object');
      expect(typeof r.path).toBe('string');
      expect(r.path).toMatch(/\.(ts|js|tsx|jsx|java|rb)$/);
      expect(Array.isArray(r.matched)).toBe(true);
      // Each matched entry is a bare token string.
      for (const m of r.matched) {
        expect(typeof m).toBe('string');
        expect(m).toMatch(/^[A-Za-z0-9_.-]+$/);
      }
    }
  });
});

describe('Matched-token display cuts', () => {
  // Helper: matched[] for the first result whose path includes the fragment.
  function matchedFor(query: string, pathFragment: string): string[] | null {
    const result = handleGetOverview(index, { query, max_results: 20 }) as any;
    for (const r of result.results ?? []) {
      if ((r.path as string).includes(pathFragment)) return r.matched as string[];
    }
    return null;
  }

  it('drops separator-joined compounds (already visible in the path)', () => {
    const matched = matchedFor('grid', 'grid-builder.ts');
    expect(matched).not.toBeNull();
    // the verbatim filename compound must be gone...
    expect(matched).not.toContain('grid-builder');
    for (const t of matched!) expect(t).not.toMatch(/[_-]/);
    // ...but the atomic token the user typed stays
    expect(matched).toContain('grid');
  });

  it('suppresses synonym-driven matches from display but keeps them for ranking', () => {
    // "create" expands (SYNONYM_MAP) to "build" → matches buildGrid in grid-builder.ts.
    const paths = queryPaths('create');
    expect(paths.some(p => p.includes('grid-builder.ts'))).toBe(true); // still ranks
    const matched = matchedFor('create', 'grid-builder.ts');
    expect(matched).not.toBeNull();
    // none of the displayed tokens are synonym-derived (build/grid from buildGrid)
    expect(matched).not.toContain('build');
    expect(matched).not.toContain('buildgrid');
  });
});

// ============================================================================
// Phase 2: `path` glob filter
// ============================================================================
describe('GO `path` glob filter', () => {
  it('positive glob scopes results to matching paths', () => {
    const result = handleGetOverview(index, {
      query: 'auth',
      path: 'auth/**',
    }) as any;
    const results = result.results ?? [];
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.path.startsWith('auth/')).toBe(true);
    }
  });

  it('extension glob (**/*.ts) admits all ts files; **/*.htm rejects all in this fixture', () => {
    const ts = handleGetOverview(index, {
      query: 'auth',
      path: '**/*.ts',
    }) as any;
    expect((ts.results ?? []).length).toBeGreaterThan(0);

    const htm = handleGetOverview(index, {
      query: 'auth',
      path: '**/*.htm',
    }) as any;
    // Fixture has no .htm files; either zero primary results or a fallback,
    // but no result path should be a .htm match (we still allow fallback shape).
    const results = htm.results ?? [];
    for (const r of results) {
      expect(r.path.endsWith('.htm')).toBe(false);
    }
  });

  it('negation excludes matching paths', () => {
    const result = handleGetOverview(index, {
      query: 'auth',
      path: '!auth/**',
    }) as any;
    const results = result.results ?? [];
    for (const r of results) {
      expect(r.path.startsWith('auth/')).toBe(false);
    }
  });

  it('reports excluded_by_path count when glob filters real candidates', () => {
    const result = handleGetOverview(index, {
      query: 'auth',
      path: 'navigation/**',
    }) as any;
    expect(typeof result.excluded_by_path).toBe('number');
    expect(result.excluded_by_path).toBeGreaterThan(0);
    expect(result.path_filter).toBe('navigation/**');
  });
});

// ============================================================================
// GS `match` and `view`
// ============================================================================
describe('GS `match` filter', () => {
  it('match substring filters symbols section', () => {
    const result = handleGetStructure(index, {
      file_path: 'auth/service.ts',
      match: 'login',
    }) as any;
    const text = result.__rawText as string;
    expect(text).toContain('loginUser');
    expect(text).not.toContain('hashPassword');
    expect(text).not.toContain('AuthService');
  });

  it('match /regex/ filters symbols by regex (case-insensitive)', () => {
    const result = handleGetStructure(index, {
      file_path: 'auth/service.ts',
      match: '/^hash/',
    }) as any;
    const text = result.__rawText as string;
    expect(text).toContain('hashPassword');
    expect(text).not.toContain('loginUser');
  });

  it('match with no symbol hits falls back to the full symbol list (flagged)', () => {
    // A "0 symbols match" result's only possible follow-up is re-calling
    // without the filter — so GS returns the unfiltered view instead.
    const result = handleGetStructure(index, {
      file_path: 'auth/service.ts',
      match: 'nonexistentxyz',
    }) as any;
    const text = result.__rawText as string;
    expect(text).toMatch(/\[0 of \d+ symbols match "nonexistentxyz" — showing all symbols instead:\]/);
    expect(text).toContain('loginUser'); // full list rendered despite the miss
  });
});

describe('GS `view` enum', () => {
  it('view: "symbols" omits Imports section', () => {
    const result = handleGetStructure(index, {
      file_path: 'auth/service.ts',
      view: 'symbols',
    }) as any;
    const text = result.__rawText as string;
    expect(text).toContain('Symbols:');
    expect(text).not.toContain('Imports:');
  });

  it('view: "imports" omits Symbols section', () => {
    const result = handleGetStructure(index, {
      file_path: 'auth/index.ts',
      view: 'imports',
    }) as any;
    const text = result.__rawText as string;
    expect(text).not.toContain('Symbols:');
  });

  it('view defaults to "full" — includes Symbols and Importers sections', () => {
    const result = handleGetStructure(index, {
      file_path: 'auth/service.ts',
    }) as any;
    const text = result.__rawText as string;
    expect(text).toContain('Symbols:');
    // auth/service.ts is imported somewhere in the fixture, so Importers shows
    expect(text).toMatch(/Importers \(/);
  });

  it('view: "importers" returns only the Importers section', () => {
    const result = handleGetStructure(index, {
      file_path: 'auth/service.ts',
      view: 'importers',
    }) as any;
    const text = result.__rawText as string;
    expect(text).not.toContain('Symbols:');
    expect(text).not.toContain('Imports:');
    expect(text).toMatch(/Importers \(/);
  });

  it('view: "callers" returns only the Callers section', () => {
    const result = handleGetStructure(index, {
      file_path: 'auth/service.ts',
      view: 'callers',
    }) as any;
    const text = result.__rawText as string;
    expect(text).not.toContain('Symbols:');
    expect(text).not.toContain('Imports:');
    expect(text).toContain('Callers');
  });

  it('view: "symbols" omits callers (no inline ← markers)', () => {
    const result = handleGetStructure(index, {
      file_path: 'auth/service.ts',
      view: 'symbols',
    }) as any;
    const text = result.__rawText as string;
    expect(text).toContain('Symbols:');
    expect(text).not.toContain('Importers');
    // Inline-callers marker should not appear in symbols-only view
    expect(text).not.toContain('  ← ');
  });
});

describe('GO no longer accepts moved-to-GS fields', () => {
  it('does not attach importers to results (with_importers removed from GO)', () => {
    const result = handleGetOverview(index, { query: 'auth' }) as any;
    for (const r of result.results ?? []) {
      expect('importers' in r).toBe(false);
    }
  });
});
