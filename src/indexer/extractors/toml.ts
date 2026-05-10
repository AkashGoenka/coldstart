import type { SymbolNode } from '../../types.js';

export interface TomlParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

function stripComments(content: string): string {
  return content.replace(/#[^\n]*/g, '');
}

export function parseTomlContent(content: string, fileId: string): TomlParseResult {
  const lines = content.split('\n');
  const stripped = stripComments(content);
  const strippedLines = stripped.split('\n');

  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();

  let currentSection = '';

  for (let i = 0; i < strippedLines.length; i++) {
    const line = strippedLines[i];
    if (!line.trim()) continue;

    // Section header: [section] or [section.subsection]
    const sectionMatch = line.match(/^\[([a-zA-Z_][a-zA-Z0-9._-]*)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      currentSection = sectionName;
      if (!seen.has(sectionName)) {
        seen.add(sectionName);
        symbols.push({
          id: `${fileId}#${sectionName}`,
          name: sectionName,
          kind: 'constant',
          startLine: i + 1,
          endLine: i + 1,
          isExported: true,
          calls: [],
          implementsNames: [],
        });
      }
      continue;
    }

    // Array-of-tables: [[section]]
    const tableMatch = line.match(/^\[\[([a-zA-Z_][a-zA-Z0-9._-]*)\]\]$/);
    if (tableMatch) {
      const tableName = tableMatch[1];
      currentSection = tableName;
      if (!seen.has(tableName)) {
        seen.add(tableName);
        symbols.push({
          id: `${fileId}#${tableName}`,
          name: tableName,
          kind: 'constant',
          startLine: i + 1,
          endLine: i + 1,
          isExported: true,
          calls: [],
          implementsNames: [],
        });
      }
      continue;
    }

    // Key-value pair: key = value
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=/);
    if (keyMatch) {
      const keyName = keyMatch[1];
      const fullName = currentSection ? `${currentSection}.${keyName}` : keyName;
      if (!seen.has(fullName)) {
        seen.add(fullName);
        symbols.push({
          id: `${fileId}#${fullName}`,
          name: fullName,
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
