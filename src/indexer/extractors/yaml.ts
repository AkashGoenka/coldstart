import type { SymbolNode } from '../../types.js';

export interface YamlParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

function stripComments(content: string): string {
  return content.replace(/#[^\n]*/g, '');
}

export function parseYamlContent(content: string, fileId: string): YamlParseResult {
  const lines = content.split('\n');
  const stripped = stripComments(content);
  const strippedLines = stripped.split('\n');

  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();

  const topLevelKeys = new Map<string, number>();
  let detectedIndent = 0;

  for (let i = 0; i < strippedLines.length; i++) {
    const line = strippedLines[i];
    if (!line.trim()) continue;

    const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0;

    // Top-level key: column 0, format: key:
    if (leadingSpaces === 0) {
      const match = line.match(/^([A-Za-z_][\w-]*):/);
      if (match) {
        const keyName = match[1];
        if (!seen.has(keyName)) {
          seen.add(keyName);
          topLevelKeys.set(keyName, i);
          symbols.push({
            id: `${fileId}#${keyName}`,
            name: keyName,
            kind: 'constant',
            startLine: i + 1,
            endLine: i + 1,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
        }
      }
      continue;
    }

    // Skip list items (start with - )
    if (line.trimStart().startsWith('-')) continue;

    // Detect indentation from first nested key if not already detected
    if (!detectedIndent && leadingSpaces > 0) {
      detectedIndent = leadingSpaces;
    }

    // Nested key: indented, format: key:
    if (detectedIndent && leadingSpaces === detectedIndent) {
      const match = line.match(/^(\s*)([A-Za-z_][\w-]*):/);
      if (match) {
        // Find the parent (most recent top-level key before this line)
        let parentKey = '';
        for (const [key, lineNum] of Array.from(topLevelKeys.entries()).reverse()) {
          if (lineNum < i) {
            parentKey = key;
            break;
          }
        }

        if (parentKey) {
          const nestedKeyName = match[2];
          const fullName = `${parentKey}.${nestedKeyName}`;
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
    }
  }

  return {
    imports: [],
    exports: symbols.map(s => s.name),
    hasDefaultExport: false,
    symbols,
  };
}
