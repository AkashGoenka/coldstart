import { describe, it, expect } from 'vitest';
import { handleTraceImpact } from '../src/server/tools.js';
import type { CodebaseIndex, IndexedFile, SymbolEdge, SymbolNode } from '../src/types.js';

// ============================================================================
// Helpers to build minimal CodebaseIndex fixtures
// ============================================================================

function makeSymbol(
  fileId: string,
  name: string,
  kind: SymbolNode['kind'] = 'function',
  calls: string[] = [],
  extendsName?: string,
  implementsNames: string[] = [],
): SymbolNode {
  return {
    id: `${fileId}#${name}`,
    name,
    kind,
    startLine: 1,
    endLine: 10,
    isExported: true,
    calls,
    extendsName,
    implementsNames,
  };
}

function makeFile(id: string, symbols: SymbolNode[]): IndexedFile {
  return {
    id,
    path: `/root/${id}`,
    relativePath: id,
    language: 'typescript',
    domain: 'app',
    exports: symbols.map(s => s.name),
    hasDefaultExport: false,
    imports: [],
    hash: 'abc123',
    lineCount: 20,
    tokenEstimate: 50,
    isEntryPoint: false,
    archRole: 'service',
    importedByCount: 0,
    depth: 1,
    symbols,
  };
}

function makeIndex(files: IndexedFile[], symbolEdges: SymbolEdge[]): CodebaseIndex {
  const filesMap = new Map<string, IndexedFile>(files.map(f => [f.id, f]));

  // Minimal file-level edges — trace-impact uses symbolEdges, but the map needs to exist
  const outEdges = new Map<string, string[]>(files.map(f => [f.id, []]));
  const inEdges = new Map<string, string[]>(files.map(f => [f.id, []]));

  return {
    rootDir: '/root',
    files: filesMap,
    edges: [],
    symbolEdges,
    outEdges,
    inEdges,
    indexedAt: Date.now(),
    gitHead: 'abc123',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('trace-impact — basic single-hop', () => {
  /**
   * Graph: validate ← login (login calls validate)
   * Changing validate should impact login (depth 1).
   */
  it('finds one direct caller', () => {
    const validate = makeSymbol('src/auth.ts', 'validate');
    const login = makeSymbol('src/auth.ts', 'login', 'function', ['src/auth.ts#validate']);

    const files = [makeFile('src/auth.ts', [validate, login])];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/auth.ts#login', to: 'src/auth.ts#validate', type: 'calls' },
    ];

    const index = makeIndex(files, symbolEdges);
    const result = handleTraceImpact(index, { symbol: 'validate' }) as {
      target: { symbol: string; file: string; type: string };
      impacted: Array<{ symbol: string; depth: number; relationship: string; path: string[] }>;
      summary: { totalImpacted: number; byDepth: Record<number, number>; byRelationship: Record<string, number>; affectedFiles: string[] };
    };

    expect(result.target.symbol).toBe('validate');
    expect(result.target.file).toBe('src/auth.ts');
    expect(result.impacted).toHaveLength(1);
    expect(result.impacted[0].symbol).toBe('login');
    expect(result.impacted[0].depth).toBe(1);
    expect(result.impacted[0].relationship).toBe('calls');
    expect(result.summary.totalImpacted).toBe(1);
    expect(result.summary.byDepth).toEqual({ 1: 1 });
    expect(result.summary.byRelationship).toEqual({ calls: 1 });
    expect(result.summary.affectedFiles).toContain('src/auth.ts');
  });
});

describe('trace-impact — multi-hop chain', () => {
  /**
   * Graph: validate ← login ← handleRequest
   * Changing validate should impact login (depth 1) and handleRequest (depth 2).
   */
  it('traces a two-hop dependency chain', () => {
    const validate = makeSymbol('src/auth.ts', 'validate');
    const login = makeSymbol('src/auth.ts', 'login');
    const handleRequest = makeSymbol('src/controller.ts', 'handleRequest');

    const files = [
      makeFile('src/auth.ts', [validate, login]),
      makeFile('src/controller.ts', [handleRequest]),
    ];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/auth.ts#login', to: 'src/auth.ts#validate', type: 'calls' },
      { from: 'src/controller.ts#handleRequest', to: 'src/auth.ts#login', type: 'calls' },
    ];

    const index = makeIndex(files, symbolEdges);
    const result = handleTraceImpact(index, { symbol: 'validate', depth: 5 }) as any;

    expect(result.target.symbol).toBe('validate');
    expect(result.summary.totalImpacted).toBe(2);

    const loginEntry = result.impacted.find((i: any) => i.symbol === 'login');
    const handleEntry = result.impacted.find((i: any) => i.symbol === 'handleRequest');

    expect(loginEntry.depth).toBe(1);
    expect(handleEntry.depth).toBe(2);
    expect(handleEntry.path).toContain('validate');
    expect(handleEntry.path).toContain('login');
    expect(handleEntry.path).toContain('handleRequest');
  });

  it('includes symbols from different files in affectedFiles', () => {
    const validate = makeSymbol('src/auth.ts', 'validate');
    const login = makeSymbol('src/auth.ts', 'login');
    const handleRequest = makeSymbol('src/controller.ts', 'handleRequest');

    const files = [
      makeFile('src/auth.ts', [validate, login]),
      makeFile('src/controller.ts', [handleRequest]),
    ];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/auth.ts#login', to: 'src/auth.ts#validate', type: 'calls' },
      { from: 'src/controller.ts#handleRequest', to: 'src/auth.ts#login', type: 'calls' },
    ];

    const index = makeIndex(files, symbolEdges);
    const result = handleTraceImpact(index, { symbol: 'validate', depth: 5 }) as any;

    expect(result.summary.affectedFiles).toContain('src/auth.ts');
    expect(result.summary.affectedFiles).toContain('src/controller.ts');
  });
});

