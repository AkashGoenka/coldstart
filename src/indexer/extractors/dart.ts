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

/** In Dart, names starting with '_' are private to the library. */
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

/** Extract function name from a function_signature node.
 *  AST: [return_type: type_identifier|void_type] [name: identifier] [params: formal_parameter_list]
 *  The name uses `identifier`, not `type_identifier` (which is the return type). */
function functionSignatureName(sig: TSNode): string | undefined {
  return sig.namedChildren.find((c: TSNode) => c.type === 'identifier')?.text;
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

    // import 'package:x/y.dart' or import 'dart:async'
    // AST: import_or_export → library_import → import_specification → configurable_uri
    if (node.type === 'import_or_export') {
      const libImport = firstChildOfType(node, 'library_import');
      if (!libImport) continue;
      const spec = firstChildOfType(libImport, 'import_specification');
      if (!spec) continue;
      const uri = firstChildOfType(spec, 'configurable_uri');
      if (!uri) continue;
      const raw = uri.text.replace(/^['"]|['"]$/g, '').trim();
      if (raw) imports.push(raw);
      continue;
    }

    // class / abstract class
    // AST: class_definition → identifier (name), superclass?, interfaces?, class_body
    if (node.type === 'class_definition') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) continue;
      const className = nameNode.text;
      const pub = isPublicName(className);

      // superclass → type_identifier
      let extendsName: string | undefined;
      const superclassNode = firstChildOfType(node, 'superclass');
      if (superclassNode) {
        extendsName = firstChildOfType(superclassNode, 'type_identifier')?.text;
      }

      // interfaces → type_identifier (multiple)
      const implementsNames: string[] = [];
      const interfacesNode = firstChildOfType(node, 'interfaces');
      if (interfacesNode) {
        for (const c of interfacesNode.namedChildren) {
          if (c.type === 'type_identifier') implementsNames.push(c.text);
        }
      }

      symbols.push({
        id: `${fileId}#${className}`,
        name: className,
        kind: 'class',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        extendsName,
        implementsNames,
      });
      if (pub) exports.push(className);

      // Methods: class_body namedChildren include method_signature nodes
      // Each method_signature contains a function_signature → [return_type, name: identifier, params]
      const body = firstChildOfType(node, 'class_body');
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === 'method_signature') {
            const sig = firstChildOfType(member, 'function_signature');
            if (!sig) continue;
            const mName = functionSignatureName(sig);
            if (!mName || !isPublicName(mName)) continue;
            symbols.push({
              id: `${fileId}#${className}.${mName}`,
              name: `${className}.${mName}`,
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

    // enum
    if (node.type === 'enum_declaration') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) continue;
      const enumName = nameNode.text;
      const pub = isPublicName(enumName);
      symbols.push({
        id: `${fileId}#${enumName}`,
        name: enumName,
        kind: 'class',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        implementsNames: [],
      });
      if (pub) exports.push(enumName);
      continue;
    }

    // Top-level function: function_signature at program root (followed by function_body sibling)
    if (node.type === 'function_signature') {
      const fnName = functionSignatureName(node);
      if (!fnName || !isPublicName(fnName)) continue;
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
