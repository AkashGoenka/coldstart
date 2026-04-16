import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../src/indexer/parser.js';
import { parseJavaContent } from '../src/indexer/extractors/java.js';
import { parseRubyContent } from '../src/indexer/extractors/ruby.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const JAVA_DIR = join(FIXTURES, 'java');
const RUBY_DIR = join(FIXTURES, 'ruby');

// =============================================================================
// Java — symbol extraction
// =============================================================================

describe('parser — Java (via parseFile)', () => {
  it('extracts public class export from AuthService.java', async () => {
    const result = await parseFile(join(JAVA_DIR, 'AuthService.java'), 'java');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('AuthService');
  });

  it('extracts imports from AuthService.java', async () => {
    const result = await parseFile(join(JAVA_DIR, 'AuthService.java'), 'java');
    expect(result).not.toBeNull();
    const imports = result!.imports;
    expect(imports.some(i => i.includes('com.example.user.UserRepository'))).toBe(true);
    expect(imports.some(i => i.includes('com.example.token.TokenService'))).toBe(true);
    expect(imports.some(i => i.includes('java.util.List'))).toBe(true);
  });

  it('produces hash and line count', async () => {
    const result = await parseFile(join(JAVA_DIR, 'AuthService.java'), 'java');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });

  it('domain defaults to unknown', async () => {
    const result = await parseFile(join(JAVA_DIR, 'AuthService.java'), 'java');
    expect(result!.domain).toBe('unknown');
  });

  it('hasDefaultExport is always false for Java', async () => {
    const result = await parseFile(join(JAVA_DIR, 'AuthService.java'), 'java');
    expect(result!.hasDefaultExport).toBe(false);
  });

  it('extracts enum as class-kind symbol', async () => {
    const result = await parseFile(join(JAVA_DIR, 'Status.java'), 'java');
    expect(result).not.toBeNull();
    expect(result!.exports).toContain('Status');
    const status = result!.symbols.find(s => s.name === 'Status');
    expect(status).toBeDefined();
    expect(status!.kind).toBe('class');
  });

  it('extracts interface symbol', async () => {
    const result = await parseFile(join(JAVA_DIR, 'Authenticatable.java'), 'java');
    expect(result).not.toBeNull();
    const sym = result!.symbols.find(s => s.name === 'Authenticatable');
    expect(sym).toBeDefined();
    expect(sym!.kind).toBe('interface');
    expect(sym!.isExported).toBe(true);
  });
});

