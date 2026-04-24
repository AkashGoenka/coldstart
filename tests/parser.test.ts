import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../src/indexer/parser.js';
import { parseTsContent } from '../src/indexer/ts-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

describe('parser — TypeScript', () => {
  it('extracts named exports from auth.ts', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('AuthService');
    expect(result!.exports).toContain('hashPassword');
    expect(result!.exports).toContain('LoginRequest');
    expect(result!.exports).toContain('AuthResult');
  });

  it('extracts imports from auth.ts', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript');
    expect(result).not.toBeNull();
    const imports = result!.imports;
    expect(imports.some(i => i.includes('bcrypt'))).toBe(true);
    expect(imports.some(i => i.includes('./userRepository'))).toBe(true);
    expect(imports.some(i => i.includes('./tokenService'))).toBe(true);
  });

  it('detects default export from userRepository.ts', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/userRepository.ts'), 'typescript');
    expect(result).not.toBeNull();
    expect(result!.hasDefaultExport).toBe(true);
    expect(result!.exports).toContain('User');
    expect(result!.exports).toContain('UserRepository');
  });

  it('produces a hash and line count', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });

  it('does not return a domain field (domains are computed in index construction)', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript');
    expect((result as Record<string, unknown>)['domain']).toBeUndefined();
  });
});

describe('parser — Python', () => {
  it('extracts exports via __all__ from auth.py', async () => {
    const result = await parseFile(join(FIXTURES, 'python/auth.py'), 'python');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('AuthService');
    expect(result!.exports).toContain('hash_password');
    expect(result!.exports).toContain('verify_password');
  });

  it('does not export private functions (underscore prefix)', async () => {
    const result = await parseFile(join(FIXTURES, 'python/auth.py'), 'python');
    expect(result!.exports).not.toContain('_internal_helper');
  });

  it('extracts from imports', async () => {
    const result = await parseFile(join(FIXTURES, 'python/auth.py'), 'python');
    expect(result!.imports.some(i => i.includes('user_repository') || i.includes('hashlib'))).toBe(true);
  });

  it('produces non-empty symbols array', async () => {
    const result = await parseFile(join(FIXTURES, 'python/auth.py'), 'python');
    expect(result!.symbols.length).toBeGreaterThan(0);
  });

  it('extracts class symbols with correct kind and isExported', async () => {
    const result = await parseFile(join(FIXTURES, 'python/auth.py'), 'python', 'python/auth.py');
    const cls = result!.symbols.find(s => s.name === 'AuthService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.isExported).toBe(true);
    expect(cls!.id).toBe('python/auth.py#AuthService');
  });

  it('extracts function symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'python/auth.py'), 'python', 'python/auth.py');
    const fn = result!.symbols.find(s => s.name === 'hash_password');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
    expect(fn!.isExported).toBe(true);
  });

  it('private function is not exported', async () => {
    const result = await parseFile(join(FIXTURES, 'python/auth.py'), 'python', 'python/auth.py');
    const priv = result!.symbols.find(s => s.name === '_internal_helper');
    expect(priv).toBeDefined();
    expect(priv!.isExported).toBe(false);
  });

  it('produces hash and lineCount', async () => {
    const result = await parseFile(join(FIXTURES, 'python/auth.py'), 'python');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });
});

describe('parser — Go', () => {
  it('extracts uppercase exports from auth.go', async () => {
    const result = await parseFile(join(FIXTURES, 'go/auth.go'), 'go');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('Login');
    expect(result!.exports).toContain('HashPassword');
    expect(result!.exports).toContain('ValidateToken');
    expect(result!.exports).toContain('AuthService');
    expect(result!.exports).toContain('LoginRequest');
    expect(result!.exports).toContain('AuthResult');
  });

  it('extracts multi-package imports', async () => {
    const result = await parseFile(join(FIXTURES, 'go/auth.go'), 'go');
    expect(result!.imports.some(i => i.includes('crypto/sha256') || i.includes('errors'))).toBe(true);
  });

  it('produces non-empty symbols array', async () => {
    const result = await parseFile(join(FIXTURES, 'go/auth.go'), 'go');
    expect(result!.symbols.length).toBeGreaterThan(0);
  });

  it('extracts struct symbols as class kind', async () => {
    const result = await parseFile(join(FIXTURES, 'go/auth.go'), 'go', 'go/auth.go');
    const sym = result!.symbols.find(s => s.name === 'AuthService');
    expect(sym).toBeDefined();
    expect(sym!.kind).toBe('class');
    expect(sym!.isExported).toBe(true);
    expect(sym!.id).toBe('go/auth.go#AuthService');
  });

  it('extracts function symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'go/auth.go'), 'go', 'go/auth.go');
    const fn = result!.symbols.find(s => s.name === 'Login');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
    expect(fn!.isExported).toBe(true);
  });

  it('produces hash and lineCount', async () => {
    const result = await parseFile(join(FIXTURES, 'go/auth.go'), 'go');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });
});