describe('trace-impact — circular dependency', () => {
  /**
   * Graph: A ↔ B (mutual calls)
   * Should not infinite-loop; both should appear in impact if traversal reaches them.
   */
  it('handles circular call chains without looping', () => {
    const fnA = makeSymbol('src/a.ts', 'fnA');
    const fnB = makeSymbol('src/b.ts', 'fnB');

    const files = [makeFile('src/a.ts', [fnA]), makeFile('src/b.ts', [fnB])];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/a.ts#fnA', to: 'src/b.ts#fnB', type: 'calls' },
      { from: 'src/b.ts#fnB', to: 'src/a.ts#fnA', type: 'calls' },
    ];

    const index = makeIndex(files, symbolEdges);
    // Should complete without error and not repeat entries
    const result = handleTraceImpact(index, { symbol: 'fnA', depth: 10 }) as any;

    const symbols = result.impacted.map((i: any) => i.symbol);
    // No duplicates
    expect(symbols.length).toBe(new Set(symbols).size);
    // fnB is impacted (directly calls fnA)
    expect(symbols).toContain('fnB');
  });
});

describe('trace-impact — depth limiting', () => {
  /**
   * Chain: target ← d1 ← d2 ← d3
   * With depth=1, only d1 should be returned.
   * With depth=2, d1 and d2 should be returned.
   */
  it('respects depth=1', () => {
    const target = makeSymbol('src/x.ts', 'target');
    const d1 = makeSymbol('src/x.ts', 'd1');
    const d2 = makeSymbol('src/x.ts', 'd2');
    const d3 = makeSymbol('src/x.ts', 'd3');

    const files = [makeFile('src/x.ts', [target, d1, d2, d3])];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/x.ts#d1', to: 'src/x.ts#target', type: 'calls' },
      { from: 'src/x.ts#d2', to: 'src/x.ts#d1', type: 'calls' },
      { from: 'src/x.ts#d3', to: 'src/x.ts#d2', type: 'calls' },
    ];

    const index = makeIndex(files, symbolEdges);

    const r1 = handleTraceImpact(index, { symbol: 'target', depth: 1 }) as any;
    expect(r1.impacted.map((i: any) => i.symbol)).toEqual(['d1']);

    const r2 = handleTraceImpact(index, { symbol: 'target', depth: 2 }) as any;
    const names2 = r2.impacted.map((i: any) => i.symbol);
    expect(names2).toContain('d1');
    expect(names2).toContain('d2');
    expect(names2).not.toContain('d3');
  });

  it('clamps depth at 10', () => {
    // Build a chain of 12 symbols; requesting depth=100 should still cap at 10
    const symbols: SymbolNode[] = [];
    const edges: SymbolEdge[] = [];
    for (let i = 0; i <= 12; i++) {
      symbols.push(makeSymbol('src/chain.ts', `sym${i}`));
      if (i > 0) {
        edges.push({ from: `src/chain.ts#sym${i}`, to: `src/chain.ts#sym${i - 1}`, type: 'calls' });
      }
    }

    const index = makeIndex([makeFile('src/chain.ts', symbols)], edges);
    const result = handleTraceImpact(index, { symbol: 'sym0', depth: 100 }) as any;

    const maxDepth = Math.max(...result.impacted.map((i: any) => i.depth));
    expect(maxDepth).toBeLessThanOrEqual(10);
  });
});