describe('java-parser — symbol extraction (direct)', () => {
  const AUTH_FILE_ID = 'tests/fixtures/java/AuthService.java';

  it('extracts class symbol with correct kind and isExported', () => {
    const src = `
      package com.example;
      public class AuthService implements Authenticatable {
        public AuthResult login(LoginRequest req) { return null; }
      }
    `;
    const result = parseJavaContent(src, AUTH_FILE_ID);
    const cls = result.symbols.find(s => s.name === 'AuthService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.isExported).toBe(true);
    expect(cls!.id).toBe(`${AUTH_FILE_ID}#AuthService`);
  });

  it('extracts implements relationship on class', () => {
    const src = `
      public class AuthService implements Authenticatable, Closeable {
        public AuthResult login() { return null; }
      }
    `;
    const result = parseJavaContent(src, AUTH_FILE_ID);
    const cls = result.symbols.find(s => s.name === 'AuthService');
    expect(cls).toBeDefined();
    expect(cls!.implementsNames).toContain('Authenticatable');
    expect(cls!.implementsNames).toContain('Closeable');
  });

  it('extracts extends relationship on class', () => {
    const src = `
      public class AdminService extends AuthService {
        public void admin() {}
      }
    `;
    const result = parseJavaContent(src, AUTH_FILE_ID);
    const cls = result.symbols.find(s => s.name === 'AdminService');
    expect(cls).toBeDefined();
    expect(cls!.extendsName).toBe('AuthService');
  });

  it('extracts method symbols from class body', () => {
    const src = `
      public class AuthService {
        public AuthResult login(LoginRequest req) { return null; }
        private boolean verify(String raw, String hash) { return true; }
      }
    `;
    const result = parseJavaContent(src, AUTH_FILE_ID);
    const method = result.symbols.find(s => s.name === 'AuthService.login');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('extracts static final fields as constants', () => {
    const src = `
      public class AuthService {
        private static final String ALGORITHM = "SHA-256";
        public static final int MAX = 3;
        private int notAConstant;
      }
    `;
    const result = parseJavaContent(src, AUTH_FILE_ID);
    const constant = result.symbols.find(s => s.name === 'AuthService.MAX');
    expect(constant).toBeDefined();
    expect(constant!.kind).toBe('constant');
    // Instance field should NOT be extracted
    expect(result.symbols.find(s => s.name === 'AuthService.notAConstant')).toBeUndefined();
  });

  it('extracts package name', () => {
    const src = `
      package com.example.auth;
      public class Foo {}
    `;
    const result = parseJavaContent(src, 'src/Foo.java');
    expect(result.packageName).toBe('com.example.auth');
  });

  it('extracts wildcard imports', () => {
    const src = `
      import com.example.auth.*;
      import java.util.List;
      public class Foo {}
    `;
    const result = parseJavaContent(src, 'src/Foo.java');
    expect(result.imports.some(i => i.includes('com.example.auth'))).toBe(true);
    expect(result.imports).toContain('java.util.List');
  });

  it('extracts interface with extends_interfaces', () => {
    const src = `
      public interface PaymentService extends Closeable, AutoCloseable {
        void pay();
      }
    `;
    const result = parseJavaContent(src, 'src/PaymentService.java');
    const iface = result.symbols.find(s => s.name === 'PaymentService');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
    expect(iface!.implementsNames).toContain('Closeable');
  });

  it('tracks method invocations as calls', () => {
    const src = `
      public class AuthService {
        public AuthResult login(String email, String password) {
          User user = findUser(email);
          verify(password);
          return null;
        }
        private User findUser(String email) { return null; }
        private void verify(String p) {}
      }
    `;
    const result = parseJavaContent(src, AUTH_FILE_ID);
    const loginMethod = result.symbols.find(s => s.name === 'AuthService.login');
    expect(loginMethod).toBeDefined();
    expect(loginMethod!.calls.length).toBeGreaterThan(0);
  });

  it('extracts multiple classes from single source', () => {
    const src = `
      package com.example;
      public class AuthService {}
      class Helper {}
    `;
    const result = parseJavaContent(src, 'src/AuthService.java');
    expect(result.symbols.find(s => s.name === 'AuthService')).toBeDefined();
    // Helper is package-private (no public), so isExported = false but still extracted
    expect(result.symbols.find(s => s.name === 'Helper')).toBeDefined();
  });

  it('extracts inner class with parent prefix', () => {
    const src = `
      public class Outer {
        public class Inner {}
      }
    `;
    const result = parseJavaContent(src, 'src/Outer.java');
    const inner = result.symbols.find(s => s.name === 'Outer.Inner');
    expect(inner).toBeDefined();
    expect(inner!.kind).toBe('class');
  });

  it('symbol IDs use fileId prefix', () => {
    const src = `public class Foo { public void bar() {} }`;
    const result = parseJavaContent(src, AUTH_FILE_ID);
    for (const sym of result.symbols) {
      expect(sym.id.startsWith(AUTH_FILE_ID + '#')).toBe(true);
    }
  });
});

// =============================================================================
// Ruby — symbol extraction
// =============================================================================

describe('parser — Ruby (via parseFile)', () => {
  it('extracts class exports from auth_service.rb', async () => {
    const result = await parseFile(join(RUBY_DIR, 'auth_service.rb'), 'ruby');
    expect(result).not.toBeNull();
    expect(result!.exports.some(e => e.includes('AuthService'))).toBe(true);
  });

  it('extracts require/require_relative imports from auth_service.rb', async () => {
    const result = await parseFile(join(RUBY_DIR, 'auth_service.rb'), 'ruby');
    expect(result).not.toBeNull();
    const imports = result!.imports;
    expect(imports.some(i => i.includes('bcrypt'))).toBe(true);
    expect(imports.some(i => i.includes('user_repository'))).toBe(true);
    expect(imports.some(i => i.includes('token_service'))).toBe(true);
  });

  it('produces hash and line count', async () => {
    const result = await parseFile(join(RUBY_DIR, 'auth_service.rb'), 'ruby');
    expect(result!.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(result!.lineCount).toBeGreaterThan(5);
  });

  it('hasDefaultExport is always false for Ruby', async () => {
    const result = await parseFile(join(RUBY_DIR, 'auth_service.rb'), 'ruby');
    expect(result!.hasDefaultExport).toBe(false);
  });

  it('extracts class with include mixin', async () => {
    const result = await parseFile(join(RUBY_DIR, 'user_repository.rb'), 'ruby');
    expect(result).not.toBeNull();
    const cls = result!.symbols.find(s => s.name === 'UserRepository');
    expect(cls).toBeDefined();
    expect(cls!.implementsNames).toContain('Enumerable');
  });
});

describe('ruby-parser — symbol extraction (direct)', () => {
  const AUTH_FILE_ID = 'tests/fixtures/ruby/auth_service.rb';

  it('extracts class symbol', () => {
    const src = `
      class AuthService
        def login(email, password)
          nil
        end
      end
    `;
    const result = parseRubyContent(src, AUTH_FILE_ID);
    const cls = result.symbols.find(s => s.name === 'AuthService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.isExported).toBe(true);
  });

  it('extracts class with inheritance', () => {
    const src = `
      class Post < ApplicationRecord
        def publish; end
      end
    `;
    const result = parseRubyContent(src, 'src/post.rb');
    const cls = result.symbols.find(s => s.name === 'Post');
    expect(cls).toBeDefined();
    expect(cls!.extendsName).toBe('ApplicationRecord');
  });

  it('extracts module as class-kind symbol', () => {
    const src = `
      module Auth
        def authenticate; end
      end
    `;
    const result = parseRubyContent(src, 'src/auth.rb');
    const mod = result.symbols.find(s => s.name === 'Auth');
    expect(mod).toBeDefined();
    expect(mod!.kind).toBe('class');
  });

  it('extracts instance methods as method-kind symbols', () => {
    const src = `
      class AuthService
        def login(email, password)
          verify(password)
        end
      end
    `;
    const result = parseRubyContent(src, AUTH_FILE_ID);
    const method = result.symbols.find(s => s.name === 'AuthService.login');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('extracts singleton (class) methods', () => {
    const src = `
      class AuthService
        def self.hash_password(password)
          password
        end
      end
    `;
    const result = parseRubyContent(src, AUTH_FILE_ID);
    const method = result.symbols.find(s => s.name?.includes('hash_password'));
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('extracts constant assignments', () => {
    const src = `
      class AuthService
        MAX_RETRIES = 3
        DEFAULT_ALGO = 'sha256'
      end
    `;
    const result = parseRubyContent(src, AUTH_FILE_ID);
    const constant = result.symbols.find(s => s.name?.includes('MAX_RETRIES'));
    expect(constant).toBeDefined();
    expect(constant!.kind).toBe('constant');
  });

  it('extracts include as implements edge', () => {
    const src = `
      class UserRepository
        include Enumerable
        include Comparable
      end
    `;
    const result = parseRubyContent(src, 'src/user_repository.rb');
    const cls = result.symbols.find(s => s.name === 'UserRepository');
    expect(cls).toBeDefined();
    expect(cls!.implementsNames).toContain('Enumerable');
    expect(cls!.implementsNames).toContain('Comparable');
  });

  it('extracts require imports', () => {
    const src = `
      require 'json'
      require_relative './user_repository'
      require 'active_record'
    `;
    const result = parseRubyContent(src, AUTH_FILE_ID);
    expect(result.imports).toContain('json');
    expect(result.imports.some(i => i.includes('user_repository'))).toBe(true);
  });

  it('extracts nested class within module', () => {
    const src = `
      module Auth
        class AuthService
          def login; end
        end
      end
    `;
    const result = parseRubyContent(src, AUTH_FILE_ID);
    const cls = result.symbols.find(s => s.name === 'Auth::AuthService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
  });

  it('symbol IDs use fileId prefix', () => {
    const src = `
      class Foo
        def bar; end
      end
    `;
    const result = parseRubyContent(src, AUTH_FILE_ID);
    for (const sym of result.symbols) {
      expect(sym.id.startsWith(AUTH_FILE_ID + '#')).toBe(true);
    }
  });

  it('Rails has_many creates association call', () => {
    const src = `
      class Post < ApplicationRecord
        has_many :comments
        belongs_to :user
      end
    `;
    const result = parseRubyContent(src, 'app/models/post.rb');
    const cls = result.symbols.find(s => s.name === 'Post');
    expect(cls).toBeDefined();
    // has_many :comments → Comment model in implementsNames (tracked as association)
    expect(cls!.implementsNames.some(n => n.includes('Comment'))).toBe(true);
  });
});
