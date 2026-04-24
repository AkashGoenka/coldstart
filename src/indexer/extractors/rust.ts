import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rustGrammar = require('tree-sitter-rust') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rustParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!rustParser) {
    rustParser = new ParserCtor();
    rustParser.setLanguage(rustGrammar);
  }
  return rustParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

function hasVisibilityPub(node: TSNode): boolean {
  // In tree-sitter-rust, `pub` appears as a visibility_modifier named child
  return node.namedChildren.some((c: TSNode) => c.type === 'visibility_modifier');
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RustParseResult {
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

export function parseRustContent(
  content: string,
  fileId: string,
): RustParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Rust (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  function visitNode(node: TSNode, parentName?: string): void {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // use X::Y
    if (node.type === 'use_declaration') {
      const arg = node.namedChildren.find(
        (c: TSNode) => c.type !== 'visibility_modifier',
      );
      if (arg) imports.push(arg.text);
      return;
    }

    // pub mod X;  (file module declaration, treated as import)
    // mod X {}    (inline module — recurse into body)
    if (node.type === 'mod_item') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) return;
      const body = firstChildOfType(node, 'declaration_list');
      if (!body) {
        // mod X; — declaration-only, treat as import-like
        imports.push(nameNode.text);
        return;
      }
      // Inline mod: recurse
      for (const child of body.namedChildren) visitNode(child, nameNode.text);
      return;
    }

    // extern crate X
    if (node.type === 'extern_crate_declaration') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (nameNode) imports.push(nameNode.text);
      return;
    }

    // pub fn / pub async fn
    if (node.type === 'function_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) return;
      const fnName = parentName ? `${parentName}::${nameNode.text}` : nameNode.text;
      symbols.push({
        id: `${fileId}#${fnName}`,
        name: fnName,
        kind: 'function',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        implementsNames: [],
      });
      if (pub && !parentName) exports.push(nameNode.text);
      return;
    }

    // pub struct
    if (node.type === 'struct_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (!nameNode) return;
      const name = nameNode.text;
      symbols.push({
        id: `${fileId}#${name}`,
        name,
        kind: 'class',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        implementsNames: [],
      });
      if (pub) exports.push(name);
      return;
    }

    // pub enum
    if (node.type === 'enum_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (!nameNode) return;
      const name = nameNode.text;
      symbols.push({
        id: `${fileId}#${name}`,
        name,
        kind: 'class',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        implementsNames: [],
      });
      if (pub) exports.push(name);
      return;
    }

    // pub trait
    if (node.type === 'trait_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (!nameNode) return;
      const name = nameNode.text;
      symbols.push({
        id: `${fileId}#${name}`,
        name,
        kind: 'interface',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        implementsNames: [],
      });
      if (pub) exports.push(name);
      return;
    }

    // pub type Alias = ...
    if (node.type === 'type_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (!nameNode) return;
      const name = nameNode.text;
      symbols.push({
        id: `${fileId}#${name}`,
        name,
        kind: 'type',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        implementsNames: [],
      });
      if (pub) exports.push(name);
      return;
    }

    // impl Trait for Struct — extract implementsNames on the struct symbol
    if (node.type === 'impl_item') {
      const typeNodes = node.namedChildren.filter(
        (c: TSNode) => c.type === 'type_identifier' || c.type === 'generic_type',
      );
      if (typeNodes.length >= 2) {
        // impl TraitName for StructName
        const traitName = typeNodes[0].text;
        const structName = typeNodes[typeNodes.length - 1].text;
        const structSym = symbols.find(s => s.name === structName);
        if (structSym) {
          if (!structSym.implementsNames.includes(traitName)) {
            structSym.implementsNames.push(traitName);
          }
        }
      }
      // Recurse into impl body to pick up pub fns
      const body = firstChildOfType(node, 'declaration_list');
      if (body) {
        // Determine impl target for naming
        const structType = typeNodes[typeNodes.length - 1];
        const implParent = structType?.text;
        for (const child of body.namedChildren) visitNode(child, implParent);
      }
      return;
    }
  }

  for (const node of root.namedChildren) {
    visitNode(node);
  }

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
  };
}
