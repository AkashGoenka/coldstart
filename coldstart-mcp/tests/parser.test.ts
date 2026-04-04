import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../src/indexer/parser.js';

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

  it('infers auth domain for auth.ts', async () => {
    const result = await parseFile(join(FIXTURES, 'typescript/auth.ts'), 'typescript');
    expect(result!.domain).toBe('auth');
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

  it('extracts class exports from user_repository.py', async () => {
    const result = await parseFile(join(FIXTURES, 'python/user_repository.py'), 'python');
    expect(result!.exports).toContain('UserRepository');
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
});
