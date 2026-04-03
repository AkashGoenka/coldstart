import { describe, it, expect } from 'vitest';
import { findFiles } from '../src/search/ranker.js';
import { buildTFIDFIndex } from '../src/search/tfidf.js';
import type { CodebaseIndex, IndexedFile } from '../src/types.js';
import { buildGraph, computePageRank } from '../src/indexer/graph.js';

function makeFile(id: string, opts: Partial<IndexedFile> = {}): IndexedFile {
  return {
    id,
    path: `/repo/${id}`,
    relativePath: id,
    language: 'typescript',
    domain: 'unknown',
    exports: [],
    hasDefaultExport: false,
    imports: [],
    hash: 'abc',
    lineCount: 50,
    tokenEstimate: 500,
    isEntryPoint: false,
    archRole: 'unknown',
    centrality: 0,
    depth: 0,
    ...opts,
  };
}

function buildTestIndex(files: IndexedFile[]): CodebaseIndex {
  const { vectors: tfidf, idf } = buildTFIDFIndex(files);
  const nodeIds = files.map(f => f.id);
  const { outEdges, inEdges } = buildGraph(nodeIds, []);
  const pagerank = computePageRank(nodeIds, outEdges);

  return {
    rootDir: '/repo',
    files: new Map(files.map(f => [f.id, f])),
    edges: [],
    outEdges,
    inEdges,
    pagerank,
    cochange: new Map(),
    tfidf,
    idf,
    indexedAt: Date.now(),
    gitHead: '',
  };
}

describe('ranker — find-files', () => {
  const files = [
    makeFile('src/auth/service.ts', {
      domain: 'auth',
      exports: ['AuthService', 'login', 'logout'],
      language: 'typescript',
    }),
    makeFile('src/auth/middleware.ts', {
      domain: 'auth',
      exports: ['authMiddleware'],
      language: 'typescript',
      archRole: 'middleware',
    }),
    makeFile('src/payments/stripe.ts', {
      domain: 'payments',
      exports: ['StripeClient', 'createCharge'],
      language: 'typescript',
    }),
    makeFile('src/db/userRepository.ts', {
      domain: 'db',
      exports: ['UserRepository', 'findUser'],
      language: 'typescript',
      archRole: 'repository',
    }),
    makeFile('src/utils/hash.ts', {
      domain: 'utils',
      exports: ['hashPassword', 'compareHash'],
      language: 'typescript',
    }),
    makeFile('src/auth/service.test.ts', {
      domain: 'test',
      exports: [],
      language: 'typescript',
    }),
  ];

  const index = buildTestIndex(files);

  it('returns results for "auth service"', () => {
    const results = findFiles('auth service', index, { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const paths = results.map(r => r.relativePath);
    expect(paths.some(p => p.includes('auth'))).toBe(true);
  });

  it('auth service ranks higher than payments', () => {
    const results = findFiles('auth service', index, { limit: 5 });
    const authIdx = results.findIndex(r => r.relativePath.includes('auth/service'));
    const paymentsIdx = results.findIndex(r => r.relativePath.includes('payments'));
    expect(authIdx).toBeGreaterThanOrEqual(0);
    if (paymentsIdx >= 0) {
      expect(authIdx).toBeLessThan(paymentsIdx);
    }
  });

  it('test file is penalized relative to implementation', () => {
    const results = findFiles('auth service', index, { limit: 10, preferSource: true });
    const implIdx = results.findIndex(r => r.relativePath === 'src/auth/service.ts');
    const testIdx = results.findIndex(r => r.relativePath === 'src/auth/service.test.ts');
    if (implIdx >= 0 && testIdx >= 0) {
      expect(implIdx).toBeLessThan(testIdx);
    }
  });

  it('respects domain filter', () => {
    const results = findFiles('service', index, { domain: 'payments', limit: 5 });
    for (const r of results) {
      expect(r.domain).toBe('payments');
    }
  });

  it('returns empty array for empty token query', () => {
    const results = findFiles('the a an', index, { limit: 5 });
    // All tokens are stop words → tokenize → empty → no results
    expect(results).toHaveLength(0);
  });

  it('respects limit', () => {
    const results = findFiles('auth', index, { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('"stripe payment" returns stripe file as top result', () => {
    const results = findFiles('stripe payment', index, { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].relativePath).toContain('stripe');
  });

  it('each result includes reasons array', () => {
    const results = findFiles('user repository', index, { limit: 3 });
    for (const r of results) {
      expect(Array.isArray(r.reasons)).toBe(true);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe('ranker — scoring weights', () => {
  it('exact path match scores highest', () => {
    const files = [
      makeFile('src/auth/authService.ts', { exports: [], domain: 'auth' }),
      makeFile('src/other/someFile.ts', { exports: ['authService'], domain: 'other' }),
    ];
    const idx = buildTestIndex(files);
    const results = findFiles('authService', idx, { limit: 5 });
    expect(results[0].relativePath).toContain('authService.ts');
  });
});
