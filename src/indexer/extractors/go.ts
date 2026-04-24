import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const goGrammar = require('tree-sitter-go') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let goParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!goParser) {
    goParser = new ParserCtor();
    goParser.setLanguage(goGrammar);
  }
  return goParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

/** In Go, exported identifiers begin with an uppercase letter. */
function isExported(name: string): boolean {
  return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface GoParseResult {
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

export function parseGoContent(
  content: string,
  fileId: string,
): GoParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Go (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  for (const node of root.namedChildren) {
    // import "X"  or  import (...) block
    if (node.type === 'import_declaration') {
      // Single import spec or import_spec_list
      for (const child of node.namedChildren) {
        if (child.type === 'import_spec') {
          const pathNode = firstChildOfType(child, 'interpreted_string_literal') ??
            firstChildOfType(child, 'raw_string_literal');
          if (pathNode) imports.push(pathNode.text.replace(/^["'`]|["'`]$/g, ''));
        } else if (child.type === 'import_spec_list') {
          for (const spec of child.namedChildren) {
            if (spec.type === 'import_spec') {
              const pathNode = firstChildOfType(spec, 'interpreted_string_literal') ??
                firstChildOfType(spec, 'raw_string_literal');
              if (pathNode) imports.push(pathNode.text.replace(/^["'`]|["'`]$/g, ''));
            }
          }
        }
      }
      continue;
    }

    // func Name(...)
    if (node.type === 'function_declaration') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) continue;
      const fnName = nameNode.text;
      const exp = isExported(fnName);
      symbols.push({
        id: `${fileId}#${fnName}`,
        name: fnName,
        kind: 'function',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: exp,
        calls: [],
        implementsNames: [],
      });
      if (exp) exports.push(fnName);
      continue;
    }

    // func (r ReceiverType) Name(...)  — method
    if (node.type === 'method_declaration') {
      const nameNode = firstChildOfType(node, 'field_identifier');
      if (!nameNode) continue;
      const fnName = nameNode.text;
      const exp = isExported(fnName);
      // Receiver type name
      const receiver = firstChildOfType(node, 'parameter_list');
      let receiverType = '';
      if (receiver) {
        const paramDecl = firstChildOfType(receiver, 'parameter_declaration');
        if (paramDecl) {
          const typeId = paramDecl.namedChildren.find(
            (c: TSNode) => c.type === 'type_identifier' || c.type === 'pointer_type',
          );
          if (typeId) {
            receiverType = typeId.type === 'pointer_type'
              ? (firstChildOfType(typeId, 'type_identifier')?.text ?? typeId.text)
              : typeId.text;
          }
        }
      }
      const fullName = receiverType ? `${receiverType}.${fnName}` : fnName;
      symbols.push({
        id: `${fileId}#${fullName}`,
        name: fullName,
        kind: 'method',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: exp,
        calls: [],
        implementsNames: [],
      });
      continue;
    }

    // type Name struct/interface/...
    if (node.type === 'type_declaration') {
      for (const spec of node.namedChildren) {
        if (spec.type !== 'type_spec') continue;
        const nameNode = firstChildOfType(spec, 'type_identifier');
        if (!nameNode) continue;
        const typeName = nameNode.text;
        const exp = isExported(typeName);
        const typeBody = spec.namedChildren.find(
          (c: TSNode) => c.type !== 'type_identifier',
        );
        const kind = typeBody?.type === 'interface_type' ? 'interface' : 'class';
        symbols.push({
          id: `${fileId}#${typeName}`,
          name: typeName,
          kind,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: exp,
          calls: [],
          implementsNames: [],
        });
        if (exp) exports.push(typeName);
      }
      continue;
    }

    // const X = ... / var X = ...
    if (node.type === 'const_declaration' || node.type === 'var_declaration') {
      for (const spec of node.namedChildren) {
        if (spec.type !== 'const_spec' && spec.type !== 'var_spec') continue;
        const nameNode = firstChildOfType(spec, 'identifier');
        if (!nameNode) continue;
        const constName = nameNode.text;
        const exp = isExported(constName);
        symbols.push({
          id: `${fileId}#${constName}`,
          name: constName,
          kind: 'constant',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: exp,
          calls: [],
          implementsNames: [],
        });
        if (exp) exports.push(constName);
      }
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
