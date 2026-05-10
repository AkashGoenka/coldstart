import type { SymbolNode } from '../../types.js';

export interface GraphQLParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

/**
 * Strip GraphQL line comments (`# ...`) so they don't interfere with regex matches.
 * Block comments don't exist in GraphQL.
 */
function stripComments(content: string): string {
  return content.replace(/#[^\n]*/g, '');
}

/**
 * Lightweight regex extractor for GraphQL SDL / operations / fragments.
 *
 * Surfaces:
 *   - Operation names:  `query Foo { ... }`, `mutation Bar(...) { ... }`, `subscription Baz { ... }`
 *   - Fragment names:   `fragment FooFields on Type { ... }`
 *   - Type-system defs: `type X`, `interface X`, `enum X`, `input X`, `scalar X`, `union X`
 *
 * Imports: graphql-tag's loader convention `#import './foo.graphql'` is common in JS
 * tooling — capture those so trace-deps works across .graphql files.
 *
 * Anonymous operations (`{ field }`) produce no symbol; we skip them.
 */
export function parseGraphQLContent(content: string, fileId: string): GraphQLParseResult {
  const lines = content.split('\n');
  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();

  // #import './path.graphql' or #import "./path.graphql"
  const importRe = /^\s*#\s*import\s+['"]([^'"]+)['"]/;
  for (const line of lines) {
    const m = line.match(importRe);
    if (m) imports.push(m[1]);
  }

  const stripped = stripComments(content);

  // Match named definitions. Capture: keyword, name, opening brace position.
  // Keywords: query|mutation|subscription|fragment|type|interface|enum|input|scalar|union
  const defRe =
    /\b(query|mutation|subscription|fragment|type|interface|enum|input|scalar|union)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;

  let m: RegExpExecArray | null;
  while ((m = defRe.exec(stripped)) !== null) {
    const keyword = m[1];
    const name = m[2];

    if (seen.has(name)) continue;
    seen.add(name);

    const startOffset = m.index;
    const startLine = stripped.slice(0, startOffset).split('\n').length;

    // Find the matching closing brace, if there is a body. Scalar/union/extend may have none.
    const braceStart = stripped.indexOf('{', startOffset);
    let endLine = startLine;
    if (braceStart !== -1 && braceStart - startOffset < 200) {
      let depth = 0;
      for (let i = braceStart; i < stripped.length; i++) {
        const ch = stripped[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            endLine = stripped.slice(0, i).split('\n').length;
            break;
          }
        }
      }
    }

    const kind: SymbolNode['kind'] =
      keyword === 'fragment' ? 'constant' :
      keyword === 'query' || keyword === 'mutation' || keyword === 'subscription' ? 'function' :
      keyword === 'interface' ? 'interface' :
      keyword === 'enum' || keyword === 'union' || keyword === 'scalar' ? 'type' :
      keyword === 'input' || keyword === 'type' ? 'class' :
      'constant';

    symbols.push({
      id: `${fileId}#${name}`,
      name,
      kind,
      startLine,
      endLine,
      isExported: true,
      calls: [],
      implementsNames: [],
    });
  }

  return {
    imports,
    exports: symbols.map(s => s.name),
    hasDefaultExport: false,
    symbols,
  };
}
