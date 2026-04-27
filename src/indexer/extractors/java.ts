/**
 * Tree-sitter based parser for Java.
 * Extracts symbol-level nodes (classes, interfaces, methods, constructors, enums, fields)
 * and their relationships (calls, extends, implements, imports).
 *
 * Follows the same interface and patterns as ts-parser.ts.
 */
import { createRequire } from 'node:module';
import type { SymbolNode, SymbolKind } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const javaGrammar = require('tree-sitter-java') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// Re-use a single parser instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let javaParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!javaParser) {
    javaParser = new ParserCtor();
    javaParser.setLanguage(javaGrammar);
  }
  return javaParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function childrenOfType(node: TSNode, type: string): TSNode[] {
  return node.namedChildren.filter((c: TSNode) => c.type === type);
}

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

function firstChildOfTypes(node: TSNode, types: string[]): TSNode | null {
  return node.namedChildren.find((c: TSNode) => types.includes(c.type)) ?? null;
}

/** Recursively walk a node and collect method_invocation callee names */
function collectCalls(node: TSNode, results: Set<string>): void {
  if (node.type === 'method_invocation') {
    // method_invocation: [object '.'] name arguments
    // The 'name' child is an identifier
    const nameNode = node.namedChildren.find(
      (c: TSNode) => c.type === 'identifier',
    );
    if (nameNode) results.add(nameNode.text);
  }
  for (const child of node.namedChildren) {
    collectCalls(child, results);
  }
}

/** Strip generic type parameters: List<String> → List */
function stripGenerics(name: string): string {
  return name.replace(/<[^>]*>/g, '').trim();
}

/** Extract modifiers from a node's modifier children.
 *
 * In tree-sitter-java, keyword modifiers like `public`, `static`, `final` are
 * anonymous nodes (string literals in the grammar), so they appear in
 * `node.children` but NOT in `node.namedChildren`.  We must use `.children`
 * when iterating the contents of a `modifiers` node.
 */
function getModifiers(node: TSNode): string[] {
  const mods: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'modifiers') {
      // Use .children (all children) to capture anonymous keyword nodes
      for (const mod of (child.children ?? child.namedChildren)) {
        if (
          mod.type !== 'annotation' &&
          mod.type !== 'marker_annotation' &&
          mod.isNamed === false  // anonymous nodes are keyword modifiers
        ) {
          mods.push(mod.type); // for anonymous nodes, type === text
        }
      }
    }
  }
  return mods;
}

function isPublic(node: TSNode): boolean {
  return getModifiers(node).includes('public');
}

function isStaticFinal(node: TSNode): boolean {
  const mods = getModifiers(node);
  return mods.includes('static') && mods.includes('final');
}

// ---------------------------------------------------------------------------
// Extract symbols from class/interface/enum body
// ---------------------------------------------------------------------------

