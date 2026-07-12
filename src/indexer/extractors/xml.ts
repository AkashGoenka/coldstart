import type { SymbolNode } from '../../types.js';
import { childrenOfType, firstChildOfType } from './node-helpers.js';
import { makeParser } from './parser-factory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// The vendored tree-sitter-xml.wasm is the `xml` sub-grammar (not dtd).
const getParser = makeParser({ vendored: 'tree-sitter-xml.wasm' });

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface XmlParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the quoted string value from an AttValue node.
 * AttValue text includes the quotes, e.g., '"userService"' or "'foo'".
 */
function unquoteAttValue(text: string): string {
  return text.slice(1, -1);
}

/**
 * Check if attribute name matches a target after considering namespaces.
 * Matches 'id', 'name:id', 'android:id', etc.
 */
function attrNameMatches(attrName: string, targetName: string): boolean {
  return attrName === targetName || attrName.endsWith(`:${targetName}`);
}

/**
 * Walk element nodes recursively and extract symbols.
 * Skips prolog (comments) and only extracts from element nodes.
 */
function extractSymbolsFromElement(
  elemNode: TSNode,
  symbols: SymbolNode[],
  seen: Set<string>,
  fileId: string,
): void {
  // Find the tag node (STag for paired tags, EmptyElemTag for self-closing)
  const stag = firstChildOfType(elemNode, 'STag');
  const emptytag = firstChildOfType(elemNode, 'EmptyElemTag');
  const tagNode = stag || emptytag;

  if (tagNode) {
    const nameNode = firstChildOfType(tagNode, 'Name');
    const tagName = nameNode?.text ?? '';

    // Visit attributes for id/name/key/ref and class (they're children of the tag node)
    const attrs = childrenOfType(tagNode, 'Attribute');
    for (const attr of attrs) {
      const attrNameNode = firstChildOfType(attr, 'Name');
      const valueNode = firstChildOfType(attr, 'AttValue');
      if (!attrNameNode || !valueNode) continue;

      const attrName = attrNameNode.text;
      const rawValue = valueNode.text;
      const value = unquoteAttValue(rawValue);

      // Extract id/name/key/ref attribute values (handle namespaced attributes like android:id)
      if (
        (attrNameMatches(attrName, 'id') || attrNameMatches(attrName, 'name') ||
          attrNameMatches(attrName, 'key') || attrNameMatches(attrName, 'ref')) &&
        value
      ) {
        if (!seen.has(value)) {
          seen.add(value);
          symbols.push({
            id: `${fileId}#${value}`,
            name: value,
            kind: 'constant',
            startLine: attr.startPosition.row + 1,
            endLine: attr.endPosition.row + 1,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
        }
      }

      // Extract class="..." — take the last segment after dots
      if (attrName === 'class' && value) {
        const lastSegment = value.split('.').pop() || '';
        if (lastSegment && !seen.has(lastSegment)) {
          seen.add(lastSegment);
          symbols.push({
            id: `${fileId}#${lastSegment}`,
            name: lastSegment,
            kind: 'constant',
            startLine: attr.startPosition.row + 1,
            endLine: attr.endPosition.row + 1,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
        }
      }
    }

    // Check element tag name for Maven coords (artifactId, groupId)
    if (tagName === 'artifactId' || tagName === 'groupId') {
      // Extract text content from child CharData nodes
      const content = firstChildOfType(elemNode, 'content');
      if (content) {
        const charData = childrenOfType(content, 'CharData');
        for (const cd of charData) {
          const text = cd.text.trim();
          if (text && !seen.has(text)) {
            seen.add(text);
            symbols.push({
              id: `${fileId}#${text}`,
              name: text,
              kind: 'constant',
              startLine: cd.startPosition.row + 1,
              endLine: cd.endPosition.row + 1,
              isExported: true,
              calls: [],
              implementsNames: [],
            });
          }
        }
      }
    }
  }

  // Recursively visit nested elements
  // They can be direct children or inside a content node
  let childrenToVisit = childrenOfType(elemNode, 'element');
  if (childrenToVisit.length === 0) {
    const content = firstChildOfType(elemNode, 'content');
    if (content) {
      childrenToVisit = childrenOfType(content, 'element');
    }
  }
  for (const child of childrenToVisit) {
    extractSymbolsFromElement(child, symbols, seen, fileId);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_STRING = 32000;
const CHUNK_SIZE = 4096;

function parseContent(parser: TSNode, content: string): TSNode {
  if (content.length <= MAX_STRING) {
    return parser.parse(content);
  }
  return parser.parse((startIndex: number) => {
    if (startIndex >= content.length) return null;
    return content.slice(startIndex, startIndex + CHUNK_SIZE);
  });
}

export function parseXmlContent(
  content: string,
  fileId: string,
): XmlParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse XML (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();

  // Walk top-level children: skip prolog (comments), extract from elements
  for (const node of root.namedChildren) {
    if (node.type === 'element') {
      extractSymbolsFromElement(node, symbols, seen, fileId);
    }
    // Skip prolog and other non-element nodes
  }

  return {
    imports: [],
    exports: symbols.map(s => s.name),
    hasDefaultExport: false,
    symbols,
  };
}
