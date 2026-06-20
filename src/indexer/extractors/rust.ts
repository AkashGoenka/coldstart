import { createRequire } from 'node:module';
import type { SymbolNode, CallSite } from '../../types.js';
import { firstChildOfType } from './node-helpers.js';
import { makeParser } from './parser-factory.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rustGrammar = require('tree-sitter-rust') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

const getParser = makeParser(rustGrammar);

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function hasVisibilityPub(node: TSNode): boolean {
  // In tree-sitter-rust, `pub` appears as a visibility_modifier named child
  return node.namedChildren.some((c: TSNode) => c.type === 'visibility_modifier');
}

/** Recursively walk a node and collect call_expression callee names + first-seen line.
 *
 *  call_expression grammar has three callee shapes:
 *    foo()           → identifier              → text is the name
 *    baz::qux()      → scoped_identifier       → last :: segment is the name
 *    obj.method()    → field_expression        → field_identifier child is the name
 */
function collectCalls(node: TSNode, results: Map<string, number>): void {
  if (node.type === 'call_expression') {
    const callee = node.namedChildren[0];
    if (callee) {
      let name: string | null = null;
      if (callee.type === 'identifier') {
        name = callee.text;
      } else if (callee.type === 'scoped_identifier') {
        // last segment after '::'
        const segs = (callee.text as string).split('::');
        name = segs[segs.length - 1];
      } else if (callee.type === 'field_expression') {
        const fieldId = callee.namedChildren.find((c: TSNode) => c.type === 'field_identifier');
        if (fieldId) name = fieldId.text;
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

function callsFromMap(calls: Map<string, number>, exclude?: string): CallSite[] {
  const out: CallSite[] = [];
  for (const [name, line] of calls) {
    if (exclude && name === exclude) continue;
    out.push({ name, line });
  }
  return out;
}

// In-crate prefixes — these resolve to symbols within the current crate's
// module tree, not to other files in a workspace.
const NON_CRATE_USE_PREFIXES = new Set([
  'crate', 'super', 'self', 'Self',
  'std', 'core', 'alloc', 'proc_macro', 'test',
]);

/**
 * Pull the leading path of a `use` declaration as a `::`-separated string.
 * Trims everything from the first `{`, `*`, or `as` keyword onward, so:
 *   `use tokio::sync::Mutex;`            → "tokio::sync::Mutex"
 *   `use tokio::sync::{Mutex, RwLock};`  → "tokio::sync"
 *   `use tokio::*;`                      → "tokio"
 *   `use tokio::sync as s;`              → "tokio::sync"
 * Returns null for `use crate::…`, `use std::…`, `use {…}` group-only, etc.
 */
function extractUsePath(node: TSNode): string | null {
  let text: string;
  try { text = node.text; } catch { return null; }
  if (!text) return null;
  // Strip `pub`/`pub(crate)` and `use` prefix, plus trailing `;`
  const body = text
    .replace(/^\s*(pub(\s*\([^)]*\))?\s+)?use\s+/, '')
    .replace(/;\s*$/, '')
    .trim();
  if (!body) return null;
  // Cut at the first `{`, `*`, or whitespace+`as`+whitespace
  const asMatch = body.match(/\bas\b/);
  const cuts = [body.indexOf('{'), body.indexOf('*'), asMatch ? asMatch.index! : -1]
    .filter(i => i >= 0);
  const cut = cuts.length ? Math.min(...cuts) : body.length;
  // Match a leading rust path: ident (:: ident)*
  const pathMatch = body.slice(0, cut).match(/^[A-Za-z_][A-Za-z0-9_]*(\s*::\s*[A-Za-z_][A-Za-z0-9_]*)*/);
  if (!pathMatch) return null;
  const path = pathMatch[0].replace(/\s+/g, '');
  const firstSeg = path.split('::')[0];
  if (NON_CRATE_USE_PREFIXES.has(firstSeg)) return null;
  return path;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RustParseResult {
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

export function parseRustContent(
  content: string,
  fileId: string,
): RustParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Rust (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  function visitNode(node: TSNode, parentName?: string): void {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // use X::Y — for sibling crates this is a cross-crate file edge, so we emit
    // the full path string (e.g. "tokio_util::codec::Decoder") and let the Rust
    // resolver decide: if the leading segment matches a workspace crate, resolve
    // into that crate's src/; otherwise drop the specifier. In-crate paths
    // (crate::, super::, self::, Self::) are filtered out here because they
    // never produce file-level edges — they're symbol-level scoping.
    //
    // Single-segment uses (`use foo;`) get a trailing `::` so the resolver and
    // the workspace pre-filter can distinguish them from mod declarations.
    if (node.type === 'use_declaration') {
      const usePath = extractUsePath(node);
      if (usePath) imports.push(usePath.includes('::') ? usePath : usePath + '::');
      return;
    }

    // pub mod X;  (file module declaration, treated as import)
    // mod X {}    (inline module — recurse into body)
    if (node.type === 'mod_item') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) return;
      const body = firstChildOfType(node, 'declaration_list');
      if (!body) {
        // mod X; — declaration-only, treat as import-like
        imports.push(nameNode.text);
        return;
      }
      // Inline mod: recurse
      for (const child of body.namedChildren) visitNode(child, nameNode.text);
      return;
    }

    // extern crate X — semantically a crate import (same as `use X;`), so emit
    // with a trailing `::` to share the workspace filtering path.
    if (node.type === 'extern_crate_declaration') {
      const nameNode = firstChildOfType(node, 'identifier');
      if (nameNode && !NON_CRATE_USE_PREFIXES.has(nameNode.text)) {
        imports.push(nameNode.text + '::');
      }
      return;
    }

    // pub fn / pub async fn
    if (node.type === 'function_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'identifier');
      if (!nameNode) return;
      const fnName = parentName ? `${parentName}::${nameNode.text}` : nameNode.text;
      const callsMap = new Map<string, number>();
      const body = firstChildOfType(node, 'block');
      if (body) collectCalls(body, callsMap);
      symbols.push({
        id: `${fileId}#${fnName}`,
        name: fnName,
        kind: 'function',
        startLine,
        endLine,
        isExported: pub,
        calls: callsFromMap(callsMap, nameNode.text),
        implementsNames: [],
      });
      if (pub && !parentName) exports.push(nameNode.text);
      return;
    }

    // pub struct
    if (node.type === 'struct_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (!nameNode) return;
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
      return;
    }

    // pub enum
    if (node.type === 'enum_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (!nameNode) return;
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
      return;
    }

    // pub trait
    if (node.type === 'trait_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (!nameNode) return;
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
      return;
    }

    // pub type Alias = ...
    if (node.type === 'type_item') {
      const pub = hasVisibilityPub(node);
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (!nameNode) return;
      const name = nameNode.text;
      symbols.push({
        id: `${fileId}#${name}`,
        name,
        kind: 'type',
        startLine,
        endLine,
        isExported: pub,
        calls: [],
        implementsNames: [],
      });
      if (pub) exports.push(name);
      return;
    }

    // impl Trait for Struct — extract implementsNames on the struct symbol
    if (node.type === 'impl_item') {
      const typeNodes = node.namedChildren.filter(
        (c: TSNode) => c.type === 'type_identifier' || c.type === 'generic_type',
      );
      if (typeNodes.length >= 2) {
        // impl TraitName for StructName
        const traitName = typeNodes[0].text;
        const structName = typeNodes[typeNodes.length - 1].text;
        const structSym = symbols.find(s => s.name === structName);
        if (structSym) {
          if (!structSym.implementsNames.includes(traitName)) {
            structSym.implementsNames.push(traitName);
          }
        }
      }
      // Recurse into impl body to pick up pub fns
      const body = firstChildOfType(node, 'declaration_list');
      if (body) {
        // Determine impl target for naming
        const structType = typeNodes[typeNodes.length - 1];
        const implParent = structType?.text;
        for (const child of body.namedChildren) visitNode(child, implParent);
      }
      return;
    }
  }

  for (const node of root.namedChildren) {
    visitNode(node);
  }

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
  };
}
