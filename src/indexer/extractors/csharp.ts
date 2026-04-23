import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const csharpGrammar = require('tree-sitter-c-sharp') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let csharpParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!csharpParser) {
    csharpParser = new ParserCtor();
    csharpParser.setLanguage(csharpGrammar);
  }
  return csharpParser;
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

/** Check if a node has a `public` modifier. */
function hasPublicModifier(node: TSNode): boolean {
  // Modifiers appear as modifier nodes in the named children list
  return node.namedChildren.some(
    (c: TSNode) => c.type === 'modifier' && c.text === 'public',
  );
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface CSharpParseResult {
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

type TypeKind = 'class' | 'interface' | 'constant';

function extractTypeSymbols(
  node: TSNode,
  fileId: string,
  parentName?: string,
): { sym: SymbolNode; members: SymbolNode[] } | null {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const pub = hasPublicModifier(node);

  const nodeTypeToKind: Record<string, TypeKind> = {
    class_declaration: 'class',
    interface_declaration: 'interface',
    struct_declaration: 'class',
    enum_declaration: 'class',
    record_declaration: 'class',
  };
  const kind = nodeTypeToKind[node.type];
  if (!kind) return null;

  const nameNode = firstChildOfType(node, 'identifier');
  if (!nameNode) return null;
  const name = parentName ? `${parentName}.${nameNode.text}` : nameNode.text;

  // Base types: class Foo : Bar, IBaz
  let extendsName: string | undefined;
  const implementsNames: string[] = [];
  const baseList = firstChildOfType(node, 'base_list');
  if (baseList) {
    const bases = baseList.namedChildren.filter(
      (c: TSNode) => c.type === 'identifier' || c.type === 'generic_name' || c.type === 'qualified_name',
    );
    for (let i = 0; i < bases.length; i++) {
      const baseName = firstChildOfType(bases[i], 'identifier')?.text ?? bases[i].text;
      if (i === 0 && node.type === 'class_declaration') {
        // First base could be a class (extendsName) or interface
        // Heuristic: if starts with 'I' followed by uppercase, treat as interface
        if (/^I[A-Z]/.test(baseName)) {
          implementsNames.push(baseName);
        } else {
          extendsName = baseName;
        }
      } else {
        implementsNames.push(baseName);
      }
    }
  }

  const sym: SymbolNode = {
    id: `${fileId}#${name}`,
    name,
    kind,
    startLine,
    endLine,
    isExported: pub,
    calls: [],
    extendsName,
    implementsNames,
  };

  // Extract public methods from body
  const members: SymbolNode[] = [];
  const declTypes = [
    'declaration_list',    // class/struct body
    'enum_member_declaration_list',
  ];
  let body: TSNode | null = null;
  for (const dt of declTypes) {
    body = firstChildOfType(node, dt);
    if (body) break;
  }
  if (!body) {
    // Try interface_body
    body = firstChildOfType(node, 'interface_body');
  }

  if (body) {
    for (const child of body.namedChildren) {
      if (child.type === 'method_declaration') {
        const mPub = hasPublicModifier(child);
        // method_declaration: [modifiers] [return_type_identifier] method_name parameter_list block
        // The method name is the last identifier before parameter_list
        const paramIdx = child.namedChildren.findIndex(
          (c: TSNode) => c.type === 'parameter_list',
        );
        const identsBefore = child.namedChildren
          .slice(0, paramIdx < 0 ? undefined : paramIdx)
          .filter((c: TSNode) => c.type === 'identifier');
        const mName = identsBefore[identsBefore.length - 1];
        if (!mName) continue;
        members.push({
          id: `${fileId}#${name}.${mName.text}`,
          name: `${name}.${mName.text}`,
          kind: 'method',
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          isExported: mPub,
          calls: [],
          implementsNames: [],
        });
      } else if (child.type === 'constructor_declaration') {
        const mPub = hasPublicModifier(child);
        const mName = firstChildOfType(child, 'identifier');
        if (!mName) continue;
        members.push({
          id: `${fileId}#${name}.${mName.text}`,
          name: `${name}.${mName.text}`,
          kind: 'method',
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          isExported: mPub,
          calls: [],
          implementsNames: [],
        });
      }
    }
  }

  return { sym, members };
}

export function parseCSharpContent(
  content: string,
  fileId: string,
): CSharpParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse C# (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  function visitChildren(nodes: TSNode[]): void {
    for (const node of nodes) {
      if (node.type === 'using_directive') {
        // using System.Foo;
        const nameNode = node.namedChildren.find(
          (c: TSNode) => c.type === 'identifier' || c.type === 'qualified_name' || c.type === 'member_access_expression',
        );
        if (nameNode) imports.push(nameNode.text);
        continue;
      }

      if (node.type === 'namespace_declaration' || node.type === 'file_scoped_namespace_declaration') {
        const body = firstChildOfType(node, 'declaration_list') ??
          node; // file-scoped: members are siblings
        visitChildren(body.namedChildren);
        continue;
      }

      const typeNodeTypes = [
        'class_declaration',
        'interface_declaration',
        'struct_declaration',
        'enum_declaration',
        'record_declaration',
      ];

      if (typeNodeTypes.includes(node.type)) {
        const result = extractTypeSymbols(node, fileId);
        if (!result) continue;
        symbols.push(result.sym, ...result.members);
        if (result.sym.isExported) exports.push(result.sym.name);
        // Also capture public methods in exports
        for (const m of result.members) {
          if (m.isExported) exports.push(m.name);
        }
      }
    }
  }

  visitChildren(root.namedChildren);

  // using directives inside namespaces also captured above
  // Collect any top-level using directives not caught
  for (const node of root.namedChildren) {
    if (node.type === 'using_directive') {
      const nameNode = node.namedChildren.find(
        (c: TSNode) =>
          c.type === 'identifier' ||
          c.type === 'qualified_name' ||
          c.type === 'member_access_expression',
      );
      if (nameNode && !imports.includes(nameNode.text)) {
        imports.push(nameNode.text);
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

// Suppress unused-import lint for childrenOfType helper kept for potential future use
void childrenOfType;
