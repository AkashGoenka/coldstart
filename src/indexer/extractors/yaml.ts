import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yamlModule = require('@tree-sitter-grammars/tree-sitter-yaml') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let yamlParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!yamlParser) {
    yamlParser = new ParserCtor();
    yamlParser.setLanguage(yamlModule);
  }
  return yamlParser;
}

export interface YamlParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

/**
 * Pull the scalar key text from a `block_mapping_pair`'s key child.
 * Shape: pair → flow_node → plain_scalar → string_scalar (or similar).
 * Returns null if the key isn't a plain scalar (e.g. a complex/flow-style key).
 */
function getPairKey(pairNode: TSNode): string | null {
  const keyNode = pairNode.namedChild(0);
  if (!keyNode) return null;
  const text = keyNode.text;
  if (!text) return null;
  const trimmed = text.trim();
  if (!/^[A-Za-z_][\w-]*$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Find the first `block_mapping` reachable through nested `block_node` wrappers.
 * Returns null if the value isn't a mapping (scalar, sequence, etc).
 */
function findBlockMapping(node: TSNode): TSNode | null {
  if (!node) return null;
  if (node.type === 'block_mapping') return node;
  if (node.type === 'block_node' || node.type === 'flow_node') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const found = findBlockMapping(node.namedChild(i));
      if (found) return found;
    }
  }
  return null;
}

function findTopLevelMapping(root: TSNode): TSNode | null {
  if (!root) return null;
  if (root.type === 'block_mapping') return root;
  for (let i = 0; i < root.namedChildCount; i++) {
    const found = findTopLevelMapping(root.namedChild(i));
    if (found) return found;
  }
  return null;
}

export function parseYamlContent(content: string, fileId: string): YamlParseResult {
  const parser = getParser();
  const tree = parser.parse(content);

  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();

  const topMapping = findTopLevelMapping(tree.rootNode);
  if (!topMapping) {
    return { imports: [], exports: [], hasDefaultExport: false, symbols };
  }

  for (let i = 0; i < topMapping.namedChildCount; i++) {
    const pair = topMapping.namedChild(i);
    if (pair.type !== 'block_mapping_pair') continue;

    const key = getPairKey(pair);
    if (!key) continue;

    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        id: `${fileId}#${key}`,
        name: key,
        kind: 'constant',
        startLine: pair.startPosition.row + 1,
        endLine: pair.startPosition.row + 1,
        isExported: true,
        calls: [],
        implementsNames: [],
      });
    }

    const valueNode = pair.namedChild(1);
    const nested = valueNode ? findBlockMapping(valueNode) : null;
    if (!nested) continue;

    for (let j = 0; j < nested.namedChildCount; j++) {
      const sub = nested.namedChild(j);
      if (sub.type !== 'block_mapping_pair') continue;
      const subKey = getPairKey(sub);
      if (!subKey) continue;
      const fullName = `${key}.${subKey}`;
      if (seen.has(fullName)) continue;
      seen.add(fullName);
      symbols.push({
        id: `${fileId}#${fullName}`,
        name: fullName,
        kind: 'constant',
        startLine: sub.startPosition.row + 1,
        endLine: sub.startPosition.row + 1,
        isExported: true,
        calls: [],
        implementsNames: [],
      });
    }
  }

  return {
    imports: [],
    exports: symbols.map(s => s.name),
    hasDefaultExport: false,
    symbols,
  };
}
