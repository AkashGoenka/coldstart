import type { SymbolNode } from '../../types.js';

export interface EnvParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

export function parseEnvContent(content: string, fileId: string): EnvParseResult {
  const lines = content.split('\n');
  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Strip comments
    const commentIdx = line.indexOf('#');
    const lineToParse = commentIdx >= 0 ? line.slice(0, commentIdx) : line;

    if (!lineToParse.trim()) continue;

    // Strip leading "export " if present
    let content = lineToParse.trim();
    if (content.startsWith('export ')) {
      content = content.slice(7).trim();
    }

    // Match: VAR_NAME = value
    const match = content.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=|$)/);
    if (match) {
      const varName = match[1];
      if (!seen.has(varName)) {
        seen.add(varName);
        symbols.push({
          id: `${fileId}#${varName}`,
          name: varName,
          kind: 'constant',
          startLine: i + 1,
          endLine: i + 1,
          isExported: true,
          calls: [],
          implementsNames: [],
        });
      }
    }
  }

  return {
    imports: [],
    exports: symbols.map(s => s.name),
    hasDefaultExport: false,
    symbols,
  };
}
