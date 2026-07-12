import type { SymbolNode, CallSite } from '../../types.js';
import { childrenOfType, firstChildOfType, sameNode } from './node-helpers.js';
import { makeParser } from './parser-factory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

const getParser = makeParser({ vendored: 'tree-sitter-python.wasm' });

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

/** Return true if a name is considered public (no leading underscore). */
function isPublicName(name: string): boolean {
  return !name.startsWith('_');
}

/** Extract string values from a __all__ list literal. */
function extractAllList(node: TSNode): string[] {
  // node is assignment: __all__ = [...]
  const right = node.namedChildren[node.namedChildren.length - 1];
  if (!right) return [];
  const results: string[] = [];
  for (const child of right.namedChildren) {
    if (child.type === 'string') {
      // string content is inside a string_content child or we can strip quotes from text
      const text = child.text.replace(/^['"]|['"]$/g, '');
      results.push(text);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Call-site helpers
// ---------------------------------------------------------------------------

/** Recursively walk a node and collect call expression callee names + first-seen line.
 *  For bare calls (`foo(x)`) the callee is the identifier text.
 *  For attribute calls (`self.bar(x)`, `obj.method()`) the callee is the last
 *  identifier in the attribute chain (the method name, not the receiver). */
function collectCalls(node: TSNode, results: Map<string, number>): void {
  if (node.type === 'call') {
    const fnNode = node.childForFieldName('function');
    if (fnNode) {
      let name: string | undefined;
      if (fnNode.type === 'identifier') {
        name = fnNode.text;
      } else if (fnNode.type === 'attribute') {
        // attribute: receiver '.' method — last named child is the method identifier
        const children: TSNode[] = fnNode.namedChildren;
        name = children[children.length - 1]?.text;
      }
      if (name && !results.has(name)) {
        results.set(name, node.startPosition.row + 1);
      }
    }
  }
  for (const child of node.namedChildren) {
    collectCalls(child, results);
  }
}

function callsFromMap(calls: Map<string, number>): CallSite[] {
  const out: CallSite[] = [];
  for (const [name, line] of calls) {
    out.push({ name, line });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Django convention reference extraction
// ---------------------------------------------------------------------------

/** Extract string values from a list literal (for MIDDLEWARE, AUTHENTICATION_BACKENDS, etc.). */
function extractStringListLiterals(node: TSNode): string[] {
  const results: string[] = [];
  if (!node) return results;

  // Handle list/tuple literals: [ ... ] or ( ... )
  for (const child of node.namedChildren) {
    if (child.type === 'string') {
      const text = child.text.replace(/^['"]|['"]$/g, '');
      if (text) results.push(text);
    }
  }
  return results;
}

/** Extract string values from nested dict literals (for LOGGING, TEMPLATES config). */
function extractDictStringValues(node: TSNode): string[] {
  const results: string[] = [];
  if (!node) return results;

  function visit(n: TSNode): void {
    // When we find a string at any level, add it
    if (n.type === 'string') {
      const text = n.text.replace(/^['"]|['"]$/g, '');
      if (text) results.push(text);
    }
    // Recurse into dict values and list children
    for (const child of n.namedChildren) {
      visit(child);
    }
  }
  visit(node);
  return results;
}

/** Extract settings.py Django convention references. */
function collectDjangoConventionRefs(root: TSNode): Array<{ kind: string; value: string }> {
  const out: Array<{ kind: string; value: string }> = [];
  const seen = new Set<string>();

  for (const node of root.namedChildren) {
    // Look for assignment: MIDDLEWARE = [...] or ROOT_URLCONF = "..."
    if (node.type === 'expression_statement') {
      const assign = firstChildOfType(node, 'assignment');
      if (!assign) continue;

      const lhs = assign.namedChildren[0];
      if (!lhs || lhs.type !== 'identifier') continue;

      const varName = lhs.text;
      const rhs = assign.namedChildren[assign.namedChildren.length - 1];
      if (!rhs) continue;

      let refs: string[] = [];
      let kind = '';

      // Single string assignment: ROOT_URLCONF / WSGI_APPLICATION / ASGI_APPLICATION = "..."
      if (varName === 'ROOT_URLCONF' || varName === 'WSGI_APPLICATION' || varName === 'ASGI_APPLICATION') {
        kind = varName === 'ROOT_URLCONF' ? 'urlconf' : varName === 'WSGI_APPLICATION' ? 'wsgi' : 'asgi';
        if (rhs.type === 'string') {
          refs = [rhs.text.replace(/^['"]|['"]$/g, '')];
        }
      }
      // List assignments: MIDDLEWARE, AUTHENTICATION_BACKENDS, etc.
      else if (varName === 'MIDDLEWARE' || varName === 'AUTHENTICATION_BACKENDS') {
        kind = varName.toLowerCase().replace(/_/g, '');
        refs = extractStringListLiterals(rhs);
      }
      // TEMPLATES is a list of dicts
      else if (varName === 'TEMPLATES') {
        kind = 'templates';
        refs = extractDictStringValues(rhs);
      }
      // LOGGING is a dict — only dotted strings can be module paths (e.g. 'logging.FileHandler');
      // bare strings ('DEBUG', 'verbose', handler nicknames, dict keys) are not importable.
      else if (varName === 'LOGGING') {
        kind = 'logging';
        refs = extractDictStringValues(rhs).filter(s => s.includes('.'));
      }

      // Add non-duplicate refs
      if (kind) {
        for (const ref of refs) {
          const key = `${kind}:${ref}`;
          if (ref && !seen.has(key)) {
            seen.add(key);
            out.push({ kind, value: ref });
          }
        }
      }
    }
  }

  // Also look for include() calls in urls.py
  if (root.namedChildren) {
    collectUrlsIncludes(root, out, seen);
  }

  // Look for importlib.import_module() calls with literal strings
  collectImportlibCalls(root, out, seen);

  return out;
}

/** Extract include("...") calls from urls.py. */
function collectUrlsIncludes(root: TSNode, out: Array<{ kind: string; value: string }>, seen: Set<string>): void {
  function visit(node: TSNode): void {
    // Match: call( function=identifier("include"), arguments=argument_list(...) )
    if (node.type === 'call') {
      const fnNode = node.childForFieldName('function');
      if (fnNode?.type === 'identifier' && fnNode.text === 'include') {
        // Get argument list
        const argList = firstChildOfType(node, 'argument_list');
        if (argList) {
          for (const arg of argList.namedChildren) {
            if (arg.type === 'string') {
              const text = arg.text.replace(/^['"]|['"]$/g, '');
              const key = `urlconf:${text}`;
              if (text && !seen.has(key)) {
                seen.add(key);
                out.push({ kind: 'urlconf', value: text });
              }
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  }
  visit(root);
}

/** Extract importlib.import_module("...") calls with literal strings. */
function collectImportlibCalls(root: TSNode, out: Array<{ kind: string; value: string }>, seen: Set<string>): void {
  function visit(node: TSNode): void {
    // Match: call where the function is an attribute
    if (node.type === 'call') {
      const fnNode = node.childForFieldName?.('function') ?? node.namedChildren[0];
      if (fnNode?.type === 'attribute') {
        // Attribute structure: [object, '.', attr]
        const children = fnNode.namedChildren;
        if (children.length >= 2) {
          const objNode = children[0];
          const attrNode = children[children.length - 1];
          if (objNode?.text === 'importlib' && attrNode?.text === 'import_module') {
            // Get argument list
            const argList = firstChildOfType(node, 'argument_list');
            if (argList) {
              for (const arg of argList.namedChildren) {
                if (arg.type === 'string') {
                  const text = arg.text.replace(/^['"]|['"]$/g, '');
                  const key = `importlib:${text}`;
                  if (text && !seen.has(key)) {
                    seen.add(key);
                    out.push({ kind: 'importlib', value: text });
                  }
                }
              }
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  }
  visit(root);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PythonParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
  djangoConventionRefs?: Array<{ kind: string; value: string }>;
  submoduleImportCandidates?: string[];
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

export function parsePythonContent(
  content: string,
  fileId: string,
): PythonParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Python (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const submoduleCandidates: string[] = [];
  const symbols: SymbolNode[] = [];
  let allList: string[] | null = null;

  for (const node of root.namedChildren) {
    // from X import Y  /  import X
    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName?.('module_name') ??
        firstChildOfType(node, 'dotted_name') ??
        firstChildOfType(node, 'relative_import');
      if (!moduleNode) continue;
      const moduleText = moduleNode.text;
      imports.push(moduleText);
      // `from pkg import submodule` depends on pkg/submodule.py, not just the
      // pkg __init__. Emit `module.name` BONUS candidates so the resolver can
      // pick up the submodule file when one exists. These are kept separate
      // from `imports` because most names are symbols (`from x import Klass`)
      // that legitimately don't map to a file — counting their misses as
      // "unresolved" would massively inflate the diagnostic counter. Bare
      // relative dots ('.', '..') join without an extra dot.
      const sep = /^\.+$/.test(moduleText) ? '' : '.';
      for (const child of node.namedChildren) {
        if (sameNode(child, moduleNode)) continue;
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          const nm = child.type === 'aliased_import'
            ? firstChildOfType(child, 'dotted_name')?.text
            : child.text;
          if (nm) submoduleCandidates.push(`${moduleText}${sep}${nm}`);
        }
      }
      continue;
    }
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          const name = child.type === 'aliased_import'
            ? firstChildOfType(child, 'dotted_name')?.text ?? child.text
            : child.text;
          imports.push(name);
        }
      }
      continue;
    }

    // __all__ = [...] and module-level constants
    if (node.type === 'expression_statement') {
      const assign = firstChildOfType(node, 'assignment');
      if (assign) {
        const lhs = assign.namedChildren[0];
        if (lhs?.text === '__all__') {
          allList = extractAllList(assign);
          continue;
        }

        // Top-level module constant: identifier matching UPPER_SNAKE pattern
        if (lhs?.type === 'identifier') {
          const constName = lhs.text;
          // Match UPPER_SNAKE: optional leading underscore(s), then letter, then all caps with digits/underscores, length >= 2
          if (/^_*[A-Z][A-Z0-9_]*$/.test(constName) && constName.length >= 2) {
            symbols.push({
              id: `${fileId}#${constName}`,
              name: constName,
              kind: 'constant',
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              isExported: isPublicName(constName),
              calls: [],
              implementsNames: [],
            });
          }
        }
      }
      continue;
    }

    // Top-level class
    if (node.type === 'class_definition') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) continue;
      const className = nameNode.text;
      const pub = isPublicName(className);

      // Inheritance: argument_list contains the base classes
      let extendsName: string | undefined;
      const argList = firstChildOfType(node, 'argument_list');
      if (argList) {
        const firstBase = argList.namedChildren.find(
          (c: TSNode) => c.type === 'identifier' || c.type === 'attribute',
        );
        if (firstBase) extendsName = firstBase.text;
      }

      symbols.push({
        id: `${fileId}#${className}`,
        name: className,
        kind: 'class',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: pub,
        calls: [],
        extendsName,
        implementsNames: [],
      });

      // Extract methods from class body
      const body = firstChildOfType(node, 'block');
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === 'function_definition' || member.type === 'decorated_definition') {
            const fnNode = member.type === 'decorated_definition'
              ? firstChildOfType(member, 'function_definition')
              : member;
            if (!fnNode) continue;
            const fnName = firstChildOfType(fnNode, 'identifier');
            if (!fnName) continue;
            const methodBodyNode = firstChildOfType(fnNode, 'block');
            const callMap = new Map<string, number>();
            if (methodBodyNode) collectCalls(methodBodyNode, callMap);
            symbols.push({
              id: `${fileId}#${className}.${fnName.text}`,
              name: `${className}.${fnName.text}`,
              kind: 'method',
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              isExported: false,
              calls: callsFromMap(callMap),
              implementsNames: [],
            });
          }
        }
      }
      continue;
    }

    // Top-level function
    if (node.type === 'function_definition' || node.type === 'decorated_definition') {
      const fnNode = node.type === 'decorated_definition'
        ? firstChildOfType(node, 'function_definition')
        : node;
      if (!fnNode) continue;
      const nameNode = firstChildOfType(fnNode, 'identifier');
      if (!nameNode) continue;
      const fnName = nameNode.text;
      const fnBodyNode = firstChildOfType(fnNode, 'block');
      const callMap = new Map<string, number>();
      if (fnBodyNode) collectCalls(fnBodyNode, callMap);
      symbols.push({
        id: `${fileId}#${fnName}`,
        name: fnName,
        kind: 'function',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: isPublicName(fnName),
        calls: callsFromMap(callMap),
        implementsNames: [],
      });
      continue;
    }
  }

  // Determine exports: __all__ takes precedence; otherwise all public symbols
  let exports: string[];
  if (allList !== null) {
    exports = allList;
  } else {
    exports = symbols
      .filter(s => s.isExported && s.kind !== 'method')
      .map(s => s.name);
  }

  // Mark isExported on symbols based on __all__ when present
  if (allList !== null) {
    const allSet = new Set(allList);
    for (const sym of symbols) {
      if (sym.kind !== 'method') {
        sym.isExported = allSet.has(sym.name);
      }
    }
  }

  // Collect Django convention references (settings.py, urls.py, etc.)
  const djangoConventionRefs = collectDjangoConventionRefs(root);

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
    djangoConventionRefs: djangoConventionRefs.length > 0 ? djangoConventionRefs : undefined,
    submoduleImportCandidates: submoduleCandidates.length > 0 ? [...new Set(submoduleCandidates)] : undefined,
  };
}
