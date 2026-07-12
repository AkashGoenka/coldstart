import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJavaContent } from '../src/indexer/extractors/java.js';
import { parseKotlinContent } from '../src/indexer/extractors/kotlin.js';
import { ensureParsersReady } from '../src/indexer/extractors/parser-factory.js';

// Direct extractor calls (not via parseFile) must load the wasm grammars first.
beforeAll(async () => { await ensureParsersReady(); });

const __dirname = dirname(fileURLToPath(import.meta.url));
const JAVA_DIR = join(__dirname, 'fixtures', 'java', 'same-package');
const KOTLIN_DIR = join(__dirname, 'fixtures', 'kotlin', 'same-package');

async function parseJ(rel: string) {
  const path = join(JAVA_DIR, rel);
  const content = await readFile(path, 'utf-8');
  return parseJavaContent(content, rel);
}

async function parseK(rel: string) {
  const path = join(KOTLIN_DIR, rel);
  const content = await readFile(path, 'utf-8');
  return parseKotlinContent(content, rel);
}

// =============================================================================
// Java
// =============================================================================

describe('Java same-package short-name qualification', () => {
  it('qualifies bare type references (extends, field, return) as same-package FQCN', async () => {
    const r = await parseJ('com/example/svc/UserService.java');
    expect(r.packageName).toBe('com.example.svc');
    expect(r.imports).toContain('com.example.svc.BaseService');
    expect(r.imports).toContain('com.example.svc.UserRepository');
    expect(r.imports).toContain('com.example.svc.UserDto');
  });

  it('qualifies bare annotation names as same-package FQCN', async () => {
    const r = await parseJ('com/example/svc/UserService.java');
    expect(r.imports).toContain('com.example.svc.Service');
  });

  it('shadowing: explicit import wins over same-package — no spurious edge', async () => {
    const r = await parseJ('com/example/svc/ShadowedClient.java');
    expect(r.packageName).toBe('com.example.svc');
    expect(r.imports).toContain('org.example.third_party.Logger');
    // Must NOT emit com.example.svc.Logger even though Logger.java exists in the package.
    expect(r.imports).not.toContain('com.example.svc.Logger');
  });

  it('cross-package types still need explicit import — no same-package leakage', async () => {
    const r = await parseJ('com/example/svc/UserService.java');
    expect(r.imports).not.toContain('com.example.other.Unrelated');
  });

  it('java.lang shortlist names are not qualified', async () => {
    const r = await parseJ('com/example/svc/UserService.java');
    expect(r.imports).not.toContain('com.example.svc.String');
    expect(r.imports).not.toContain('com.example.svc.Override');
  });

  it('default package file (no package declaration) emits no same-package qualifications', async () => {
    const r = await parseJ('DefaultPackage.java');
    expect(r.packageName).toBe('');
    expect(r.imports.some(i => i.startsWith('.'))).toBe(false);
    expect(r.imports.some(i => i.includes('SomeLocalType'))).toBe(false);
    expect(r.imports.some(i => i.includes('AnotherLocalType'))).toBe(false);
  });

  it('annotation type declaration with java.lang.annotation imports does not double-emit', async () => {
    const r = await parseJ('com/example/svc/Service.java');
    expect(r.packageName).toBe('com.example.svc');
    expect(r.imports).toContain('java.lang.annotation.Retention');
    expect(r.imports).toContain('java.lang.annotation.Target');
    // Retention / Target are explicit imports; same-package shadow guard prevents
    // qualifying them as com.example.svc.Retention.
    expect(r.imports).not.toContain('com.example.svc.Retention');
    expect(r.imports).not.toContain('com.example.svc.Target');
  });
});

// =============================================================================
// Kotlin
// =============================================================================

describe('Kotlin same-package short-name qualification', () => {
  it('qualifies bare supertypes and parameter types as same-package FQCN', async () => {
    const r = await parseK('com/example/svc/UserService.kt');
    expect(r.imports).toContain('com.example.svc.BaseService');
    expect(r.imports).toContain('com.example.svc.UserRepository');
    expect(r.imports).toContain('com.example.svc.UserDto');
  });

  it('qualifies bare annotation names as same-package FQCN', async () => {
    const r = await parseK('com/example/svc/UserService.kt');
    expect(r.imports).toContain('com.example.svc.Service');
  });

  it('shadowing: explicit Kotlin import wins over same-package', async () => {
    const r = await parseK('com/example/svc/ShadowedClient.kt');
    expect(r.imports).toContain('org.example.third_party.Logger');
    expect(r.imports).not.toContain('com.example.svc.Logger');
  });

  it('cross-package types still need explicit import', async () => {
    const r = await parseK('com/example/svc/UserService.kt');
    expect(r.imports).not.toContain('com.example.other.Unrelated');
  });

  it('Kotlin built-ins (String, Long, Int) are not qualified', async () => {
    const r = await parseK('com/example/svc/UserService.kt');
    expect(r.imports).not.toContain('com.example.svc.String');
    expect(r.imports).not.toContain('com.example.svc.Long');
    expect(r.imports).not.toContain('com.example.svc.Int');
  });
});
