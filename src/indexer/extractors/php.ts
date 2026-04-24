import { createRequire } from 'node:module';
import type { SymbolNode } from '../../types.js';

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

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

function childrenOfType(node: TSNode, type: string): TSNode[] {
  return node.namedChildren.filter((c: TSNode) => c.type === type);
}

function hasPublicModifier(node: TSNode): boolean {
  // In tree-sitter-php, modifiers are named children of type 'modifier' or appear as keywords
  return node.namedChildren.some(
    (c: TSNode) =>
      (c.type === 'modifier' && c.text === 'public') ||
      c.type === 'public',
  );
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PhpParseResult {
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
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  // Walk the PHP document (which may have a program child)
  const program = firstChildOfType(root, 'program') ?? root;

  for (const node of program.namedChildren) {
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
          if (name) imports.push(name.text);
        } else if (clause.type === 'qualified_name' || clause.type === 'name') {
          imports.push(clause.text);
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
            symbols.push({
              id: `${fileId}#${className}.${mName.text}`,
              name: `${className}.${mName.text}`,
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
      return;
    }

    // Top-level function
    if (node.type === 'function_definition') {
      const nameNode = firstChildOfType(node, 'name');
      if (!nameNode) return;
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
  };
}