function extractClassMembers(
  body: TSNode,
  fileId: string,
  parentName: string,
): SymbolNode[] {
  const members: SymbolNode[] = [];

  for (const child of body.namedChildren) {
    const startLine = child.startPosition.row + 1;
    const endLine = child.endPosition.row + 1;

    if (child.type === 'method_declaration') {
      const nameNode = firstChildOfType(child, 'identifier');
      if (!nameNode) continue;
      const methodName = nameNode.text;
      const calls = new Set<string>();
      const methodBody = firstChildOfType(child, 'block');
      if (methodBody) collectCalls(methodBody, calls);
      members.push({
        id: `${fileId}#${parentName}.${methodName}`,
        name: `${parentName}.${methodName}`,
        kind: 'method',
        startLine,
        endLine,
        isExported: isPublic(child),
        calls: [...calls].filter(c => c !== methodName),
        implementsNames: [],
      });
    } else if (child.type === 'constructor_declaration') {
      const nameNode = firstChildOfType(child, 'identifier');
      if (!nameNode) continue;
      const ctorName = nameNode.text;
      const calls = new Set<string>();
      const ctorBody = firstChildOfType(child, 'constructor_body');
      if (ctorBody) collectCalls(ctorBody, calls);
      members.push({
        id: `${fileId}#${parentName}.${ctorName}`,
        name: `${parentName}.${ctorName}`,
        kind: 'method',
        startLine,
        endLine,
        isExported: isPublic(child),
        calls: [...calls],
        implementsNames: [],
      });
    } else if (child.type === 'field_declaration') {
      // Only extract static final fields (constants)
      if (!isStaticFinal(child)) continue;
      const declarators = childrenOfType(child, 'variable_declarator');
      for (const decl of declarators) {
        const nameNode = firstChildOfType(decl, 'identifier');
        if (!nameNode) continue;
        members.push({
          id: `${fileId}#${parentName}.${nameNode.text}`,
          name: `${parentName}.${nameNode.text}`,
          kind: 'constant',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      }
    } else if (
      child.type === 'class_declaration' ||
      child.type === 'interface_declaration' ||
      child.type === 'enum_declaration' ||
      child.type === 'record_declaration'
    ) {
      // Inner class — extract with parent prefix
      const inner = extractTypeDeclaration(child, fileId, `${parentName}.`);
      if (inner) members.push(...(Array.isArray(inner) ? inner : [inner]));
    }
  }

  return members;
}

// ---------------------------------------------------------------------------
// Extract a top-level (or inner) type declaration
// ---------------------------------------------------------------------------

function extractTypeDeclaration(
  node: TSNode,
  fileId: string,
  namePrefix = '',
): SymbolNode | SymbolNode[] | null {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const pub = isPublic(node);

  switch (node.type) {
    case 'class_declaration':
    case 'record_declaration': {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) return null;
      const name = namePrefix + nameNode.text;

      // extends
      let extendsName: string | undefined;
      const superclass = firstChildOfType(node, 'superclass');
      if (superclass) {
        const typeNode = firstChildOfTypes(superclass, ['type_identifier', 'generic_type']);
        if (typeNode) extendsName = stripGenerics(typeNode.text);
      }

      // implements
      const implementsNames: string[] = [];
      const superInterfaces = firstChildOfType(node, 'super_interfaces');
      if (superInterfaces) {
        // type_list contains the interface types
        const typeList = firstChildOfTypes(superInterfaces, ['type_list', 'interface_type_list']);
        const types = typeList
          ? typeList.namedChildren
          : superInterfaces.namedChildren;
        for (const t of types) {
          if (t.type === 'type_identifier' || t.type === 'generic_type') {
            implementsNames.push(stripGenerics(t.text));
          }
        }
      }

      const classSymbol: SymbolNode = {
        id: `${fileId}#${name}`,
        name,
        kind: 'class',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        extendsName,
        implementsNames,
      };

      const symbols: SymbolNode[] = [classSymbol];

      // Extract members from body
      const body = firstChildOfTypes(node, ['class_body', 'record_body']);
      if (body) {
        symbols.push(...extractClassMembers(body, fileId, name));
      }

      return symbols;
    }

    case 'interface_declaration': {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) return null;
      const name = namePrefix + nameNode.text;

      // extends_interfaces
      const implementsNames: string[] = [];
      const extendsInterfaces = firstChildOfType(node, 'extends_interfaces');
      if (extendsInterfaces) {
        const typeList = firstChildOfType(extendsInterfaces, 'type_list');
        const types = typeList ? typeList.namedChildren : extendsInterfaces.namedChildren;
        for (const t of types) {
          if (t.type === 'type_identifier' || t.type === 'generic_type') {
            implementsNames.push(stripGenerics(t.text));
          }
        }
      }

      const ifaceSymbol: SymbolNode = {
        id: `${fileId}#${name}`,
        name,
        kind: 'interface',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        // For interfaces extending other interfaces: store in implementsNames
        implementsNames,
      };

      const symbols: SymbolNode[] = [ifaceSymbol];

      // Extract method signatures from interface body
      const body = firstChildOfType(node, 'interface_body');
      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'method_declaration' || child.type === 'interface_method_declaration') {
            const mName = firstChildOfType(child, 'identifier');
            if (!mName) continue;
            symbols.push({
              id: `${fileId}#${name}.${mName.text}`,
              name: `${name}.${mName.text}`,
              kind: 'method',
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              isExported: true, // interface methods are implicitly public
              calls: [],
              implementsNames: [],
            });
          }
        }
      }

      return symbols;
    }

    case 'enum_declaration': {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) return null;
      const name = namePrefix + nameNode.text;

      const implementsNames: string[] = [];
      const superInterfaces = firstChildOfType(node, 'super_interfaces');
      if (superInterfaces) {
        const typeList = firstChildOfTypes(superInterfaces, ['type_list', 'interface_type_list']);
        const types = typeList ? typeList.namedChildren : superInterfaces.namedChildren;
        for (const t of types) {
          if (t.type === 'type_identifier' || t.type === 'generic_type') {
            implementsNames.push(stripGenerics(t.text));
          }
        }
      }

      const enumSymbol: SymbolNode = {
        id: `${fileId}#${name}`,
        name,
        kind: 'class', // enums modeled as class
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        implementsNames,
      };

      const symbols: SymbolNode[] = [enumSymbol];

      const body = firstChildOfType(node, 'enum_body');
      if (body) {
        symbols.push(...extractClassMembers(body, fileId, name));
      }

      return symbols;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Package-to-file mapping (built externally, passed in)
