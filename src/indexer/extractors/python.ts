import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pythonGrammar = require('tree-sitter-python') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pythonParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!pythonParser) {
    pythonParser = new ParserCtor();
    pythonParser.setLanguage(pythonGrammar);
  }
  return pythonParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

function childrenOfType(node: TSNode, type: string): TSNode[] {
  return node.namedChildren.filter((c: TSNode) => c.type === type);
}

/** Return true if a name is considered public (no leading underscore). */
function isPublicName(name: string): boolean {
  return !name.startsWith('_');
}

/** Extract string values from a __all__ list literal. */
function extractAllList(node: TSNode): string[] {
  // node is assignment: __all__ = [...]
  const right = node.namedChildren[node.namedChildren.length - 1];
  if (!right) return [];
  const results: string[] = [];
  for (const child of right.namedChildren) {
    if (child.type === 'string') {
      // string content is inside a string_content child or we can strip quotes from text
      const text = child.text.replace(/^['"]|['"]$/g, '');
      results.push(text);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PythonParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
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

export function parsePythonContent(
  content: string,
  fileId: string,
): PythonParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Python (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  let allList: string[] | null = null;

  for (const node of root.namedChildren) {
    // from X import Y  /  import X
    if (node.type === 'import_from_statement') {
      const moduleNode = firstChildOfType(node, 'dotted_name') ??
        firstChildOfType(node, 'relative_import');
      if (moduleNode) imports.push(moduleNode.text);
      continue;
    }
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          const name = child.type === 'aliased_import'
            ? firstChildOfType(child, 'dotted_name')?.text ?? child.text
            : child.text;
          imports.push(name);
        }
      }
      continue;
    }

    // __all__ = [...]
    if (node.type === 'expression_statement') {
      const assign = firstChildOfType(node, 'assignment');
      if (assign) {
        const lhs = assign.namedChildren[0];
        if (lhs?.text === '__all__') {
          allList = extractAllList(assign);
        }
      }
      continue;
    }

    // Top-level class
    if (node.type === 'class_definition') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) continue;
      const className = nameNode.text;
      const pub = isPublicName(className);

      // Inheritance: argument_list contains the base classes
      let extendsName: string | undefined;
      const argList = firstChildOfType(node, 'argument_list');
      if (argList) {
        const firstBase = argList.namedChildren.find(
          (c: TSNode) => c.type === 'identifier' || c.type === 'attribute',
        );
        if (firstBase) extendsName = firstBase.text;
      }

      symbols.push({
        id: `${fileId}#${className}`,
        name: className,
        kind: 'class',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: pub,
        calls: [],
        extendsName,
        implementsNames: [],
      });

      // Extract methods from class body
      const body = firstChildOfType(node, 'block');
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === 'function_definition' || member.type === 'decorated_definition') {
            const fnNode = member.type === 'decorated_definition'
              ? firstChildOfType(member, 'function_definition')
              : member;
            if (!fnNode) continue;
            const fnName = firstChildOfType(fnNode, 'identifier');
            if (!fnName) continue;
            symbols.push({
              id: `${fileId}#${className}.${fnName.text}`,
              name: `${className}.${fnName.text}`,
              kind: 'method',
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              isExported: false,
              calls: [],
              implementsNames: [],
            });
          }
        }
      }
      continue;
    }

    // Top-level function
    if (node.type === 'function_definition' || node.type === 'decorated_definition') {
      const fnNode = node.type === 'decorated_definition'
        ? firstChildOfType(node, 'function_definition')
        : node;
      if (!fnNode) continue;
      const nameNode = firstChildOfType(fnNode, 'identifier');
      if (!nameNode) continue;
      const fnName = nameNode.text;
      symbols.push({
        id: `${fileId}#${fnName}`,
        name: fnName,
        kind: 'function',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: isPublicName(fnName),
        calls: [],
        implementsNames: [],
      });
      continue;
    }
  }

  // Determine exports: __all__ takes precedence; otherwise all public symbols
  let exports: string[];
  if (allList !== null) {
    exports = allList;
  } else {
    exports = symbols
      .filter(s => s.isExported && s.kind !== 'method')
      .map(s => s.name);
  }

  // Mark isExported on symbols based on __all__ when present
  if (allList !== null) {
    const allSet = new Set(allList);
    for (const sym of symbols) {
      if (sym.kind !== 'method') {
        sym.isExported = allSet.has(sym.name);
      }
    }
  }

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
  };
}

// Helper used by tests only
export function _childrenOfType(node: TSNode, type: string): TSNode[] {
  return childrenOfType(node, type);
}