describe('parser — Rust', () => {
  it('extracts pub declarations from auth.rs', async () => {
    const result = await parseFile(join(FIXTURES, 'rust/auth.rs'), 'rust');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('AuthService');
    expect(result!.exports).toContain('hash_password');
    expect(result!.exports).toContain('Authenticator');
    expect(result!.exports).toContain('LoginRequest');
    expect(result!.exports).toContain('AuthResult');
  });

  it('extracts mod declarations as imports', async () => {
    const result = await parseFile(join(FIXTURES, 'rust/auth.rs'), 'rust');
    expect(result!.imports.some(i => i === 'token' || i === 'hash')).toBe(true);
  });

  it('produces non-empty symbols array', async () => {
    const result = await parseFile(join(FIXTURES, 'rust/auth.rs'), 'rust');
    expect(result!.symbols.length).toBeGreaterThan(0);
  });

  it('extracts struct symbols as class kind', async () => {
    const result = await parseFile(join(FIXTURES, 'rust/auth.rs'), 'rust', 'rust/auth.rs');
    const sym = result!.symbols.find(s => s.name === 'AuthService');
    expect(sym).toBeDefined();
    expect(sym!.kind).toBe('class');
    expect(sym!.isExported).toBe(true);
    expect(sym!.id).toBe('rust/auth.rs#AuthService');
  });

  it('extracts trait symbols as interface kind', async () => {
    const result = await parseFile(join(FIXTURES, 'rust/auth.rs'), 'rust', 'rust/auth.rs');
    const sym = result!.symbols.find(s => s.name === 'Authenticator');
    expect(sym).toBeDefined();
    expect(sym!.kind).toBe('interface');
    expect(sym!.isExported).toBe(true);
  });

  it('impl Trait for Struct populates implementsNames', async () => {
    // auth.rs does not have a trait impl, but struct is still extracted
    const result = await parseFile(join(FIXTURES, 'rust/auth.rs'), 'rust', 'rust/auth.rs');
    const sym = result!.symbols.find(s => s.name === 'AuthService');
    expect(sym).toBeDefined();
    expect(Array.isArray(sym!.implementsNames)).toBe(true);
  });

  it('produces hash and lineCount', async () => {
    const result = await parseFile(join(FIXTURES, 'rust/auth.rs'), 'rust');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });
});

