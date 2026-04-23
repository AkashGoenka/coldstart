import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dartGrammar = require('tree-sitter-dart') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dartParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!dartParser) {
    dartParser = new ParserCtor();
    dartParser.setLanguage(dartGrammar);
  }
  return dartParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

/** In Dart, public names do not start with underscore. */
function isPublicName(name: string): boolean {
  return !name.startsWith('_');
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DartParseResult {
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

export function parseDartContent(
  content: string,
  fileId: string,
): DartParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Dart (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  for (const node of root.namedChildren) {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // import 'package:X/Y.dart'
    if (node.type === 'import_or_export') {
      const uriNode = node.namedChildren.find(
        (c: TSNode) => c.type === 'string_literal' || c.type === 'uri',
      );
      if (uriNode) imports.push(uriNode.text.replace(/^['"]|['"]$/g, ''));
      continue;
    }

    // export 'file.dart'
    if (node.type === 'export_directive') {
      const uriNode = node.namedChildren.find(
        (c: TSNode) => c.type === 'string_literal' || c.type === 'uri',
      );
      if (uriNode) imports.push(uriNode.text.replace(/^['"]|['"]$/g, ''));
      continue;
    }

    // class / abstract class
    if (node.type === 'class_definition') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) continue;
      const className = nameNode.text;
      if (!isPublicName(className)) continue;

      let extendsName: string | undefined;
      const implementsNames: string[] = [];

      const superclass = firstChildOfType(node, 'superclass');
      if (superclass) {
        const typeName = firstChildOfType(superclass, 'type_name') ??
          firstChildOfType(superclass, 'identifier');
        if (typeName) {
          const id = firstChildOfType(typeName, 'identifier');
          extendsName = id?.text ?? typeName.text;
        }
      }

      const implementsClause = firstChildOfType(node, 'interfaces');
      if (implementsClause) {
        const typeList = firstChildOfType(implementsClause, 'type_list');
        const types = (typeList ?? implementsClause).namedChildren;
        for (const t of types) {
          const id = firstChildOfType(t, 'identifier') ??
            firstChildOfType(t, 'type_name');
          if (id) {
            const name = firstChildOfType(id, 'identifier')?.text ?? id.text;
            implementsNames.push(name);
          }
        }
      }

      symbols.push({
        id: `${fileId}#${className}`,
        name: className,
        kind: 'class',
        startLine,
        endLine,
        isExported: true,
        calls: [],
        extendsName,
        implementsNames,
      });
      exports.push(className);

      // Extract methods
      const body = firstChildOfType(node, 'class_body');
      if (body) {
        for (const member of body.namedChildren) {
          if (
            member.type === 'method_signature' ||
            member.type === 'function_signature' ||
            member.type === 'method_declaration' ||
            member.type === 'declared_identifier'
          ) {
            const mName = firstChildOfType(member, 'identifier');
            if (!mName || !isPublicName(mName.text)) continue;
            symbols.push({
              id: `${fileId}#${className}.${mName.text}`,
              name: `${className}.${mName.text}`,
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

    // mixin
    if (node.type === 'mixin_declaration') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode || !isPublicName(nameNode.text)) continue;
      const name = nameNode.text;
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
      exports.push(name);
      continue;
    }

    // extension
    if (node.type === 'extension_declaration') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode || !isPublicName(nameNode.text)) continue;
      const name = nameNode.text;
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
      exports.push(name);
      continue;
    }

    // enum
    if (node.type === 'enum_declaration') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode || !isPublicName(nameNode.text)) continue;
      const name = nameNode.text;
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
      exports.push(name);
      continue;
    }

    // top-level function
    if (
      node.type === 'function_signature' ||
      node.type === 'function_declaration'
    ) {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode || !isPublicName(nameNode.text)) continue;
      const fnName = nameNode.text;
      symbols.push({
        id: `${fileId}#${fnName}`,
        name: fnName,
        kind: 'function',
        startLine,
        endLine,
        isExported: true,
        calls: [],
        implementsNames: [],
      });
      exports.push(fnName);
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
