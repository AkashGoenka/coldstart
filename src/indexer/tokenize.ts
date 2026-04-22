import { basename, extname } from 'node:path';
import type { DomainToken, TokenSource } from '../types.js';

const STOP_WORDS = new Set([
  'index', 'component', 'service', 'util', 'helper', 'default',
  'type', 'interface', 'class', 'function', 'const', 'enum',
  'module', 'export', 'import', 'test', 'spec', 'mock',
  'base', 'abstract', 'impl', 'main', 'app', 'core',
  'get', 'set', 'has', 'is', 'on', 'to', 'from', 'with',
  'new', 'create', 'build', 'make', 'init', 'setup',
  'handler', 'wrapper', 'factory', 'provider', 'manager',
  'props', 'state', 'context', 'config', 'options', 'params',
]);

const GENERIC_DIRS = new Set([
  'src', 'lib', 'app', 'apps', 'packages', 'pkg', 'source', 'code',
  'components', 'pages', 'views', 'screens', 'features',
]);

// Directory-entry filenames: when a file has one of these names, use the
// parent directory name instead for the 'filename' source token.
const DIR_ENTRY_NAMES = new Set(['index', '__init__', 'mod']);

const SOURCE_ORDER: TokenSource[] = ['filename', 'path', 'symbol', 'import'];

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
 * Both forms coexist.
 */
function addPlurals(map: Map<string, Set<TokenSource>>): void {
  for (const [token, sources] of [...map.entries()]) {
    if (token.length < 5) continue;
    let singular: string | null = null;
    if (token.endsWith('es') && token.length > 4) {
      singular = token.slice(0, -2);
    } else if (token.endsWith('s')) {
      singular = token.slice(0, -1);
    }
    if (singular && singular.length >= 4 && !STOP_WORDS.has(singular) && !map.has(singular)) {
      map.set(singular, new Set(sources));
    }
  }
}

function sortSources(sources: Set<TokenSource>): TokenSource[] {
  return SOURCE_ORDER.filter(s => sources.has(s));
}

/**
 * Build the domains DomainToken[] for a file from:
 * 1. Non-generic directory segments in the relative path (path source)
 * 2. Effective filename tokens (filename source, with dir-entry promotion)
 * 3. Exported symbol names (symbol source)
 *
 * Import tokens are added separately in src/index.ts after import resolution.
 */
export function buildFileDomains(
  relativePath: string,
  exports: string[],
): DomainToken[] {
  const tokenMap = new Map<string, Set<TokenSource>>();

  function addToken(token: string, source: TokenSource): void {
    if (!tokenMap.has(token)) tokenMap.set(token, new Set());
    tokenMap.get(token)!.add(source);
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
  addPlurals(tokenMap);

  // Convert to sorted DomainToken[]
  const result: DomainToken[] = [];
  for (const [token, sources] of tokenMap) {
    result.push({ token, sources: sortSources(sources) });
  }
  result.sort((a, b) => a.token.localeCompare(b.token));

  return result;
}
