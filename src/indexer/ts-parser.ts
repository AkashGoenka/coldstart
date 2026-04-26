/**
 * Tree-sitter based parser for TypeScript and JavaScript.
 * Extracts symbol-level nodes (functions, classes, interfaces, types, constants)
 * and their relationships (calls, extends, implements).
 *
 * This supplements the regex parser in parser.ts for TS/JS files only.
 */
import { createRequire } from 'node:module';
import type { SymbolNode, SymbolKind } from '../types.js';

// Native addons need createRequire in an ESM context
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { typescript: tsGrammar, tsx: tsxGrammar } = require('tree-sitter-typescript') as {
  typescript: unknown;
  tsx: unknown;
};

// Re-use a single parser instance (not thread-safe but Node.js is single-threaded)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tsParser: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tsxParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(isTsx: boolean): any {
  try {
    if (isTsx) {
      if (!tsxParser) {
        tsxParser = new ParserCtor();
        tsxParser.setLanguage(tsxGrammar);
      }
      return tsxParser;
    }
    if (!tsParser) {
      tsParser = new ParserCtor();
      tsParser.setLanguage(tsGrammar);
    }
    return tsParser;
  } catch (err) {
    throw new Error(`Failed to initialize Tree-sitter parser: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

function childrenOfType(node: TSNode, type: string): TSNode[] {
  return node.namedChildren.filter((c: TSNode) => c.type === type);
}

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

/** Extract identifier text from a node that might be 'identifier' or 'type_identifier'. */
function getNameText(node: TSNode): string | null {
  if (!node) return null;
  if (node.type === 'identifier' || node.type === 'type_identifier' || node.type === 'property_identifier') {
    return node.text;
  }
  // Check direct named children for the name
  const nameChild = node.namedChildren.find(
    (c: TSNode) => c.type === 'identifier' || c.type === 'type_identifier',
  );
  return nameChild?.text ?? null;
}

// ---------------------------------------------------------------------------
// Extract nested function/arrow declarations one level inside a function body.
// Returns symbols with id "fileId#parentName.innerName".
// ---------------------------------------------------------------------------
function extractNestedFunctions(
  body: TSNode,
  fileId: string,
  parentName: string,
): SymbolNode[] {
  const nested: SymbolNode[] = [];

  for (const child of body.namedChildren) {
    // Inner function declarations: function handleError() { ... }
    if (child.type === 'function_declaration' || child.type === 'generator_function_declaration') {
      const nameNode = firstChildOfType(child, 'identifier');
      if (!nameNode) continue;
      const innerName = nameNode.text;
      const calls = new Set<string>();
      const innerBody = firstChildOfType(child, 'statement_block');
      if (innerBody) collectCalls(innerBody, calls);
      nested.push({
        id: `${fileId}#${parentName}.${innerName}`,
        name: `${parentName}.${innerName}`,
        kind: 'function',
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        isExported: false,
        calls: [...calls].filter(c => c !== innerName),
        implementsNames: [],
      });
      continue;
    }

    // Inner arrow/function expressions: const handleError = () => { ... }
    if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      const declarators = childrenOfType(child, 'variable_declarator');
      for (const declarator of declarators) {
        const nameNode = firstChildOfType(declarator, 'identifier');
        if (!nameNode) continue;
        const innerName = nameNode.text;
        const value = declarator.namedChildren.find(
          (c: TSNode) => c.type === 'arrow_function' || c.type === 'function_expression',
        );
        if (!value) continue;
        const calls = new Set<string>();
        const innerBody = firstChildOfType(value, 'statement_block');
        if (innerBody) collectCalls(innerBody, calls);
        nested.push({
          id: `${fileId}#${parentName}.${innerName}`,
          name: `${parentName}.${innerName}`,
          kind: 'function',
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          isExported: false,
          calls: [...calls].filter(c => c !== innerName),
          implementsNames: [],
        });
      }
    }
  }

  return nested;
}

// ---------------------------------------------------------------------------
// Walk a subtree and collect all call_expression callee names
// ---------------------------------------------------------------------------
function collectCalls(node: TSNode, results: Set<string>): void {
  if (node.type === 'call_expression') {
    const callee = node.namedChildren[0];
    if (callee?.type === 'identifier') {
      results.add(callee.text);
    } else if (callee?.type === 'member_expression') {
      // e.g. this.hashPassword(...) — take property name only
      const prop = callee.namedChildren.find((c: TSNode) => c.type === 'property_identifier');
      if (prop) results.add(prop.text);
    }
  }
  for (const child of node.namedChildren) {
    collectCalls(child, results);
  }
}