describe('trace-impact — disambiguation', () => {
  /**
   * Two files define `validate`. Without a file hint, should return an ambiguous error.
   * With a file hint, should return only the match in that file.
   */
  it('returns disambiguation candidates when symbol is ambiguous', () => {
    const validateA = makeSymbol('src/auth.ts', 'validate');
    const validateB = makeSymbol('src/payments.ts', 'validate');

    const files = [
      makeFile('src/auth.ts', [validateA]),
      makeFile('src/payments.ts', [validateB]),
    ];

    const index = makeIndex(files, []);
    const result = handleTraceImpact(index, { symbol: 'validate' }) as any;

    expect(result.error).toMatch(/ambiguous/i);
    expect(result.candidates).toHaveLength(2);
    const files_ = result.candidates.map((c: any) => c.file);
    expect(files_).toContain('src/auth.ts');
    expect(files_).toContain('src/payments.ts');
  });

  it('resolves correctly when file is provided', () => {
    const validateA = makeSymbol('src/auth.ts', 'validate');
    const validateB = makeSymbol('src/payments.ts', 'validate');
    const caller = makeSymbol('src/controller.ts', 'handleAuth');

    const files = [
      makeFile('src/auth.ts', [validateA]),
      makeFile('src/payments.ts', [validateB]),
      makeFile('src/controller.ts', [caller]),
    ];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/controller.ts#handleAuth', to: 'src/auth.ts#validate', type: 'calls' },
    ];

    const index = makeIndex(files, symbolEdges);
    const result = handleTraceImpact(index, { symbol: 'validate', file: 'src/auth.ts' }) as any;

    expect(result.target).toBeDefined();
    expect(result.target.file).toBe('src/auth.ts');
    expect(result.impacted.map((i: any) => i.symbol)).toContain('handleAuth');
  });
});

describe('trace-impact — symbol not found', () => {
  it('returns error and fuzzy suggestions', () => {
    const validate = makeSymbol('src/auth.ts', 'validateToken');
    const files = [makeFile('src/auth.ts', [validate])];
    const index = makeIndex(files, []);

    const result = handleTraceImpact(index, { symbol: 'vldToken' }) as any;

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/not found/i);
  });

  it('returns fuzzy suggestions when query is close', () => {
    const validate = makeSymbol('src/auth.ts', 'validateToken');
    const files = [makeFile('src/auth.ts', [validate])];
    const index = makeIndex(files, []);

    const result = handleTraceImpact(index, { symbol: 'validate' }) as any;
    // Symbol doesn't exist as 'validate' but 'validateToken' should appear in suggestions
    expect(result.suggestions).toBeDefined();
    const suggestionNames = result.suggestions.map((s: any) => s.symbol);
    expect(suggestionNames).toContain('validateToken');
  });
});

