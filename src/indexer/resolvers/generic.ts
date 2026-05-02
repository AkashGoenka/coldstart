import { dirname, resolve } from 'node:path';
import { tryResolveBase } from './shared.js';

/**
 * Generic resolver for languages that use relative or alias-based imports:
 * TypeScript, JavaScript, C#, PHP, Kotlin, Swift, Dart, C/C++, etc.
 *
 * Non-relative, non-aliased specifiers are treated as external packages.
 * Alias matching uses longest-prefix-first ordering; all targets are tried
 * in order so that fallback targets work when the primary doesn't exist.
 */
export async function resolveGeneric(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  aliasMap: Map<string, string[]>,
): Promise<string | null> {
  const isRelative = specifier.startsWith('.') || specifier.startsWith('/');

  if (!isRelative) {
    // Longest-prefix alias matching: sort keys by descending length so that
    // '@/components' beats '@' when both would match '@/components/Button'.
    const aliases = [...aliasMap.keys()].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      if (specifier !== alias && !specifier.startsWith(alias + '/')) continue;

      const suffix = specifier.slice(alias.length);
      for (const target of aliasMap.get(alias)!) {
        const base = resolve(dirname(fromFile), target + suffix);
        const result = tryResolveBase(base, fileIdSet, rootDir);
        if (result) return result;
      }
      // Alias matched but no target resolved — stop (don't fall through to other aliases)
      return null;
    }
    return null; // no alias matched → external package
  }

  const base = resolve(dirname(fromFile), specifier);
  return tryResolveBase(base, fileIdSet, rootDir);
}
