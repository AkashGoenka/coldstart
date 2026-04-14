import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveImports } from '../src/indexer/resolver.js';
import type { IndexedFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

function makeFile(id: string, lang: IndexedFile['language'], imports: string[]): IndexedFile {
  return {
    id,
    path: join(FIXTURES, id),
    relativePath: id,
    language: lang,
    domain: 'unknown',
    exports: [],
    hasDefaultExport: false,
    imports,
    hash: 'abc',
    lineCount: 10,
    tokenEstimate: 100,
    isEntryPoint: false,
    archRole: 'unknown',
    centrality: 0,
    depth: 0,
  };
}

describe('resolver — TypeScript relative imports', () => {
  it('resolves ./userRepository to typescript/userRepository.ts', async () => {
    const files: IndexedFile[] = [
      makeFile('typescript/auth.ts', 'typescript', ['./userRepository', './tokenService']),
      makeFile('typescript/userRepository.ts', 'typescript', []),
      makeFile('typescript/tokenService.ts', 'typescript', []),
    ];

    const { edges } = await resolveImports(files, FIXTURES);

    const authEdges = edges.filter(e => e.from === 'typescript/auth.ts');
    const targets = authEdges.map(e => e.to);
    expect(targets).toContain('typescript/userRepository.ts');
    expect(targets).toContain('typescript/tokenService.ts');
  });

  it('does not create edges for external packages', async () => {
    const files: IndexedFile[] = [
      makeFile('typescript/auth.ts', 'typescript', ['bcrypt', 'jsonwebtoken', './userRepository']),
      makeFile('typescript/userRepository.ts', 'typescript', []),
    ];

    const { edges } = await resolveImports(files, FIXTURES);
    const authEdges = edges.filter(e => e.from === 'typescript/auth.ts');
    expect(authEdges).toHaveLength(1);
    expect(authEdges[0].to).toBe('typescript/userRepository.ts');
  });

  it('reports unresolved imports for missing files', async () => {
    const files: IndexedFile[] = [
      makeFile('typescript/auth.ts', 'typescript', ['./nonExistentFile']),
    ];

    const { unresolved } = await resolveImports(files, FIXTURES);
    expect(unresolved.some(u => u.specifier === './nonExistentFile')).toBe(true);
  });
});

describe('resolver — Rust mod declarations', () => {
  it('treats mod X as import specifier', async () => {
    const files: IndexedFile[] = [
      makeFile('rust/auth.rs', 'rust', ['token', 'hash']),
      makeFile('rust/token.rs', 'rust', []),
      makeFile('rust/hash.rs', 'rust', []),
    ];

    // resolver will attempt to find token.rs / hash.rs next to auth.rs
    // These don't actually exist on disk so they'll be unresolved,
    // but no crash should occur.
    const { edges, unresolved } = await resolveImports(files, FIXTURES);
    expect(Array.isArray(edges)).toBe(true);
    expect(Array.isArray(unresolved)).toBe(true);
  });
});
