import { basename, extname } from 'node:path';

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

/**
 * Split a name into lowercase tokens by camelCase, PascalCase, snake_case,
 * kebab-case, and dot boundaries. Filters out stop words and single-char tokens.
 */
export function tokenizeName(name: string): string[] {
  // Split on non-alphanumeric boundaries (kebab, snake, dot)
  // then split on camelCase/PascalCase transitions
  const parts = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // e.g. HTMLParser → HTML Parser
    .split(/[\s\-_.\/]+/)
    .map(p => p.toLowerCase())
    .filter(p => p.length > 1 && !STOP_WORDS.has(p));

  return parts;
}

/**
 * Build the domains keyword array for a file from two sources:
 * 1. Non-generic directory segments in the relative path
 * 2. Exported symbol names (tokenized, stop-words filtered)
 */
export function buildFileDomains(
  relativePath: string,
  exports: string[],
): string[] {
  const tokens = new Set<string>();

  // 1. Directory segments (skip filename, skip generic dirs)
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const dirParts = parts.slice(0, -1);
  for (const part of dirParts) {
    const lower = part.toLowerCase();
    if (!GENERIC_DIRS.has(lower)) {
      for (const token of tokenizeName(part)) {
        tokens.add(token);
      }
    }
  }

  // Also tokenize the filename itself (without extension)
  const filename = basename(normalized, extname(normalized));
  const filenameLower = filename.toLowerCase();
  if (!GENERIC_DIRS.has(filenameLower) && !STOP_WORDS.has(filenameLower)) {
    for (const token of tokenizeName(filename)) {
      tokens.add(token);
    }
  }

  // 2. Exported symbol names — split tokens + full lowercased name as a compound token
  for (const exp of exports) {
    for (const token of tokenizeName(exp)) {
      tokens.add(token);
    }
    // Also store the full name lowercased so compound queries can
    // match against the full symbol name via substring (d.includes(query))
    const fullLower = exp.toLowerCase();
    if (fullLower.length > 3 && !STOP_WORDS.has(fullLower)) {
      tokens.add(fullLower);
    }
  }

  return [...tokens].sort();
}