// ---------------------------------------------------------------------------

export interface JavaParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
  packageName: string;  // e.g. "com.example.auth"
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const JAVA_MAX_STRING = 32000;
const JAVA_CHUNK_SIZE = 4096;

function parseContent(parser: TSNode, content: string): TSNode {
  if (content.length <= JAVA_MAX_STRING) {
    return parser.parse(content);
  }
  return parser.parse((startIndex: number) => {
    if (startIndex >= content.length) return null;
    return content.slice(startIndex, startIndex + JAVA_CHUNK_SIZE);
  });
}

export function parseJavaContent(
  content: string,
  fileId: string,
): JavaParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Java (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const exports: string[] = [];
  const rawSymbols: SymbolNode[] = [];
  let packageName = '';

  for (const node of root.namedChildren) {
    // Package declaration
    if (node.type === 'package_declaration') {
      const scopedId = firstChildOfTypes(node, ['scoped_identifier', 'identifier']);
      if (scopedId) packageName = scopedId.text;
      continue;
    }

    // Import declarations
    if (node.type === 'import_declaration') {
      const scopedId = firstChildOfTypes(node, ['scoped_identifier', 'identifier']);
      if (scopedId) {
        // Wildcard imports (com.foo.*) can't resolve to a single file — skip them
        const isWildcard = node.namedChildren.some(
          (c: TSNode) => c.type === 'asterisk' || c.text === '*',
        );
        if (!isWildcard) imports.push(scopedId.text);
      }
      continue;
    }

    // Top-level type declarations
    if (
      node.type === 'class_declaration' ||
      node.type === 'interface_declaration' ||
      node.type === 'enum_declaration' ||
      node.type === 'record_declaration' ||
      node.type === 'annotation_type_declaration'
    ) {
      if (node.type === 'annotation_type_declaration') continue; // skip

      const result = extractTypeDeclaration(node, fileId);
      if (!result) continue;
      const nodes = Array.isArray(result) ? result : [result];
      for (const sym of nodes) {
        rawSymbols.push(sym);
        if (sym.isExported && sym.kind !== 'constant') {
          exports.push(sym.name);
        }
      }
    }
  }

  // Resolve intra-file calls
  const symbolIdByName = new Map<string, string>(rawSymbols.map(s => [s.name, s.id]));
  const resolvedSymbols = rawSymbols.map(sym => ({
    ...sym,
    calls: sym.calls.map(name => symbolIdByName.get(name) ?? name),
  }));

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols: resolvedSymbols,
    packageName,
  };
}
