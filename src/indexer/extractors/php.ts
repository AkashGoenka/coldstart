import { createRequire } from 'node:module';
import type { SymbolNode, CallSite } from '../../types.js';
import { childrenOfType, firstChildOfType } from './node-helpers.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// tree-sitter-php exports a { php, php_only } object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const phpModule = require('tree-sitter-php') as { php: unknown; php_only: unknown };
const phpGrammar = phpModule.php ?? phpModule.php_only;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let phpParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!phpParser) {
    phpParser = new ParserCtor();
    phpParser.setLanguage(phpGrammar);
  }
  return phpParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function hasPublicModifier(node: TSNode): boolean {
  // In tree-sitter-php, modifiers are named children of type 'modifier' or appear as keywords
  return node.namedChildren.some(
    (c: TSNode) =>
      (c.type === 'modifier' && c.text === 'public') ||
      c.type === 'public',
  );
}

/** Recursively collect call site names + first-seen line in a subtree.
 *  Handles two PHP call node types:
 *  - member_call_expression  ($obj->method())  — name via field 'name'
 *  - function_call_expression (someFunc())      — function via field 'function'
 */
function collectCalls(node: TSNode, results: Map<string, number>): void {
  if (node.type === 'member_call_expression') {
    const nameNode = node.childForFieldName('name');
    if (nameNode && !results.has(nameNode.text)) {
      results.set(nameNode.text, node.startPosition.row + 1);
    }
  } else if (node.type === 'function_call_expression') {
    const funcNode = node.childForFieldName('function');
    if (funcNode && !results.has(funcNode.text)) {
      results.set(funcNode.text, node.startPosition.row + 1);
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

/** Extract class::class references from call arguments and class constant accesses.
 *  Returns fully-qualified class names after resolving via imports and namespace context. */
function extractClassStringReferences(
  node: TSNode,
  imports: Map<string, string>,
  currentNamespace: string,
): Array<{ className: string; line: number }> {
  const results: Array<{ className: string; line: number }> = [];

  function resolveClassName(name: string): string {
    // Already an import (fully qualified via use statement)
    if (imports.has(name)) return imports.get(name)!;
    // Already fully qualified (contains backslash)
    if (name.includes('\\')) return name;
    // Relative to current namespace
    if (currentNamespace) return `${currentNamespace}\\${name}`;
    // Bare name (likely builtin or resolved in current namespace)
    return name;
  }

  function walk(n: TSNode): void {
    // class_constant_access_expression: Foo::class → name is "Foo"
    if (n.type === 'class_constant_access_expression') {
      const nameNode = firstChildOfType(n, 'name');
      if (nameNode) {
        const simpleName = nameNode.text;
        const fqn = resolveClassName(simpleName);
        results.push({ className: fqn, line: n.startPosition.row + 1 });
      }
    }
    // qualified_name: "App\Models\User" (direct reference without ::class)
    else if (n.type === 'qualified_name') {
      const text = n.text;
      if (text.includes('\\') || imports.has(text)) {
        const fqn = resolveClassName(text);
        results.push({ className: fqn, line: n.startPosition.row + 1 });
      }
    }

    for (const child of n.namedChildren) {
      walk(child);
    }
  }

  walk(node);
  return results;
}

/** Extract eloquent relationships from $this->hasMany(...) etc calls within a method.
 *  Only matches deterministic pattern: hasMany/belongsTo/hasOne/hasAndBelongsToMany
 *  with a single class string argument. */
function extractEloquentRelations(
  methodNode: TSNode,
  imports: Map<string, string>,
  currentNamespace: string,
): Array<{ targetClass: string; line: number }> {
  const results: Array<{ targetClass: string; line: number }> = [];

  function walkForCalls(n: TSNode): void {
    // member_call_expression: $this->hasMany(...)
    if (n.type === 'member_call_expression') {
      const nameNode = n.childForFieldName('name');
      const methodName = nameNode?.text;

      // Check if this is an eloquent relationship method
      if (methodName && ['hasMany', 'belongsTo', 'hasOne', 'belongsToMany',
                          'morphTo', 'morphMany', 'morphOne', 'morphByMany'].includes(methodName)) {
        const argsNode = n.childForFieldName('arguments');
        if (argsNode) {
          // Extract all class string refs from arguments
          const refs = extractClassStringReferences(argsNode, imports, currentNamespace);
          for (const ref of refs) {
            results.push({ targetClass: ref.className, line: n.startPosition.row + 1 });
          }
        }
      }
    }

    for (const child of n.namedChildren) {
      walkForCalls(child);
    }
  }

  walkForCalls(methodNode);
  return results;
}

/** Extract container resolution patterns: app(Foo::class), resolve(Bar::class), etc. */
function extractContainerResolutions(
  node: TSNode,
  imports: Map<string, string>,
  currentNamespace: string,
): Array<{ targetClass: string; line: number }> {
  const results: Array<{ targetClass: string; line: number }> = [];

  function walk(n: TSNode): void {
    // function_call_expression: app(...), resolve(...), etc
    if (n.type === 'function_call_expression') {
      const funcNode = n.childForFieldName('function');
      const funcName = funcNode?.text;

      if (funcName && ['app', 'resolve', 'container'].includes(funcName)) {
        const argsNode = n.childForFieldName('arguments');
        if (argsNode) {
          const refs = extractClassStringReferences(argsNode, imports, currentNamespace);
          for (const ref of refs) {
            results.push({ targetClass: ref.className, line: n.startPosition.row + 1 });
          }
        }
      }
    }
    // member_call_expression: $container->make(...), bind(...), singleton(...)
    else if (n.type === 'member_call_expression') {
      const nameNode = n.childForFieldName('name');
      const methodName = nameNode?.text;

      if (methodName && ['make', 'bind', 'singleton'].includes(methodName)) {
        const argsNode = n.childForFieldName('arguments');
        if (argsNode) {
          const refs = extractClassStringReferences(argsNode, imports, currentNamespace);
          for (const ref of refs) {
            results.push({ targetClass: ref.className, line: n.startPosition.row + 1 });
          }
        }
      }
    }

    for (const child of n.namedChildren) {
      walk(child);
    }
  }

  walk(node);
  return results;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PhpParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
  eloquentRelations?: Array<{ targetClass: string; line: number }>;
  containerResolutions?: Array<{ targetClass: string; line: number }>;
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

export function parsePhpContent(
  content: string,
  fileId: string,
): PhpParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse PHP (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const importMap = new Map<string, string>(); // shortName → FQCN
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];
  const eloquentRelations: Array<{ targetClass: string; line: number }> = [];
  const containerResolutions: Array<{ targetClass: string; line: number }> = [];
  let currentNamespace = ''; // Track the current PHP namespace

  // Walk the PHP document (which may have a program child)
  const program = firstChildOfType(root, 'program') ?? root;

  for (const node of program.namedChildren) {
    // Capture namespace declarations before processing
    if (node.type === 'namespace_definition') {
      const nsNameNode = firstChildOfType(node, 'namespace_name');
      if (nsNameNode) {
        // namespace_name can be a qualified_name or have children that are names
        const nameNode = firstChildOfType(nsNameNode, 'qualified_name') ?? nsNameNode;
        if (nameNode) {
          currentNamespace = nameNode.text;
        }
      }
    }
    visitTopLevel(node);
  }

  function visitTopLevel(node: TSNode): void {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // use X\Y;  (namespace imports)
    if (node.type === 'use_declaration' || node.type === 'namespace_use_declaration') {
      for (const clause of node.namedChildren) {
        if (clause.type === 'use_clause' || clause.type === 'namespace_use_clause') {
          const name = firstChildOfType(clause, 'qualified_name') ??
            firstChildOfType(clause, 'name');
          if (name) {
            const fqcn = name.text;
            imports.push(fqcn);
            // Map short name (last segment) → FQCN
            const shortName = fqcn.split('\\').pop() || fqcn;
            importMap.set(shortName, fqcn);
          }
        } else if (clause.type === 'qualified_name' || clause.type === 'name') {
          const fqcn = clause.text;
          imports.push(fqcn);
          const shortName = fqcn.split('\\').pop() || fqcn;
          importMap.set(shortName, fqcn);
        }
      }
      return;
    }

    // require / require_once / include / include_once
    if (node.type === 'expression_statement') {
      const expr = node.namedChildren[0];
      if (
        expr &&
        (expr.type === 'require_once_expression' ||
          expr.type === 'require_expression' ||
          expr.type === 'include_expression' ||
          expr.type === 'include_once_expression')
      ) {
        const pathNode = expr.namedChildren[0];
        if (pathNode) {
          imports.push(pathNode.text.replace(/^['"]|['"]$/g, ''));
        }
      }
      return;
    }

    // class / abstract class / final class
    if (
      node.type === 'class_declaration' ||
      node.type === 'interface_declaration' ||
      node.type === 'trait_declaration'
    ) {
      const nameNode = firstChildOfType(node, 'name');
      if (!nameNode) return;
      const className = nameNode.text;

      let extendsName: string | undefined;
      const implementsNames: string[] = [];

      const baseClause = firstChildOfType(node, 'base_clause');
      if (baseClause) {
        const baseName = firstChildOfType(baseClause, 'qualified_name') ??
          firstChildOfType(baseClause, 'name');
        if (baseName) extendsName = baseName.text;
      }

      const implClause = firstChildOfType(node, 'class_interface_clause') ??
        firstChildOfType(node, 'class_implements');
      if (implClause) {
        for (const iface of implClause.namedChildren) {
          if (iface.type === 'qualified_name' || iface.type === 'name') {
            implementsNames.push(iface.text);
          }
        }
      }

      symbols.push({
        id: `${fileId}#${className}`,
        name: className,
        kind: node.type === 'interface_declaration' ? 'interface' : 'class',
        startLine,
        endLine,
        isExported: true, // PHP classes are always exported (file-scoped visibility)
        calls: [],
        extendsName,
        implementsNames,
      });
      exports.push(className);

      // Extract public methods from class body
      const body = firstChildOfType(node, 'declaration_list');
      if (body) {
        for (const member of body.namedChildren) {
          if (
            member.type === 'method_declaration' ||
            member.type === 'constructor_declaration'
          ) {
            const pub = hasPublicModifier(member);
            const mName = firstChildOfType(member, 'name');
            if (!mName) continue;
            if (pub) exports.push(`${className}.${mName.text}`);
            const mCalls = new Map<string, number>();
            const mBody = firstChildOfType(member, 'compound_statement');
            if (mBody) {
              collectCalls(mBody, mCalls);
              // Extract eloquent relationships from the method body
              const relations = extractEloquentRelations(mBody, importMap, currentNamespace);
              eloquentRelations.push(...relations);
              // Extract container resolutions from the method body
              const containers = extractContainerResolutions(mBody, importMap, currentNamespace);
              containerResolutions.push(...containers);
            }
            symbols.push({
              id: `${fileId}#${className}.${mName.text}`,
              name: `${className}.${mName.text}`,
              kind: 'method',
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              isExported: pub,
              calls: callsFromMap(mCalls, mName.text),
              implementsNames: [],
            });
          }
        }
      }

      // Also extract container resolutions from top-level class body statements
      const classContainers = extractContainerResolutions(body || node, importMap, currentNamespace);
      containerResolutions.push(...classContainers);

      return;
    }

    // Top-level function
    if (node.type === 'function_definition') {
      const nameNode = firstChildOfType(node, 'name');
      if (!nameNode) return;
      const fnName = nameNode.text;
      const fnCalls = new Map<string, number>();
      const fnBody = firstChildOfType(node, 'compound_statement');
      if (fnBody) collectCalls(fnBody, fnCalls);
      symbols.push({
        id: `${fileId}#${fnName}`,
        name: fnName,
        kind: 'function',
        startLine,
        endLine,
        isExported: true,
        calls: callsFromMap(fnCalls, fnName),
        implementsNames: [],
      });
      exports.push(fnName);
      return;
    }
  }

  // Suppress unused lint warning
  void childrenOfType;

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
    eloquentRelations: eloquentRelations.length > 0 ? eloquentRelations : undefined,
    containerResolutions: containerResolutions.length > 0 ? containerResolutions : undefined,
  };
}