describe('trace-impact — exports edges not followed', () => {
  /**
   * File exports symbol. The file→symbol 'exports' edge should NOT count as an impact.
   * Only callers should appear in impacted.
   */
  it('does not include the exporting file as an impacted symbol', () => {
    const fn = makeSymbol('src/util.ts', 'formatDate');
    const caller = makeSymbol('src/view.ts', 'renderDate');

    const files = [
      makeFile('src/util.ts', [fn]),
      makeFile('src/view.ts', [caller]),
    ];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/util.ts', to: 'src/util.ts#formatDate', type: 'exports' }, // Should be ignored
      { from: 'src/view.ts#renderDate', to: 'src/util.ts#formatDate', type: 'calls' },
    ];

    const index = makeIndex(files, symbolEdges);
    const result = handleTraceImpact(index, { symbol: 'formatDate' }) as any;

    // Only renderDate should be impacted, not the 'exports' edge source
    const impactedSymbols = result.impacted.map((i: any) => i.symbol);
    expect(impactedSymbols).toContain('renderDate');
    expect(impactedSymbols).not.toContain('src/util.ts'); // file-level id is not a symbol
  });
});

describe('trace-impact — truncation', () => {
  /**
   * Build a star graph: 55 callers all call a single target.
   * The result should be truncated at 50 with a note.
   */
  it('truncates impact set at 50 and adds truncation note', () => {
    const target = makeSymbol('src/core.ts', 'coreFunc');
    const callers: SymbolNode[] = [];
    const edges: SymbolEdge[] = [];

    for (let i = 1; i <= 55; i++) {
      const name = `caller${i}`;
      callers.push(makeSymbol('src/consumers.ts', name));
      edges.push({ from: `src/consumers.ts#${name}`, to: 'src/core.ts#coreFunc', type: 'calls' });
    }

    const files = [
      makeFile('src/core.ts', [target]),
      makeFile('src/consumers.ts', callers),
    ];

    const index = makeIndex(files, edges);
    const result = handleTraceImpact(index, { symbol: 'coreFunc' }) as any;

    expect(result.summary.totalImpacted).toBe(55);
    expect(result.impacted).toHaveLength(50);
    expect(result.summary.truncatedAt).toBe(50);
    expect(result.summary.note).toMatch(/truncated/i);
  });
});

describe('trace-impact — extends and implements edges', () => {
  it('follows extends edges in reverse', () => {
    const BaseClass = makeSymbol('src/base.ts', 'BaseClass', 'class');
    const ChildClass = makeSymbol('src/child.ts', 'ChildClass', 'class', [], 'src/base.ts#BaseClass');

    const files = [
      makeFile('src/base.ts', [BaseClass]),
      makeFile('src/child.ts', [ChildClass]),
    ];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/child.ts#ChildClass', to: 'src/base.ts#BaseClass', type: 'extends' },
    ];

    const index = makeIndex(files, symbolEdges);
    const result = handleTraceImpact(index, { symbol: 'BaseClass' }) as any;

    expect(result.impacted.map((i: any) => i.symbol)).toContain('ChildClass');
    expect(result.impacted[0].relationship).toBe('extends');
  });

  it('follows implements edges in reverse', () => {
    const ILogger = makeSymbol('src/interfaces.ts', 'ILogger', 'interface');
    const ConsoleLogger = makeSymbol('src/logger.ts', 'ConsoleLogger', 'class');

    const files = [
      makeFile('src/interfaces.ts', [ILogger]),
      makeFile('src/logger.ts', [ConsoleLogger]),
    ];
    const symbolEdges: SymbolEdge[] = [
      { from: 'src/logger.ts#ConsoleLogger', to: 'src/interfaces.ts#ILogger', type: 'implements' },
    ];

    const index = makeIndex(files, symbolEdges);
    const result = handleTraceImpact(index, { symbol: 'ILogger' }) as any;

    expect(result.impacted.map((i: any) => i.symbol)).toContain('ConsoleLogger');
    expect(result.impacted[0].relationship).toBe('implements');
  });
});