// ---------------------------------------------------------------------------
// Extract symbols from a declaration node (unwrapped from export_statement)
// ---------------------------------------------------------------------------
function extractFromDeclaration(
  decl: TSNode,
  fileId: string,
  isExported: boolean,
  allSymbolNames: Set<string>,
): SymbolNode | SymbolNode[] | null {
  const startLine = decl.startPosition.row + 1;
  const endLine = decl.endPosition.row + 1;

  switch (decl.type) {
    case 'function_declaration':
    case 'generator_function_declaration': {
      const namePart = firstChildOfType(decl, 'identifier');
      if (!namePart) return null;
      const name = namePart.text;
      const calls = new Set<string>();
      const body = firstChildOfType(decl, 'statement_block');
      if (body) collectCalls(body, calls);
      const parent: SymbolNode = {
        id: `${fileId}#${name}`,
        name,
        kind: 'function',
        startLine,
        endLine,
        isExported,
        calls: [...calls].filter(c => c !== name), // exclude self-recursion
        implementsNames: [],
      };
      const nested = body ? extractNestedFunctions(body, fileId, name) : [];
      return nested.length > 0 ? [parent, ...nested] : parent;
    }

    case 'class_declaration': {
      const nameNode = firstChildOfType(decl, 'type_identifier');
      if (!nameNode) return null;
      const name = nameNode.text;

      const heritage = firstChildOfType(decl, 'class_heritage');
      let extendsName: string | undefined;
      const implementsNames: string[] = [];

      if (heritage) {
        const extendsClause = firstChildOfType(heritage, 'extends_clause');
        if (extendsClause) {
          const extName = extendsClause.namedChildren.find(
            (c: TSNode) => c.type === 'identifier' || c.type === 'type_identifier',
          );
          if (extName) extendsName = extName.text;
        }
        const implClause = firstChildOfType(heritage, 'implements_clause');
        if (implClause) {
          for (const c of implClause.namedChildren) {
            const n = getNameText(c);
            if (n) implementsNames.push(n);
          }
        }
      }

      // Collect method symbols from the class body
      const body = firstChildOfType(decl, 'class_body');
      const symbols: SymbolNode[] = [
        {
          id: `${fileId}#${name}`,
          name,
          kind: 'class',
          startLine,
          endLine,
          isExported,
          calls: [],
          extendsName,
          implementsNames,
        },
      ];

      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'method_definition') {
            const methodName = firstChildOfType(child, 'property_identifier');
            if (!methodName || methodName.text === 'constructor') continue;
            const calls = new Set<string>();
            const methodBody = firstChildOfType(child, 'statement_block');
            if (methodBody) collectCalls(methodBody, calls);
            symbols.push({
              id: `${fileId}#${name}.${methodName.text}`,
              name: `${name}.${methodName.text}`,
              kind: 'method',
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              isExported: false, // methods are not directly exported
              calls: [...calls],
              implementsNames: [],
            });
          }
        }
      }

      return symbols;
    }

    case 'interface_declaration': {
      const nameNode = firstChildOfType(decl, 'type_identifier');
      if (!nameNode) return null;
      return {
        id: `${fileId}#${nameNode.text}`,
        name: nameNode.text,
        kind: 'interface',
        startLine,
        endLine,
        isExported,
        calls: [],
        implementsNames: [],
      };
    }

    case 'type_alias_declaration': {
      const nameNode = firstChildOfType(decl, 'type_identifier');
      if (!nameNode) return null;
      return {
        id: `${fileId}#${nameNode.text}`,
        name: nameNode.text,
        kind: 'type',
        startLine,
        endLine,
        isExported,
        calls: [],
        implementsNames: [],
      };
    }

    case 'lexical_declaration':
    case 'variable_declaration': {
      // May declare multiple variables: const a = 1, b = 2
      const declarators = childrenOfType(decl, 'variable_declarator');
      if (declarators.length === 0) return null;

      const nodes: SymbolNode[] = [];
      for (const declarator of declarators) {
        const nameNode = firstChildOfType(declarator, 'identifier');
        if (!nameNode) continue;
        const name = nameNode.text;
        // Detect arrow/function expression to extract nested functions
        const value = declarator.namedChildren.find(
          (c: TSNode) => c.type === 'arrow_function' || c.type === 'function_expression',
        );
        const body = value ? firstChildOfType(value, 'statement_block') : null;
        // Only track if it looks like a significant export (not just a primitive)
        nodes.push({
          id: `${fileId}#${name}`,
          name,
          kind: 'constant',
          startLine,
          endLine,
          isExported,
          calls: [],
          implementsNames: [],
        });
        if (body) {
          nodes.push(...extractNestedFunctions(body, fileId, name));
        }
      }
      return nodes.length === 1 ? nodes[0]! : nodes.length > 1 ? nodes : null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TsParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: boolean;
  symbols: SymbolNode[];
  reexportRatio: number;  // ratio of re-export statements (with 'from') to total export statements
}

// Tree-sitter's parse(string) has a 32KB limit — use chunked callback for larger files
const TS_MAX_STRING = 32000;
const TS_CHUNK_SIZE = 4096;

function parseContent(parser: TSNode, content: string): TSNode {
  if (content.length <= TS_MAX_STRING) {
    return parser.parse(content);
  }
  // Callback-based parse: tree-sitter calls this with an increasing startIndex
  // and we return a chunk of source each time, or null when done
  return parser.parse((startIndex: number) => {
    if (startIndex >= content.length) return null;
    return content.slice(startIndex, startIndex + TS_CHUNK_SIZE);
  });
}

