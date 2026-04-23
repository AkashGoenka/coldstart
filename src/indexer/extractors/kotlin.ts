import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kotlinGrammar = require('tree-sitter-kotlin') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kotlinParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!kotlinParser) {
    kotlinParser = new ParserCtor();
    kotlinParser.setLanguage(kotlinGrammar);
  }
  return kotlinParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

/** In Kotlin, declarations are public by default unless explicitly private/protected/internal */
function isEffectivelyPublic(node: TSNode): boolean {
  const modifiers = firstChildOfType(node, 'modifiers');
  if (!modifiers) return true;
  const text = modifiers.text;
  return !text.includes('private') && !text.includes('protected');
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface KotlinParseResult {
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

export function parseKotlinContent(
  content: string,
  fileId: string,
): KotlinParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Kotlin (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  function captureImport(importHeader: TSNode): void {
    const identifier = importHeader.namedChildren.find(
      (c: TSNode) => c.type === 'identifier',
    );
    if (identifier) {
      imports.push(identifier.text);
    } else if (importHeader.text) {
      const raw = importHeader.text.replace(/^import\s+/, '').replace(/\.\*$/, '').trim();
      if (raw) imports.push(raw);
    }
  }

  /** Check if a class_declaration node is actually an interface (has 'interface' keyword). */
  function isInterface(node: TSNode): boolean {
    // Anonymous keyword nodes appear in .children, not .namedChildren
    return (node.children ?? []).some((c: TSNode) => c.type === 'interface');
  }

  for (const node of root.namedChildren) {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // import_list contains import_header children
    if (node.type === 'import_list') {
      for (const importHeader of node.namedChildren) {
        if (importHeader.type === 'import_header') captureImport(importHeader);
      }
      continue;
    }

    // direct import_header (fallback)
    if (node.type === 'import_header') {
      captureImport(node);
      continue;
    }

    // class / data class / sealed class / abstract class / interface (all use class_declaration)
    if (node.type === 'class_declaration') {
      if (isInterface(node)) {
        // Interface: treat as interface kind
        const pub = isEffectivelyPublic(node);
        const nameNode = firstChildOfType(node, 'type_identifier') ??
          firstChildOfType(node, 'simple_identifier');
        if (!nameNode) continue;
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
        continue;
      }
      const pub = isEffectivelyPublic(node);
      const nameNode = firstChildOfType(node, 'type_identifier') ??
        firstChildOfType(node, 'simple_identifier');
      if (!nameNode) continue;
      const className = nameNode.text;

      // Supertype: class Foo : Bar(), Baz
      let extendsName: string | undefined;
      const implementsNames: string[] = [];
      const delegationSpec = firstChildOfType(node, 'delegation_specifiers');
      if (delegationSpec) {
        const supers = delegationSpec.namedChildren.filter(
          (c: TSNode) =>
            c.type === 'constructor_invocation' ||
            c.type === 'explicit_delegation' ||
            c.type === 'user_type',
        );
        for (let i = 0; i < supers.length; i++) {
          const sup = supers[i];
          const typeName = firstChildOfType(sup, 'user_type') ??
            firstChildOfType(sup, 'type_identifier') ??
            sup;
          const name = firstChildOfType(typeName, 'simple_identifier')?.text ?? typeName.text;
          if (i === 0) {
            extendsName = name;
          } else {
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
        isExported: pub,
        calls: [],
        extendsName,
        implementsNames,
      });
      if (pub) exports.push(className);

      // Extract methods from class body
      const body = firstChildOfType(node, 'class_body');
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === 'function_declaration') {
            const mPub = isEffectivelyPublic(member);
            const mName = firstChildOfType(member, 'simple_identifier');
            if (!mName) continue;
            symbols.push({
              id: `${fileId}#${className}.${mName.text}`,
              name: `${className}.${mName.text}`,
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

    // interface
    if (node.type === 'interface_declaration') {
      const pub = isEffectivelyPublic(node);
      const nameNode = firstChildOfType(node, 'type_identifier') ??
        firstChildOfType(node, 'simple_identifier');
      if (!nameNode) continue;
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
      continue;
    }

    // object declaration
    if (node.type === 'object_declaration') {
      const pub = isEffectivelyPublic(node);
      const nameNode = firstChildOfType(node, 'simple_identifier');
      if (!nameNode) continue;
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
      continue;
    }

    // top-level function
    if (node.type === 'function_declaration') {
      const pub = isEffectivelyPublic(node);
      const nameNode = firstChildOfType(node, 'simple_identifier');
      if (!nameNode) continue;
      const fnName = nameNode.text;
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
