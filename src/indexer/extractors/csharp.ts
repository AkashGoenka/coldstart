import csharpModule from 'tree-sitter-c-sharp';
import type { SymbolNode, CallSite } from '../../types.js';
import { childrenOfType, firstChildOfType } from './node-helpers.js';
import { makeParser } from './parser-factory.js';

const csharpGrammar = csharpModule as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

const getParser = makeParser(csharpGrammar);

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

/** Check if a node has a `public` modifier. */
function hasPublicModifier(node: TSNode): boolean {
  // Modifiers appear as modifier nodes in the named children list
  return node.namedChildren.some(
    (c: TSNode) => c.type === 'modifier' && c.text === 'public',
  );
}

/** Recursively walk a node and collect invocation_expression callee names + first-seen line. */
function collectCalls(node: TSNode, results: Map<string, number>): void {
  if (node.type === 'invocation_expression') {
    // invocation_expression: field('function', identifier | member_access_expression) field('arguments', ...)
    const funcNode = node.childForFieldName('function');
    if (funcNode) {
      let methodName: string | undefined;
      if (funcNode.type === 'identifier') {
        // Bare call: DoSomething()
        methodName = funcNode.text;
      } else if (funcNode.type === 'member_access_expression') {
        // Member call: obj.Method() — use field 'name' for the method name
        const nameNode = funcNode.childForFieldName('name');
        if (nameNode) methodName = nameNode.text;
      }
      if (methodName && !results.has(methodName)) {
        results.set(methodName, node.startPosition.row + 1);
      }
    }
  }
  for (const child of node.namedChildren) {
    collectCalls(child, results);
  }
}

function callsFromMap(calls: Map<string, number>, exclude?: string): CallSite[] {
  const out: CallSite[] = [];
  for (const [name, line] of calls) {
    if (exclude && name === exclude) continue;
    out.push({ name, line });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PartialDeclaration {
  kind: 'class' | 'struct' | 'interface' | 'record';
  name: string;
  namespace?: string;
}

export interface CSharpParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
  partialDeclarations?: PartialDeclaration[];
  /** The file's primary declared namespace (`namespace Foo.Bar`), if any. Used
   *  to resolve `using` directives by declared namespace rather than by guessing
   *  it from the directory layout. */
  packageName?: string;
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
        const calls = new Map<string, number>();
        const methodBody = firstChildOfType(child, 'block');
        if (methodBody) collectCalls(methodBody, calls);
        members.push({
          id: `${fileId}#${name}.${mName.text}`,
          name: `${name}.${mName.text}`,
          kind: 'method',
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          isExported: mPub,
          calls: callsFromMap(calls, mName.text),
          implementsNames: [],
        });
      } else if (child.type === 'constructor_declaration') {
        const mPub = hasPublicModifier(child);
        const mName = firstChildOfType(child, 'identifier');
        if (!mName) continue;
        const calls = new Map<string, number>();
        const ctorBody = firstChildOfType(child, 'block');
        if (ctorBody) collectCalls(ctorBody, calls);
        members.push({
          id: `${fileId}#${name}.${mName.text}`,
          name: `${name}.${mName.text}`,
          kind: 'method',
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          isExported: mPub,
          calls: callsFromMap(calls),
          implementsNames: [],
        });
      }
    }
  }

  return { sym, members };
}

/** Check if a type node has the 'partial' modifier */
function isPartialType(node: TSNode): boolean {
  return node.namedChildren.some(
    (c: TSNode) => c.type === 'modifier' && c.text === 'partial',
  );
}

/** Extract namespace name from a namespace_declaration node */
function getNamespaceFromParent(node: TSNode): string | undefined {
  // Walk up parent chain in the provided context — we need to track during recursion
  // For now, we'll pass this context through visitChildren
  return undefined;
}

/** Collect all partial type declarations (class/struct/interface/record) */
function collectPartialDeclarations(root: TSNode, currentNamespace?: string): PartialDeclaration[] {
  const out: PartialDeclaration[] = [];

  function visit(node: TSNode, namespace?: string): void {
    // Track namespace context as we descend
    if (node.type === 'namespace_declaration' || node.type === 'file_scoped_namespace_declaration') {
      const nameNode = firstChildOfType(node, 'identifier') ?? firstChildOfType(node, 'qualified_name');
      const newNamespace = nameNode?.text;
      const body = firstChildOfType(node, 'declaration_list') ?? node;
      for (const child of body.namedChildren) {
        visit(child, newNamespace);
      }
      return;
    }

    // Check for partial type declarations
    const typeNodeTypes = [
      'class_declaration',
      'struct_declaration',
      'interface_declaration',
      'record_declaration',
    ];

    if (typeNodeTypes.includes(node.type) && isPartialType(node)) {
      const nameNode = firstChildOfType(node, 'identifier');
      if (nameNode) {
        const kind = node.type === 'class_declaration'
          ? 'class'
          : node.type === 'struct_declaration'
          ? 'struct'
          : node.type === 'interface_declaration'
          ? 'interface'
          : 'record';
        out.push({
          kind,
          name: nameNode.text,
          namespace,
        });
      }
    }

    // Continue recursing into children
    for (const child of node.namedChildren) {
      visit(child, namespace);
    }
  }

  visit(root, currentNamespace);
  return out;
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
  let packageName: string | undefined;

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
        // First declared namespace becomes the file's package identity. The name
        // node (`qualified_name`) already carries the full dotted form, e.g.
        // `Serilog.Core.Pipeline`.
        if (packageName === undefined) {
          const nameNode = firstChildOfType(node, 'qualified_name') ?? firstChildOfType(node, 'identifier');
          if (nameNode) packageName = nameNode.text;
        }
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

  // Collect partial type declarations
  const partialDeclarations = collectPartialDeclarations(root);

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
    partialDeclarations: partialDeclarations.length > 0 ? partialDeclarations : undefined,
    packageName,
  };
}

// Suppress unused-import lint for childrenOfType helper kept for potential future use
void childrenOfType;
