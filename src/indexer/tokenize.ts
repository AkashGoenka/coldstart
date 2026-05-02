import { basename, extname } from 'node:path';
import type { DomainEvidence } from '../types.js';

const STOP_WORDS = new Set([
  'index', 'component', 'util', 'helper', 'default',
  'type', 'interface', 'class', 'function', 'const', 'enum',
  'module', 'export', 'import', 'test', 'spec', 'mock',
  'base', 'abstract', 'impl', 'main', 'app', 'core',
  'get', 'set', 'has', 'is', 'on', 'to', 'from', 'with',
  'new', 'init',
  'handler', 'wrapper', 'provider', 'manager',
  'props', 'state', 'context', 'config', 'options', 'params',
]);

const GENERIC_DIRS = new Set([
  'src', 'lib', 'app', 'apps', 'packages', 'pkg', 'source', 'code',
  'components', 'pages', 'views', 'screens', 'features',
]);

// Directory-entry filenames: when a file has one of these names, use the
// parent directory name instead for the 'filename' source token.
const DIR_ENTRY_NAMES = new Set(['index', '__init__', 'mod', 'page', 'route', 'layout', 'loading']);

// Words that, when found as a token in any path segment, mark a file as test infrastructure.
// Matched via tokenizeName so word-boundary splitting handles e2e-tests, __tests__, pageObjects etc.
const TEST_SEGMENT_WORDS = new Set([
  'test', 'tests', 'spec', 'specs', 'e2e', 'mock', 'mocks', 'fixture', 'fixtures',
  'stub', 'stubs', 'locator', 'locators', 'pageobject', 'pageobjects',
  'automation', 'cypress', 'playwright', 'selenium', 'nightwatch', 'webdriver',
]);

/**
 * Returns true if any directory segment in the relative path contains a test
 * infrastructure word (e.g. "e2e-tests/", "locators/", "__tests__/").
 * Works for any project structure — no hardcoded paths.
 */
export function isTestPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const filename = parts[parts.length - 1];

  // Check filename directly for .test., .spec., .mock. patterns (before extension stripping)
  // Can't use tokenizeName here — 'test'/'spec'/'mock' are stop words and get filtered out
  const filenameLower = filename.toLowerCase();
  if (/\.(test|spec|mock)\.[a-z]+$/.test(filenameLower)) return true;

  // Check all directory segments
  const dirParts = parts.slice(0, -1);
  for (const segment of dirParts) {
    const tokens = tokenizeName(segment);
    for (const token of tokens) {
      if (TEST_SEGMENT_WORDS.has(token)) return true;
    }
    // Also check the raw lowercased segment for compound words like "e2e" that survive intact
    const lower = segment.toLowerCase();
    if (TEST_SEGMENT_WORDS.has(lower)) return true;
  }
  return false;
}

/**
 * Split a name into lowercase tokens by camelCase, PascalCase, snake_case,
 * kebab-case, and dot boundaries. Filters out stop words and single-char tokens.
 */
export function tokenizeName(name: string): string[] {
  const parts = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_.\/]+/)
    .map(p => p.toLowerCase())
    .filter(p => p.length > 1 && !STOP_WORDS.has(p));

  return parts;
}

/**
 * Additive pluralization: for each token length >= 5, add the singular form
 * if the token ends in 's' or 'es' and the singular isn't already present.
 * Both forms coexist. Copies evidence counts from the plural origin entry.
 */
function addPlurals(map: Record<string, DomainEvidence>): void {
  for (const [token, evidence] of Object.entries(map)) {
    if (token.length < 5) continue;
    let singular: string | null = null;
    if (token.endsWith('es') && token.length > 4) {
      singular = token.slice(0, -2);
    } else if (token.endsWith('s')) {
      singular = token.slice(0, -1);
    }
    if (singular && singular.length >= 4 && !STOP_WORDS.has(singular) && !map[singular]) {
      map[singular] = { ...evidence };
    }
  }
}

/**
 * Build the domainMap Record<string, DomainEvidence> for a file from:
 * 1. Non-generic directory segments in the relative path (path source)
 * 2. Effective filename tokens (filename source, with dir-entry promotion)
 * 3. Exported symbol names (symbol source)
 *
 * Import specifiers are intentionally excluded: what a file imports describes
 * its dependencies, not its identity. Adding them caused high-fan-out files
 * (routers, layout roots, API clients) to match every query for the features
 * they depend on — pure noise. Identity comes from path and exports only.
 */
export function buildFileDomains(
  relativePath: string,
  exports: string[],
): Record<string, DomainEvidence> {
  const domainMap: Record<string, DomainEvidence> = {};

  function addToken(token: string, source: 'filename' | 'path' | 'symbol'): void {
    if (!domainMap[token]) domainMap[token] = { filename: 0, path: 0, symbol: 0 };
    domainMap[token][source]++;
  }

  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const dirParts = parts.slice(0, -1);
  const filenamePart = parts[parts.length - 1] ?? '';
  const filenameWithoutExt = basename(filenamePart, extname(filenamePart));
  const filenameLower = filenameWithoutExt.toLowerCase();

  // 1. Directory segments → path source
  for (const part of dirParts) {
    const lower = part.toLowerCase();
    if (!GENERIC_DIRS.has(lower)) {
      for (const token of tokenizeName(part)) {
        addToken(token, 'path');
      }
    }
  }

  // 2. Effective filename → filename source
  // If the filename is a directory-entry name, use parent dir name instead
  let effectiveFilename: string;
  if (DIR_ENTRY_NAMES.has(filenameLower)) {
    // Use the immediate parent directory name
    effectiveFilename = dirParts[dirParts.length - 1] ?? '';
  } else {
    effectiveFilename = filenameWithoutExt;
  }

  if (effectiveFilename) {
    const effLower = effectiveFilename.toLowerCase();
    if (!GENERIC_DIRS.has(effLower) && !STOP_WORDS.has(effLower)) {
      for (const token of tokenizeName(effectiveFilename)) {
        addToken(token, 'filename');
      }
      // Compound form
      const compound = effLower;
      if (compound.length > 3 && !STOP_WORDS.has(compound)) {
        addToken(compound, 'filename');
      }
    }
  }

  // 3. Exported symbol names → symbol source
  for (const exp of exports) {
    for (const token of tokenizeName(exp)) {
      addToken(token, 'symbol');
    }
    const fullLower = exp.toLowerCase();
    if (fullLower.length > 3 && !STOP_WORDS.has(fullLower)) {
      addToken(fullLower, 'symbol');
    }
  }

  // 4. Additive pluralization
  addPlurals(domainMap);

  return domainMap;
}
