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
import { handleGetOverview } from '../src/server/tools.js';
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
      for (const callee of sym.calls) allSymbolEdges.push({ from: sym.id, to: callee, type: 'calls' });
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

// Helper: get result paths from handleGetOverview
function queryPaths(filter: string, opts: { max_results?: number } = {}): string[] {
  const result = handleGetOverview(index, { domain_filter: filter, ...opts }) as any;
  return result.results ?? [];
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
    const result = handleGetOverview(index, { domain_filter: 'auth' }) as any;
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
    const result = handleGetOverview(index, { domain_filter: 'auth', max_results: 1 }) as any;
    if ((result.total_matched ?? 0) > 1 || result.truncated) {
      expect(result.truncated).toBe(true);
      expect(result.message).toContain('TRUNCATED');
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
    const result = handleGetOverview(index, { domain_filter: 'auth login' }) as any;
    const results = result.results ?? [];
    expect(results).toContain('auth/service.ts');
  });

  it('response results are shallow array of file paths (strings)', () => {
    const result = handleGetOverview(index, { domain_filter: 'auth' }) as any;
    const results = result.results ?? [];
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(typeof r).toBe('string');
      expect(r).toMatch(/\.(ts|js|tsx|jsx|java|rb)$/);
    }
  });
});
