import { dirname, resolve } from 'node:path';
import { tryResolveBase } from './shared.js';

/**
 * Generic resolver for languages that use relative or alias-based imports:
 * TypeScript, JavaScript, C#, PHP, Kotlin, Swift, Dart, C/C++, etc.
 *
 * Non-relative, non-aliased specifiers are treated as external packages.
 */
export async function resolveGeneric(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  aliasMap: Map<string, string>,
): Promise<string | null> {
  const isRelative = specifier.startsWith('.') || specifier.startsWith('/');

  if (!isRelative) {
    let resolvedSpecifier = specifier;
    let matched = false;
    for (const [alias, target] of aliasMap) {
      if (specifier === alias || specifier.startsWith(alias + '/')) {
        resolvedSpecifier = target + specifier.slice(alias.length);
        matched = true;
        break;
      }
    }
    if (!matched) return null;
    specifier = resolvedSpecifier;
  }

  const base = resolve(dirname(fromFile), specifier);
  return tryResolveBase(base, fileIdSet, rootDir);
}
