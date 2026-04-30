import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cppGrammar = require('tree-sitter-cpp') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cppParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!cppParser) {
    cppParser = new ParserCtor();
    cppParser.setLanguage(cppGrammar);
  }
  return cppParser;
}

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

export interface CppParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

const MAX_STRING = 32000;
const CHUNK_SIZE = 4096;

function parseContent(parser: TSNode, content: string): TSNode {
  if (content.length <= MAX_STRING) return parser.parse(content);
  return parser.parse((startIndex: number) => {
    if (startIndex >= content.length) return null;
    return content.slice(startIndex, startIndex + CHUNK_SIZE);
  });
}

function extractName(node: TSNode): string | null {
  // Walk into pointer/reference declarators to find the actual identifier
  if (node.type === 'identifier' || node.type === 'field_identifier') return node.text;
  if (node.type === 'qualified_identifier') {
    // A::B → use just B for the symbol name
    const id = node.namedChildren.at(-1);
    return id ? extractName(id) : null;
  }
  if (node.type === 'pointer_declarator' || node.type === 'reference_declarator') {
    return extractName(node.namedChildren[0]);
  }
  if (node.type === 'function_declarator') {
    return extractName(firstChildOfType(node, 'identifier') ??
      firstChildOfType(node, 'qualified_identifier') ??
      node.namedChildren[0]);
  }
  return null;
}

export function parseCppContent(content: string, fileId: string): CppParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse C++ (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  function visit(node: TSNode, scope?: string): void {
    // Skip ERROR subtrees — macro-expanded code often produces these
    if (node.type === 'ERROR') return;

    const startLine = node.startPosition.row + 1;
    const endLine   = node.endPosition.row + 1;

    // #include "foo.h" or #include "../utils/bar.hpp"
    if (node.type === 'preproc_include') {
      const pathNode = firstChildOfType(node, 'string_literal');
      if (pathNode) {
        // Strip surrounding quotes
        const raw = pathNode.text.replace(/^"|"$/g, '');
        if (raw) imports.push(raw);
      }
      // angle-bracket includes (<vector>) are system headers — skip
      return;
    }

    // class Foo / struct Foo
    if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (nameNode && node.type !== 'ERROR') {
        const name = scope ? `${scope}::${nameNode.text}` : nameNode.text;
        symbols.push({
          id: `${fileId}#${name}`,
          name,
          kind: 'class',
          startLine,
          endLine,
          isExported: true,
          calls: [],
          implementsNames: [],
        });
        exports.push(nameNode.text);
        // Recurse into body for nested declarations
        const body = firstChildOfType(node, 'field_declaration_list');
        if (body) {
          for (const child of body.namedChildren) visit(child, nameNode.text);
        }
      }
      return;
    }

    // Function / method definition: return_type declarator body
    if (node.type === 'function_definition') {
      const declarator = node.namedChildren.find(
        (c: TSNode) => c.type === 'function_declarator' ||
          c.type === 'pointer_declarator' ||
          c.type === 'reference_declarator',
      );
      if (declarator) {
        const name = extractName(declarator);
        if (name) {
          const qualName = scope ? `${scope}::${name}` : name;
          symbols.push({
            id: `${fileId}#${qualName}`,
            name: qualName,
            kind: scope ? 'method' : 'function',
            startLine,
            endLine,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
          if (!scope) exports.push(name);
        }
      }
      return;
    }

    // namespace Foo { ... } — recurse with scope
    if (node.type === 'namespace_definition') {
      const nameNode = firstChildOfType(node, 'namespace_identifier') ?? firstChildOfType(node, 'identifier');
      const body = firstChildOfType(node, 'declaration_list');
      if (body) {
        const nsName = nameNode?.text;
        for (const child of body.namedChildren) visit(child, nsName);
      }
      return;
    }

    // extern "C" { ... } — recurse without new scope
    if (node.type === 'linkage_specification') {
      const body = firstChildOfType(node, 'declaration_list');
      if (body) for (const child of body.namedChildren) visit(child, scope);
      return;
    }
  }

  for (const node of root.namedChildren) visit(node);

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
  };
}
