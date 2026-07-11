import groovyRawModule from 'tree-sitter-groovy';
import type { SymbolNode } from '../../types.js';
import { childrenOfType, firstChildOfType } from './node-helpers.js';
import { makeParser } from './parser-factory.js';

const groovyModule = groovyRawModule as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

const getParser = makeParser(groovyModule, { pkg: 'tree-sitter-groovy', wasm: 'tree-sitter-groovy.wasm' });

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface GroovyParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract string literal value from a node (e.g., character_literal or string_literal).
 * Handles both single and double quotes.
 */
function unquoteString(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Get the first string argument from an argument_list.
 */
function getFirstStringArg(argList: TSNode): string | null {
  if (!argList) return null;
  // argument_list children are: ( arg1, arg2, ... )
  // Named children will be the actual expressions
  const args = argList.namedChildren;
  if (args.length === 0) return null;
  const firstArg = args[0];
  const text = firstArg.text.trim();
  return unquoteString(text);
}

/**
 * Extract dependency coordinate from a string like 'org.springframework:boot:3.0'
 * and return the artifact name (middle segment).
 */
function extractArtifactFromCoord(coord: string): string | null {
  const parts = coord.split(':');
  if (parts.length < 2) return null;
  return parts[1]; // Return artifact (middle segment)
}

/**
 * Extract the value of a named key in a map_item context.
 * Looks for a sequence: identifier "key" : expression(s).
 */
function extractMapValue(mapItems: TSNode[], keyName: string): string | null {
  for (const item of mapItems) {
    if (item.type !== 'map_item') continue;
    const children = item.namedChildren;
    if (children.length < 2) continue;
    // First child should be the key identifier
    if (children[0].type === 'identifier' && children[0].text === keyName) {
      // Second or later child should be the value (after the ':')
      for (let i = 1; i < children.length; i++) {
        const child = children[i];
        if (child.type === 'character_literal' || child.type === 'string_literal') {
          const raw = child.text.trim();
          return unquoteString(raw);
        }
      }
    }
  }
  return null;
}

/**
 * Walk juxt_function_call or method_invocation nodes and extract DSL anchors.
 */
function extractFromTopLevel(
  node: TSNode,
  symbols: SymbolNode[],
  seen: Set<string>,
  fileId: string,
): void {
  // Pattern 1: task NAME { ... } or task(NAME) { ... }
  if (node.type === 'juxt_function_call') {
    const children = node.namedChildren;
    if (children.length === 0) return;
    const fnName = children[0];

    if (fnName.type === 'identifier' && fnName.text === 'task') {
      // juxt_function_call with identifier 'task' and argument_list
      const argList = firstChildOfType(node, 'argument_list');
      if (argList) {
        const taskName = getFirstStringArg(argList);
        if (taskName && !seen.has(taskName)) {
          seen.add(taskName);
          symbols.push({
            id: `${fileId}#${taskName}`,
            name: taskName,
            kind: 'constant',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
        }
      }
    }

    // Pattern: implementation, api, compileOnly, etc. (dependency declarations)
    const depConfigs = ['implementation', 'api', 'compileOnly', 'runtimeOnly', 'testImplementation', 'annotationProcessor'];
    if (depConfigs.includes(fnName.text)) {
      const argList = firstChildOfType(node, 'argument_list');
      if (argList) {
        // Map form first: implementation group: 'g', name: 'a', version: 'v'
        const mapItems = childrenOfType(argList, 'map_item');
        let extracted: string | null = null;
        if (mapItems.length > 0) {
          extracted = extractMapValue(mapItems, 'name');
        } else {
          // String coord form: 'group:artifact:version'
          const firstStringArg = getFirstStringArg(argList);
          if (firstStringArg) extracted = extractArtifactFromCoord(firstStringArg);
        }
        if (extracted && !seen.has(extracted)) {
          seen.add(extracted);
          symbols.push({
            id: `${fileId}#${extracted}`,
            name: extracted,
            kind: 'constant',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
        }
      }
    }

    // Pattern: id('org.springframework.boot') inside plugins block
    if (fnName.text === 'id') {
      const argList = firstChildOfType(node, 'argument_list');
      if (argList) {
        const pluginId = getFirstStringArg(argList);
        if (pluginId && !seen.has(pluginId)) {
          seen.add(pluginId);
          symbols.push({
            id: `${fileId}#${pluginId}`,
            name: pluginId,
            kind: 'constant',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
        }
      }
    }

    // Pattern: stage('Build') inside Jenkinsfile
    if (fnName.text === 'stage') {
      const argList = firstChildOfType(node, 'argument_list');
      if (argList) {
        const stageName = getFirstStringArg(argList);
        if (stageName && !seen.has(stageName)) {
          seen.add(stageName);
          symbols.push({
            id: `${fileId}#${stageName}`,
            name: stageName,
            kind: 'constant',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
        }
      }
    }
  }

  // Pattern 2: method_invocation for tasks.register, tasks.create, stage, environment, etc.
  if (node.type === 'method_invocation') {
    const children = node.namedChildren;
    let methodName = '';

    // Find the method name (last identifier — for `tasks.register` the LAST is `register`;
    // for plain `stage(...)` the only identifier IS the method name).
    for (let i = 0; i < children.length; i++) {
      if (children[i].type === 'identifier') methodName = children[i].text;
    }

    // Pattern: tasks.register("NAME") or tasks.create("NAME") or stage('NAME')
    if (methodName === 'register' || methodName === 'create' || methodName === 'stage') {
      const argList = firstChildOfType(node, 'argument_list');
      if (argList) {
        const targetName = getFirstStringArg(argList);
        if (targetName && !seen.has(targetName)) {
          seen.add(targetName);
          symbols.push({
            id: `${fileId}#${targetName}`,
            name: targetName,
            kind: 'constant',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            isExported: true,
            calls: [],
            implementsNames: [],
          });
        }
      }
    }
  }
}

/**
 * Walk inside a closure to extract dependency config and environment variables.
 */
function walkClosureForDeps(
  closure: TSNode,
  blockName: string,
  symbols: SymbolNode[],
  seen: Set<string>,
  fileId: string,
): void {
  if (!closure || closure.type !== 'closure') return;

  // Walk closure children and recurse into nested method_invocations
  // (so pipeline → stages → stage and dependencies → implementation all reach).
  // Tree-sitter-groovy sometimes packs adjacent stage() calls into a single
  // juxt_function_call when they appear without separators — descend into any
  // nested method_invocation children to recover those.
  for (const stmt of closure.namedChildren) {
    let expr: TSNode | null = stmt;
    if (stmt.type === 'expression_statement') {
      expr = firstChildOfType(stmt, 'juxt_function_call') ||
             firstChildOfType(stmt, 'method_invocation');
    }
    if (!expr) continue;
    if (expr.type === 'juxt_function_call') {
      extractFromTopLevel(expr, symbols, seen, fileId);
      // Recover nested method_invocations the parser packed into this juxt
      // (e.g. `stage('Build') { } stage('Deploy')` → first is method_invocation).
      for (const child of expr.namedChildren) {
        if (child.type === 'method_invocation') {
          walkMethodInvocations(child, symbols, seen, fileId);
        }
      }
    } else if (expr.type === 'method_invocation') {
      walkMethodInvocations(expr, symbols, seen, fileId);
    }
  }

  // Inside environment { }, look for assignment_expression nodes (KEY = value).
  // Some assignments are wrapped in expression_statement, others appear directly
  // as a closure child — handle both shapes.
  if (blockName === 'environment') {
    for (const stmt of closure.namedChildren) {
      let expr: TSNode | null = null;
      if (stmt.type === 'assignment_expression') {
        expr = stmt;
      } else if (stmt.type === 'expression_statement') {
        expr = firstChildOfType(stmt, 'assignment_expression');
      }
      if (expr) {
        const lhs = expr.namedChildren.find((c: TSNode) => c.type === 'identifier');
        if (lhs) {
          const envKey = lhs.text;
          if (envKey && !seen.has(envKey)) {
            seen.add(envKey);
            symbols.push({
              id: `${fileId}#${envKey}`,
              name: envKey,
              kind: 'constant',
              startLine: expr.startPosition.row + 1,
              endLine: expr.endPosition.row + 1,
              isExported: true,
              calls: [],
              implementsNames: [],
            });
          }
        }
      }
    }
  }
}

/**
 * Walk method_invocation for `dependencies { ... }`, `plugins { ... }`, `environment { ... }`.
 */
function walkMethodInvocations(
  node: TSNode,
  symbols: SymbolNode[],
  seen: Set<string>,
  fileId: string,
): void {
  if (node.type !== 'method_invocation') return;

  // First: try the direct-invocation patterns (stage('X'), tasks.register('Y'))
  extractFromTopLevel(node, symbols, seen, fileId);

  const children = node.namedChildren;
  let methodName = '';
  for (const child of children) {
    if (child.type === 'identifier') methodName = child.text;
  }

  // Block DSLs whose closure contains anchors we want to extract from.
  // pipeline/stages/subprojects/allprojects are transparent containers — descend through.
  const blockDsls = [
    'dependencies', 'plugins', 'environment', 'repositories',
    'allprojects', 'subprojects', 'pipeline', 'stages',
  ];
  if (blockDsls.includes(methodName)) {
    const closure = firstChildOfType(node, 'closure');
    walkClosureForDeps(closure, methodName, symbols, seen, fileId);
  }
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

export function parseGroovyContent(
  content: string,
  fileId: string,
): GroovyParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Groovy (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const symbols: SymbolNode[] = [];
  const seen = new Set<string>();

  // Walk top-level statements
  for (const node of root.namedChildren) {
    if (node.type === 'expression_statement') {
      // Could be: tasks.register(...), dependencies { ... }, plugins { ... }
      const expr = firstChildOfType(node, 'juxt_function_call') ||
                   firstChildOfType(node, 'method_invocation');
      if (expr) {
        if (expr.type === 'juxt_function_call') {
          extractFromTopLevel(expr, symbols, seen, fileId);
        } else {
          walkMethodInvocations(expr, symbols, seen, fileId);
        }
      }
    }
    // Also handle direct juxt_function_call or method_invocation at top level
    if (node.type === 'juxt_function_call') {
      extractFromTopLevel(node, symbols, seen, fileId);
    }
    if (node.type === 'method_invocation') {
      walkMethodInvocations(node, symbols, seen, fileId);
    }
  }

  return {
    imports: [],
    exports: symbols.map(s => s.name),
    hasDefaultExport: false,
    symbols,
  };
}
