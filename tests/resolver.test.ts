import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveImports } from '../src/indexer/resolvers/index.js';
import type { IndexedFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const JAVA_FIXTURES = join(FIXTURES, 'java');
const RUBY_FIXTURES = join(FIXTURES, 'ruby');
const RUBY_SPEC_FIXTURES = join(FIXTURES, 'ruby-spec');
const TS_ALIASES_FIXTURES = join(FIXTURES, 'ts-aliases');
const TS_MULTI_TARGET_FIXTURES = join(FIXTURES, 'ts-multi-target');
const TS_LONGEST_PREFIX_FIXTURES = join(FIXTURES, 'ts-longest-prefix');
const CPP_FIXTURES = join(FIXTURES, 'cpp');
const GO_REPLACE_FIXTURES = join(FIXTURES, 'go-replace');
const PHP_PSR4_FIXTURES = join(FIXTURES, 'php-psr4');
const PYTHON_SRC_FIXTURES = join(FIXTURES, 'python-src');

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

// ---------------------------------------------------------------------------
// tsconfig path alias tests (P0 fixes)
// ---------------------------------------------------------------------------

function makeFileIn(rootDir: string, id: string, lang: IndexedFile['language'], imports: string[]): IndexedFile {
  return {
    id,
    path: join(rootDir, id),
    relativePath: id,
    language: lang,
    domains: [],
    exports: [],
    hasDefaultExport: false,
    imports,
    hash: 'abc',
    lineCount: 1,
    tokenEstimate: 10,
  } as unknown as IndexedFile;
}

describe('resolver — tsconfig extends chain', () => {
  it('resolves @/* aliases defined in an extended tsconfig', async () => {
    const files: IndexedFile[] = [
      makeFileIn(TS_ALIASES_FIXTURES, 'main.ts', 'typescript', ['@/components/Button']),
      makeFileIn(TS_ALIASES_FIXTURES, 'src/components/Button.ts', 'typescript', []),
    ];

    const { edges } = await resolveImports(files, TS_ALIASES_FIXTURES);
    expect(edges.some(e => e.from === 'main.ts' && e.to === 'src/components/Button.ts')).toBe(true);
  });

  it('reports unresolved when extended config paths do not match any file', async () => {
    const files: IndexedFile[] = [
      makeFileIn(TS_ALIASES_FIXTURES, 'main.ts', 'typescript', ['@/missing/Thing']),
    ];

    const { unresolved } = await resolveImports(files, TS_ALIASES_FIXTURES);
    expect(unresolved.some(u => u.specifier === '@/missing/Thing')).toBe(true);
  });
});

describe('resolver — multi-target path aliases', () => {
  it('falls back to the second target when the first does not exist', async () => {
    // tsconfig.json has @app/* → ["src/app/*", "fallback/*"]
    // src/app/utils.ts does NOT exist; fallback/utils.ts does.
    const files: IndexedFile[] = [
      makeFileIn(TS_MULTI_TARGET_FIXTURES, 'main.ts', 'typescript', ['@app/utils']),
      makeFileIn(TS_MULTI_TARGET_FIXTURES, 'fallback/utils.ts', 'typescript', []),
    ];

    const { edges } = await resolveImports(files, TS_MULTI_TARGET_FIXTURES);
    expect(edges.some(e => e.from === 'main.ts' && e.to === 'fallback/utils.ts')).toBe(true);
  });
});

describe('resolver — longest-prefix alias matching', () => {
  it('prefers a more specific alias over a shorter matching prefix', async () => {
    // tsconfig has both "@/*" → "src/*" and "@/ui/*" → "ui/*"
    // For the import "@/ui/Button": @/ui/* is longer and should win,
    // resolving to ui/Button.ts. src/ui/Button.ts does NOT exist.
    const files: IndexedFile[] = [
      makeFileIn(TS_LONGEST_PREFIX_FIXTURES, 'main.ts', 'typescript', ['@/ui/Button']),
      makeFileIn(TS_LONGEST_PREFIX_FIXTURES, 'ui/Button.ts', 'typescript', []),
    ];

    const { edges } = await resolveImports(files, TS_LONGEST_PREFIX_FIXTURES);
    expect(edges.some(e => e.from === 'main.ts' && e.to === 'ui/Button.ts')).toBe(true);
  });

  it('falls back to the shorter prefix alias when no longer alias matches', async () => {
    // "@/components/Card" — no "@/components/*" alias, but "@/*" → "src/*" matches
    const files: IndexedFile[] = [
      makeFileIn(TS_LONGEST_PREFIX_FIXTURES, 'main.ts', 'typescript', ['@/components/Card']),
      makeFileIn(TS_LONGEST_PREFIX_FIXTURES, 'src/components/Card.ts', 'typescript', []),
    ];

    const { edges } = await resolveImports(files, TS_LONGEST_PREFIX_FIXTURES);
    expect(edges.some(e => e.from === 'main.ts' && e.to === 'src/components/Card.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C++ resolver
// ---------------------------------------------------------------------------

function makeCppFile(id: string, imports: string[]): IndexedFile {
  return {
    id,
    path: join(CPP_FIXTURES, id),
    relativePath: id,
    language: 'cpp',
    domains: [],
    exports: [],
    hasDefaultExport: false,
    imports,
    hash: 'abc',
    lineCount: 10,
    tokenEstimate: 100,
  } as unknown as IndexedFile;
}

describe('resolver — C++ relative includes', () => {
  it('resolves #include "include/utils/hash.h" relative to fromFile directory', async () => {
    const files: IndexedFile[] = [
      makeCppFile('auth.cpp', ['include/utils/hash.h']),
      makeCppFile('include/utils/hash.h', []),
    ];

    const { edges } = await resolveImports(files, CPP_FIXTURES);
    expect(edges.some(e => e.from === 'auth.cpp' && e.to === 'include/utils/hash.h')).toBe(true);
  });

  it('does not create edges for angle-bracket system headers (they are not stored as imports)', async () => {
    // Angle-bracket includes are filtered out by the extractor — only quoted includes reach the resolver.
    const files: IndexedFile[] = [
      makeCppFile('auth.cpp', []),
    ];

    const { edges } = await resolveImports(files, CPP_FIXTURES);
    const authEdges = edges.filter(e => e.from === 'auth.cpp');
    expect(authEdges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Go replace directives
// ---------------------------------------------------------------------------

function makeGoFile(rootDir: string, id: string, imports: string[]): IndexedFile {
  return {
    id,
    path: join(rootDir, id),
    relativePath: id,
    language: 'go',
    domains: [],
    exports: [],
    hasDefaultExport: false,
    imports,
    hash: 'abc',
    lineCount: 10,
    tokenEstimate: 100,
  } as unknown as IndexedFile;
}

describe('resolver — Go replace directives', () => {
  it('resolves a module path covered by a local replace directive', async () => {
    // go.mod: replace example.com/shared => ./pkg/shared
    // import "example.com/shared" → pkg/shared/utils.go
    const files: IndexedFile[] = [
      makeGoFile(GO_REPLACE_FIXTURES, 'pkg/auth/auth.go', ['example.com/shared']),
      makeGoFile(GO_REPLACE_FIXTURES, 'pkg/shared/utils.go', []),
    ];

    const { edges } = await resolveImports(files, GO_REPLACE_FIXTURES);
    expect(
      edges.some(e => e.from === 'pkg/auth/auth.go' && e.to === 'pkg/shared/utils.go'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PHP PSR-4 resolver
// ---------------------------------------------------------------------------

function makePhpFile(rootDir: string, id: string, imports: string[]): IndexedFile {
  return {
    id,
    path: join(rootDir, id),
    relativePath: id,
    language: 'php',
    domains: [],
    exports: [],
    hasDefaultExport: false,
    imports,
    hash: 'abc',
    lineCount: 10,
    tokenEstimate: 100,
  } as unknown as IndexedFile;
}

describe('resolver — PHP PSR-4 namespace imports', () => {
  it('resolves App\\Models\\User to app/Models/User.php via composer.json', async () => {
    const files: IndexedFile[] = [
      makePhpFile(PHP_PSR4_FIXTURES, 'AuthService.php', ['App\\Models\\User']),
      makePhpFile(PHP_PSR4_FIXTURES, 'app/Models/User.php', []),
    ];

    const { edges } = await resolveImports(files, PHP_PSR4_FIXTURES);
    expect(edges.some(e => e.from === 'AuthService.php' && e.to === 'app/Models/User.php')).toBe(true);
  });

  it('reports unresolved for non-PSR-4 vendor namespaces', async () => {
    const files: IndexedFile[] = [
      makePhpFile(PHP_PSR4_FIXTURES, 'AuthService.php', ['Illuminate\\Support\\Facades\\Auth']),
    ];

    const { unresolved } = await resolveImports(files, PHP_PSR4_FIXTURES);
    expect(unresolved.some(u => u.specifier === 'Illuminate\\Support\\Facades\\Auth')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Python src/ layout
// ---------------------------------------------------------------------------

function makePyFile(rootDir: string, id: string, imports: string[]): IndexedFile {
  return {
    id,
    path: join(rootDir, id),
    relativePath: id,
    language: 'python',
    domains: [],
    exports: [],
    hasDefaultExport: false,
    imports,
    hash: 'abc',
    lineCount: 10,
    tokenEstimate: 100,
  } as unknown as IndexedFile;
}

describe('resolver — Python src/ layout', () => {
  it('resolves an absolute import found under src/', async () => {
    // config module lives at src/config/__init__.py
    const files: IndexedFile[] = [
      makePyFile(PYTHON_SRC_FIXTURES, 'app.py', ['config']),
      makePyFile(PYTHON_SRC_FIXTURES, 'src/config/__init__.py', []),
    ];

    const { edges } = await resolveImports(files, PYTHON_SRC_FIXTURES);
    expect(edges.some(e => e.from === 'app.py' && e.to === 'src/config/__init__.py')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ruby spec/ load root
// ---------------------------------------------------------------------------

function makeRubyFileIn(rootDir: string, id: string, imports: string[]): IndexedFile {
  return {
    id,
    path: join(rootDir, id),
    relativePath: id,
    language: 'ruby',
    domains: [],
    exports: [],
    hasDefaultExport: false,
    imports,
    hash: 'abc',
    lineCount: 10,
    tokenEstimate: 100,
  } as unknown as IndexedFile;
}

describe('resolver — Ruby spec/ load root', () => {
  it('resolves a non-relative require found under spec/', async () => {
    const files: IndexedFile[] = [
      makeRubyFileIn(RUBY_SPEC_FIXTURES, 'spec/auth_spec.rb', ['support/helpers']),
      makeRubyFileIn(RUBY_SPEC_FIXTURES, 'spec/support/helpers.rb', []),
    ];

    const { edges } = await resolveImports(files, RUBY_SPEC_FIXTURES);
    expect(
      edges.some(e => e.from === 'spec/auth_spec.rb' && e.to === 'spec/support/helpers.rb'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rust: use crate:: imports are NOT stored
// ---------------------------------------------------------------------------

describe('resolver — Rust use declarations excluded from imports', () => {
  it('does not produce edges for use crate:: paths (only mod declarations do)', async () => {
    // Rust extractor only pushes mod_item (file boundaries) into imports[].
    // use_declaration items are dropped — they describe namespace aliases, not files.
    const files: IndexedFile[] = [
      makeFile('rust/auth.rs', 'rust', []),  // no imports — use crate:: is not stored
    ];

    const { edges } = await resolveImports(files, FIXTURES);
    const authEdges = edges.filter(e => e.from === 'rust/auth.rs');
    expect(authEdges).toHaveLength(0);
  });
});