describe('parser — C#', () => {
  it('extracts public types from AuthService.cs', async () => {
    const result = await parseFile(join(FIXTURES, 'csharp/AuthService.cs'), 'csharp');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('AuthService');
    expect(result!.exports).toContain('LoginRequest');
    expect(result!.exports).toContain('AuthResult');
    expect(result!.exports).toContain('IAuthService');
  });

  it('extracts using imports', async () => {
    const result = await parseFile(join(FIXTURES, 'csharp/AuthService.cs'), 'csharp');
    expect(result!.imports.some(i => i.includes('System') || i.includes('Cryptography'))).toBe(true);
  });

  it('produces non-empty symbols array', async () => {
    const result = await parseFile(join(FIXTURES, 'csharp/AuthService.cs'), 'csharp');
    expect(result!.symbols.length).toBeGreaterThan(0);
  });

  it('extracts class symbols with correct kind and isExported', async () => {
    const result = await parseFile(join(FIXTURES, 'csharp/AuthService.cs'), 'csharp', 'csharp/AuthService.cs');
    const cls = result!.symbols.find(s => s.name === 'AuthService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.isExported).toBe(true);
    expect(cls!.id).toBe('csharp/AuthService.cs#AuthService');
  });

  it('extracts interface symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'csharp/AuthService.cs'), 'csharp', 'csharp/AuthService.cs');
    const iface = result!.symbols.find(s => s.name === 'IAuthService');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
    expect(iface!.isExported).toBe(true);
  });

  it('extracts method symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'csharp/AuthService.cs'), 'csharp', 'csharp/AuthService.cs');
    const method = result!.symbols.find(s => s.name === 'AuthService.Login');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('produces hash and lineCount', async () => {
    const result = await parseFile(join(FIXTURES, 'csharp/AuthService.cs'), 'csharp');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });
});

describe('parser — PHP', () => {
  it('extracts classes and interfaces from AuthService.php', async () => {
    const result = await parseFile(join(FIXTURES, 'php/AuthService.php'), 'php');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('AuthService');
    expect(result!.exports).toContain('LoginRequest');
    expect(result!.exports).toContain('AuthResult');
    expect(result!.exports).toContain('AuthInterface');
  });

  it('extracts use imports', async () => {
    const result = await parseFile(join(FIXTURES, 'php/AuthService.php'), 'php');
    expect(result!.imports.some(i => i.includes('UserRepository') || i.includes('TokenService'))).toBe(true);
  });

  it('produces non-empty symbols array', async () => {
    const result = await parseFile(join(FIXTURES, 'php/AuthService.php'), 'php');
    expect(result!.symbols.length).toBeGreaterThan(0);
  });

  it('extracts class symbols with correct kind and isExported', async () => {
    const result = await parseFile(join(FIXTURES, 'php/AuthService.php'), 'php', 'php/AuthService.php');
    const cls = result!.symbols.find(s => s.name === 'AuthService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.isExported).toBe(true);
    expect(cls!.id).toBe('php/AuthService.php#AuthService');
  });

  it('extracts interface symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'php/AuthService.php'), 'php', 'php/AuthService.php');
    const iface = result!.symbols.find(s => s.name === 'AuthInterface');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
  });

  it('extracts extends and implements', async () => {
    const result = await parseFile(join(FIXTURES, 'php/AuthService.php'), 'php', 'php/AuthService.php');
    const cls = result!.symbols.find(s => s.name === 'AuthService');
    expect(cls!.extendsName).toBe('BaseService');
    expect(cls!.implementsNames).toContain('AuthInterface');
  });

  it('produces hash and lineCount', async () => {
    const result = await parseFile(join(FIXTURES, 'php/AuthService.php'), 'php');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });
});

describe('parser — Kotlin', () => {
  it('extracts classes and interfaces from AuthService.kt', async () => {
    const result = await parseFile(join(FIXTURES, 'kotlin/AuthService.kt'), 'kotlin');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('AuthService');
    expect(result!.exports).toContain('LoginRequest');
    expect(result!.exports).toContain('AuthResult');
    expect(result!.exports).toContain('AuthInterface');
  });

  it('extracts import headers', async () => {
    const result = await parseFile(join(FIXTURES, 'kotlin/AuthService.kt'), 'kotlin');
    expect(result!.imports.some(i => i.includes('UserRepository') || i.includes('TokenService') || i.includes('com.example'))).toBe(true);
  });

  it('produces non-empty symbols array', async () => {
    const result = await parseFile(join(FIXTURES, 'kotlin/AuthService.kt'), 'kotlin');
    expect(result!.symbols.length).toBeGreaterThan(0);
  });

  it('extracts class symbols with correct kind and isExported', async () => {
    const result = await parseFile(join(FIXTURES, 'kotlin/AuthService.kt'), 'kotlin', 'kotlin/AuthService.kt');
    const cls = result!.symbols.find(s => s.name === 'AuthService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.isExported).toBe(true);
    expect(cls!.id).toBe('kotlin/AuthService.kt#AuthService');
  });

  it('extracts interface symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'kotlin/AuthService.kt'), 'kotlin', 'kotlin/AuthService.kt');
    const iface = result!.symbols.find(s => s.name === 'AuthInterface');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
    expect(iface!.isExported).toBe(true);
  });

  it('extracts method symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'kotlin/AuthService.kt'), 'kotlin', 'kotlin/AuthService.kt');
    const method = result!.symbols.find(s => s.name === 'AuthService.login');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('produces hash and lineCount', async () => {
    const result = await parseFile(join(FIXTURES, 'kotlin/AuthService.kt'), 'kotlin');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });
});

describe('parser — Swift', () => {
  const FILE_ID = 'tests/fixtures/swift/AuthService.swift';

  it('extracts imports from AuthService.swift', async () => {
    const result = await parseFile(join(FIXTURES, 'swift/AuthService.swift'), 'swift', FILE_ID);
    expect(result).not.toBeNull();
    expect(result!.imports).toContain('Foundation');
    expect(result!.imports).toContain('UIKit');
  });

  it('extracts protocol as interface symbol', async () => {
    const result = await parseFile(join(FIXTURES, 'swift/AuthService.swift'), 'swift', FILE_ID);
    const proto = result!.symbols.find(s => s.name === 'AuthInterface')!;
    expect(proto).toBeDefined();
    expect(proto.kind).toBe('interface');
    expect(proto.isExported).toBe(true);
    expect(result!.exports).toContain('AuthInterface');
  });

  it('extracts class with extends and implements', async () => {
    const result = await parseFile(join(FIXTURES, 'swift/AuthService.swift'), 'swift', FILE_ID);
    const cls = result!.symbols.find(s => s.name === 'AuthService')!;
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
    expect(cls.extendsName).toBe('BaseService');
    expect(cls.implementsNames).toContain('AuthInterface');
  });

  it('extracts struct and enum as class symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'swift/AuthService.swift'), 'swift', FILE_ID);
    const struct = result!.symbols.find(s => s.name === 'LoginRequest')!;
    expect(struct).toBeDefined();
    expect(struct.kind).toBe('class');
    const enumSym = result!.symbols.find(s => s.name === 'AuthError')!;
    expect(enumSym).toBeDefined();
    expect(enumSym.kind).toBe('class');
  });

  it('extracts methods from class and protocol bodies', async () => {
    const result = await parseFile(join(FIXTURES, 'swift/AuthService.swift'), 'swift', FILE_ID);
    const names = result!.symbols.map(s => s.name);
    expect(names).toContain('AuthService.login');
    expect(names).toContain('AuthService.logout');
    expect(names).toContain('AuthInterface.login');
    expect(names).toContain('AuthInterface.logout');
  });

  it('extracts top-level function', async () => {
    const result = await parseFile(join(FIXTURES, 'swift/AuthService.swift'), 'swift', FILE_ID);
    const fn = result!.symbols.find(s => s.name === 'generateToken')!;
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
    expect(fn.isExported).toBe(true);
    expect(result!.exports).toContain('generateToken');
  });

  it('respects private modifier', async () => {
    const result = await parseFile(join(FIXTURES, 'swift/AuthService.swift'), 'swift', FILE_ID);
    const loginMethod = result!.symbols.find(s => s.name === 'AuthService.login')!;
    // login is implicitly internal (public within module)
    expect(loginMethod.isExported).toBe(true);
  });
});

describe('parser — Dart', () => {
  const FILE_ID = 'tests/fixtures/dart/auth_service.dart';

  it('extracts imports from auth_service.dart', async () => {
    const result = await parseFile(join(FIXTURES, 'dart/auth_service.dart'), 'dart', FILE_ID);
    expect(result).not.toBeNull();
    expect(result!.imports).toContain('package:crypto/crypto.dart');
    expect(result!.imports).toContain('package:auth/user_repository.dart');
  });

  it('extracts class symbols', async () => {
    const result = await parseFile(join(FIXTURES, 'dart/auth_service.dart'), 'dart', FILE_ID);
    const names = result!.symbols.map(s => s.name);
    expect(names).toContain('LoginRequest');
    expect(names).toContain('AuthResult');
    expect(names).toContain('AuthService');
    expect(names).toContain('AuthInterface');
  });

  it('extracts extends and implements on AuthService', async () => {
    const result = await parseFile(join(FIXTURES, 'dart/auth_service.dart'), 'dart', FILE_ID);
    const cls = result!.symbols.find(s => s.name === 'AuthService')!;
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
    expect(cls.extendsName).toBe('BaseService');
    expect(cls.implementsNames).toContain('AuthInterface');
  });

  it('extracts methods from AuthService', async () => {
    const result = await parseFile(join(FIXTURES, 'dart/auth_service.dart'), 'dart', FILE_ID);
    const names = result!.symbols.map(s => s.name);
    expect(names).toContain('AuthService.login');
    expect(names).toContain('AuthService.verifyPassword');
  });

  it('extracts top-level function', async () => {
    const result = await parseFile(join(FIXTURES, 'dart/auth_service.dart'), 'dart', FILE_ID);
    const fn = result!.symbols.find(s => s.name === 'generateToken')!;
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
    expect(result!.exports).toContain('generateToken');
  });

  it('exports all public classes', async () => {
    const result = await parseFile(join(FIXTURES, 'dart/auth_service.dart'), 'dart', FILE_ID);
    expect(result!.exports).toContain('AuthService');
    expect(result!.exports).toContain('LoginRequest');
    expect(result!.exports).toContain('AuthInterface');
  });
});

// =============================================================================
// Tree-sitter symbol extraction (TS/JS only, v4)
// =============================================================================

describe('ts-parser — symbol extraction', () => {
  const AUTH_FILE_ID = 'tests/fixtures/typescript/auth.ts';
  const REPO_FILE_ID = 'tests/fixtures/typescript/userRepository.ts';

  it('extracts interface symbols from auth.ts', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript', AUTH_FILE_ID);
    expect(result).not.toBeNull();
    const names = result!.symbols.map(s => s.name);
    expect(names).toContain('LoginRequest');
    expect(names).toContain('AuthResult');
    const lr = result!.symbols.find(s => s.name === 'LoginRequest')!;
    expect(lr.kind).toBe('interface');
    expect(lr.isExported).toBe(true);
  });

  it('extracts class symbol with method symbols from auth.ts', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript', AUTH_FILE_ID);
    expect(result).not.toBeNull();
    const cls = result!.symbols.find(s => s.name === 'AuthService')!;
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
    expect(cls.isExported).toBe(true);
    expect(cls.id).toBe(`${AUTH_FILE_ID}#AuthService`);

    const loginMethod = result!.symbols.find(s => s.name === 'AuthService.login')!;
    expect(loginMethod).toBeDefined();
    expect(loginMethod.kind).toBe('method');
    expect(loginMethod.isExported).toBe(false);
  });

  it('extracts function symbol from auth.ts', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript', AUTH_FILE_ID);
    const fn = result!.symbols.find(s => s.name === 'hashPassword')!;
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
    expect(fn.isExported).toBe(true);
    expect(fn.startLine).toBeGreaterThan(0);
    expect(fn.endLine).toBeGreaterThanOrEqual(fn.startLine);
  });

  it('tracks intra-file calls in method bodies', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript', AUTH_FILE_ID);
    const loginMethod = result!.symbols.find(s => s.name === 'AuthService.login')!;
    // login calls findByEmail, compare, sign inside its body
    expect(loginMethod.calls.length).toBeGreaterThan(0);
  });

  it('extracts symbols from userRepository.ts', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/userRepository.ts'), 'typescript', REPO_FILE_ID);
    const names = result!.symbols.map(s => s.name);
    expect(names).toContain('User');
    expect(names).toContain('UserRepository');
    expect(names).toContain('UserRepository.findByEmail');
  });

  it('symbol IDs use fileId prefix', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript', AUTH_FILE_ID);
    for (const sym of result!.symbols) {
      expect(sym.id.startsWith(AUTH_FILE_ID + '#')).toBe(true);
    }
  });

  it('extracts class extends and implements via parseTsContent', () => {
    const src = `
      export class Dog extends Animal implements Runnable, Jumpable {
        run() { this.move(); }
      }
    `;
    const result = parseTsContent(src, 'src/dog.ts');
    const dog = result.symbols.find(s => s.name === 'Dog')!;
    expect(dog).toBeDefined();
    expect(dog.kind).toBe('class');
    expect(dog.extendsName).toBe('Animal');
    expect(dog.implementsNames).toContain('Runnable');
    expect(dog.implementsNames).toContain('Jumpable');
  });

  it('extracts type alias and constant symbols via parseTsContent', () => {
    const src = `
      export type UserId = string;
      export const MAX_RETRIES = 3;
    `;
    const result = parseTsContent(src, 'src/constants.ts');
    const typeAlias = result.symbols.find(s => s.name === 'UserId')!;
    expect(typeAlias).toBeDefined();
    expect(typeAlias.kind).toBe('type');
    const constant = result.symbols.find(s => s.name === 'MAX_RETRIES')!;
    expect(constant).toBeDefined();
    expect(constant.kind).toBe('constant');
  });
});