export function parseTsContent(
  content: string,
  fileId: string,
  isTsx = false,
): TsParseResult {
  const parser = getParser(isTsx);
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse (${isTsx ? 'tsx' : 'ts'}, ${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const exports: string[] = [];
  let hasDefaultExport = false;
  const rawSymbols: SymbolNode[] = [];
  let totalExportStatements = 0;
  let reexportStatements = 0;

  // Collect all top-level declaration names first (for call resolution)
  const allSymbolNames = new Set<string>();

  // First pass: collect all top-level names so we can filter calls
  for (const node of root.namedChildren) {
    if (node.type === 'export_statement') {
      for (const child of node.namedChildren) {
        const name = getNameText(child) ?? firstChildOfType(child, 'identifier')?.text ?? firstChildOfType(child, 'type_identifier')?.text;
        if (name) allSymbolNames.add(name);
      }
    } else if (
      node.type === 'function_declaration' ||
      node.type === 'class_declaration' ||
      node.type === 'interface_declaration' ||
      node.type === 'type_alias_declaration' ||
      node.type === 'lexical_declaration'
    ) {
      const name = firstChildOfType(node, 'identifier')?.text ?? firstChildOfType(node, 'type_identifier')?.text;
      if (name) allSymbolNames.add(name);
    }
  }

  // Second pass: extract imports, exports, and symbols
  for (const node of root.namedChildren) {
    // -----------------------------------------------------------------------
    // Imports
    // -----------------------------------------------------------------------
    if (node.type === 'import_statement') {
      const src = firstChildOfType(node, 'string');
      if (src) {
        const frag = firstChildOfType(src, 'string_fragment');
        if (frag) imports.push(frag.text);
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // Export statements
    // -----------------------------------------------------------------------
    if (node.type === 'export_statement') {
      totalExportStatements++;
      // export * from 'Y' or export { X } from 'Y'
      const src = firstChildOfType(node, 'string');
      if (src) {
        const frag = firstChildOfType(src, 'string_fragment');
        if (frag) {
          imports.push(frag.text);
          reexportStatements++;
        }
      }

      // Check for `default` keyword
      const isDefault = node.namedChildren.some(
        (c: TSNode) => c.type === 'default' || (c.isNamed === false && c.text === 'default'),
      ) || node.text.startsWith('export default');
      if (isDefault) {
        hasDefaultExport = true;
        // `export default SomeName` — bare identifier, no declaration to extract from.
        // Mark the referenced symbol as exported so it appears in exports/symbols.
        const defaultValue = node.namedChildren.find(
          (c: TSNode) => c.type === 'identifier',
        );
        if (defaultValue && allSymbolNames.has(defaultValue.text)) {
          exports.push(defaultValue.text);
          // Mark the symbol as exported in rawSymbols (it was collected as non-exported)
          const existing = rawSymbols.find(s => s.name === defaultValue.text);
          if (existing) existing.isExported = true;
        }
      }

      // export { X, Y }
      const exportClause = firstChildOfType(node, 'export_clause');
      if (exportClause) {
        for (const spec of exportClause.namedChildren) {
          if (spec.type === 'export_specifier') {
            const name = spec.namedChildren[0];
            if (name) exports.push(name.text);
          }
        }
        continue;
      }

      // export function/class/interface/type/const ...
      for (const child of node.namedChildren) {
        const result = extractFromDeclaration(child, fileId, true, allSymbolNames);
        if (!result) continue;
        const nodes = Array.isArray(result) ? result : [result];
        for (const sym of nodes) {
          rawSymbols.push(sym);
          if (sym.isExported && sym.kind !== 'method') {
            exports.push(sym.name);
          }
        }
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // Non-exported top-level declarations (private symbols, still tracked)
    // -----------------------------------------------------------------------
    if (
      node.type === 'function_declaration' ||
      node.type === 'generator_function_declaration' ||
      node.type === 'class_declaration' ||
      node.type === 'interface_declaration' ||
      node.type === 'type_alias_declaration' ||
      node.type === 'lexical_declaration'
    ) {
      const result = extractFromDeclaration(node, fileId, false, allSymbolNames);
      if (!result) continue;
      const nodes = Array.isArray(result) ? result : [result];
      rawSymbols.push(...nodes);
    }
  }

  // Resolve intra-file calls: replace plain names with full symbol IDs where known
  const symbolIdByName = new Map<string, string>(rawSymbols.map(s => [s.name, s.id]));
  const resolvedSymbols = rawSymbols.map(sym => ({
    ...sym,
    calls: sym.calls.map(name => symbolIdByName.get(name) ?? name),
  }));

  const reexportRatio = totalExportStatements > 0 ? reexportStatements / totalExportStatements : 0;

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport,
    symbols: resolvedSymbols,
    reexportRatio,
  };
}
