import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const swiftGrammar = require('tree-sitter-swift') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let swiftParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!swiftParser) {
    swiftParser = new ParserCtor();
    swiftParser.setLanguage(swiftGrammar);
  }
  return swiftParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

/** In Swift, declarations are public by default within the module (internal).
 *  We treat anything that isn't explicitly private/fileprivate as exported. */
function isEffectivelyPublic(node: TSNode): boolean {
  const modifiers = firstChildOfType(node, 'modifiers');
  if (!modifiers) return true;
  const visMod = firstChildOfType(modifiers, 'visibility_modifier');
  if (!visMod) return true;
  const text = visMod.text;
  return !text.includes('private') && !text.includes('fileprivate');
}

/** Extract the type name from an inheritance_specifier node. */
function inheritanceSpecifierName(spec: TSNode): string | undefined {
  const userType = firstChildOfType(spec, 'user_type');
  if (userType) {
    return firstChildOfType(userType, 'type_identifier')?.text;
  }
  return firstChildOfType(spec, 'type_identifier')?.text;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface SwiftParseResult {
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

export function parseSwiftContent(
  content: string,
  fileId: string,
): SwiftParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Swift (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  for (const node of root.namedChildren) {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // import_declaration → identifier (module path text)
    if (node.type === 'import_declaration') {
      const ident = firstChildOfType(node, 'identifier');
      if (ident) imports.push(ident.text);
      continue;
    }

    // protocol_declaration → interface kind
    if (node.type === 'protocol_declaration') {
      const pub = isEffectivelyPublic(node);
      const name = firstChildOfType(node, 'type_identifier')?.text;
      if (!name) continue;
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

      // Extract protocol method declarations
      const body = firstChildOfType(node, 'protocol_body');
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === 'protocol_function_declaration') {
            const mName = firstChildOfType(member, 'simple_identifier')?.text;
            if (!mName) continue;
            symbols.push({
              id: `${fileId}#${name}.${mName}`,
              name: `${name}.${mName}`,
              kind: 'method',
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              isExported: pub,
              calls: [],
              implementsNames: [],
            });
          }
        }
      }
      continue;
    }

    // class_declaration covers class, struct, and enum in tree-sitter-swift
    if (node.type === 'class_declaration') {
      const pub = isEffectivelyPublic(node);
      const typeName = firstChildOfType(node, 'type_identifier')?.text;
      if (!typeName) continue;

      // Inheritance: first inheritance_specifier → extends, rest → implements
      const inheritanceSpecs = node.namedChildren.filter(
        (c: TSNode) => c.type === 'inheritance_specifier',
      );
      let extendsName: string | undefined;
      const implementsNames: string[] = [];
      for (let i = 0; i < inheritanceSpecs.length; i++) {
        const n = inheritanceSpecifierName(inheritanceSpecs[i]);
        if (!n) continue;
        if (i === 0) extendsName = n;
        else implementsNames.push(n);
      }

      symbols.push({
        id: `${fileId}#${typeName}`,
        name: typeName,
        kind: 'class',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        extendsName,
        implementsNames,
      });
      if (pub) exports.push(typeName);

      // Extract methods from class body
      const body = firstChildOfType(node, 'class_body');
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === 'function_declaration') {
            const mPub = isEffectivelyPublic(member);
            const mName = firstChildOfType(member, 'simple_identifier')?.text;
            if (!mName) continue;
            symbols.push({
              id: `${fileId}#${typeName}.${mName}`,
              name: `${typeName}.${mName}`,
              kind: 'method',
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              isExported: mPub,
              calls: [],
              implementsNames: [],
            });
          }
        }
      }
      continue;
    }

    // Top-level function_declaration
    if (node.type === 'function_declaration') {
      const pub = isEffectivelyPublic(node);
      const fnName = firstChildOfType(node, 'simple_identifier')?.text;
      if (!fnName) continue;
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
      if (pub) exports.push(fnName);
      continue;
    }
  }

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
  };
}
