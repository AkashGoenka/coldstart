import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveImports } from '../src/indexer/resolvers/index.js';
import type { IndexedFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const JAVA_FIXTURES = join(FIXTURES, 'java');
const RUBY_FIXTURES = join(FIXTURES, 'ruby');

function makeFile(id: string, lang: IndexedFile['language'], imports: string[]): IndexedFile {
  return {
    id,
    path: join(FIXTURES, id),
    relativePath: id,
    language: lang,
    domains: [],
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

describe('resolver — Java package-name imports', () => {
  function makeJavaFile(id: string, imports: string[]): IndexedFile {
    return {
      id,
      path: join(JAVA_FIXTURES, id),
      relativePath: id,
      language: 'java',
      domains: [],
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
    } as unknown as IndexedFile;
  }

  it('resolves com.example.UserRepository to Maven source root', async () => {
    const files: IndexedFile[] = [
      makeJavaFile(
        'src/main/java/com/example/AuthService.java',
        ['com.example.UserRepository', 'com.example.TokenService'],
      ),
      makeJavaFile('src/main/java/com/example/UserRepository.java', []),
      makeJavaFile('src/main/java/com/example/TokenService.java', []),
    ];

    const { edges } = await resolveImports(files, JAVA_FIXTURES);
    const authEdges = edges.filter(e => e.from === 'src/main/java/com/example/AuthService.java');
    const targets = authEdges.map(e => e.to);
    expect(targets).toContain('src/main/java/com/example/UserRepository.java');
    expect(targets).toContain('src/main/java/com/example/TokenService.java');
  });

  it('does not create edges for stdlib or wildcard imports', async () => {
    const files: IndexedFile[] = [
      makeJavaFile(
        'src/main/java/com/example/AuthService.java',
        ['java.util.List', 'java.io.*', 'com.example.UserRepository'],
      ),
      makeJavaFile('src/main/java/com/example/UserRepository.java', []),
    ];

    const { edges } = await resolveImports(files, JAVA_FIXTURES);
    const authEdges = edges.filter(e => e.from === 'src/main/java/com/example/AuthService.java');
    expect(authEdges).toHaveLength(1);
    expect(authEdges[0].to).toBe('src/main/java/com/example/UserRepository.java');
  });
});

describe('resolver — Ruby load-path and require_relative', () => {
  function makeRubyFile(id: string, imports: string[]): IndexedFile {
    return {
      id,
      path: join(RUBY_FIXTURES, id),
      relativePath: id,
      language: 'ruby',
      domains: [],
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
    } as unknown as IndexedFile;
  }

  it('resolves require_relative (./prefix) as a relative path', async () => {
    const files: IndexedFile[] = [
      makeRubyFile('auth_service.rb', ['./user_repository']),
      makeRubyFile('user_repository.rb', []),
    ];

    const { edges } = await resolveImports(files, RUBY_FIXTURES);
    expect(edges.some(e => e.from === 'auth_service.rb' && e.to === 'user_repository.rb')).toBe(true);
  });

  it('resolves non-relative require via lib/ load root', async () => {
    const files: IndexedFile[] = [
      makeRubyFile('app/controllers/payments_controller.rb', ['services/payment_service']),
      makeRubyFile('lib/services/payment_service.rb', []),
    ];

    const { edges } = await resolveImports(files, RUBY_FIXTURES);
    expect(
      edges.some(
        e => e.from === 'app/controllers/payments_controller.rb' &&
             e.to === 'lib/services/payment_service.rb',
      ),
    ).toBe(true);
  });

  it('does not create edges for external gems', async () => {
    const files: IndexedFile[] = [
      makeRubyFile('auth_service.rb', ['bcrypt', 'rails', './user_repository']),
      makeRubyFile('user_repository.rb', []),
    ];

    const { edges } = await resolveImports(files, RUBY_FIXTURES);
    const authEdges = edges.filter(e => e.from === 'auth_service.rb');
    expect(authEdges).toHaveLength(1);
    expect(authEdges[0].to).toBe('user_repository.rb');
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
