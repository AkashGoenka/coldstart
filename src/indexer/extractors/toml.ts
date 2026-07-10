import tomlDefault from '@tree-sitter-grammars/tree-sitter-toml';
import type { SymbolNode } from '../../types.js';
import { makeParser } from './parser-factory.js';

const tomlModule = tomlDefault as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

const getParser = makeParser(tomlModule);

export interface TomlParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

/**
 * Resolve a key node (`bare_key`, `quoted_key`, or `dotted_key`) into its dotted string form.
 */
function getKeyText(keyNode: TSNode): string | null {
  if (!keyNode) return null;
  if (keyNode.type === 'bare_key') return keyNode.text;
  if (keyNode.type === 'quoted_key') return keyNode.text.replace(/^["']|["']$/g, '');
  if (keyNode.type === 'dotted_key') {
    const parts: string[] = [];
    for (let i = 0; i < keyNode.namedChildCount; i++) {
      const part = getKeyText(keyNode.namedChild(i));
      if (part) parts.push(part);
    }
    return parts.length ? parts.join('.') : null;
  }
  return null;
}

export function parseTomlContent(content: string, fileId: string): TomlParseResult {
  const parser = getParser();
  const tree = parser.parse(content);
  const root = tree.rootNode;

  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();

  function pushSymbol(name: string, line: number) {
    if (seen.has(name)) return;
    seen.add(name);
    symbols.push({
      id: `${fileId}#${name}`,
      name,
      kind: 'constant',
      startLine: line,
      endLine: line,
      isExported: true,
      calls: [],
      implementsNames: [],
    });
  }

  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);

    // Top-level key/value pair (no enclosing table)
    if (node.type === 'pair') {
      const key = getKeyText(node.namedChild(0));
      if (key) pushSymbol(key, node.startPosition.row + 1);
      continue;
    }

    // Table: [section] or [section.subsection]
    // Array-of-tables: [[section]]
    if (node.type === 'table' || node.type === 'table_array_element') {
      const sectionNode = node.namedChild(0);
      const sectionName = getKeyText(sectionNode);
      if (!sectionName) continue;

      pushSymbol(sectionName, node.startPosition.row + 1);

      for (let j = 1; j < node.namedChildCount; j++) {
        const child = node.namedChild(j);
        if (child.type !== 'pair') continue;
        const key = getKeyText(child.namedChild(0));
        if (!key) continue;
        pushSymbol(`${sectionName}.${key}`, child.startPosition.row + 1);
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
