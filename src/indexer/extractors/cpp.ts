import { createRequire } from 'node:module';
import type { SymbolNode, CallSite } from '../../types.js';
import { firstChildOfType } from './node-helpers.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cppGrammar = require('tree-sitter-cpp') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cppParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!cppParser) {
    cppParser = new ParserCtor();
    cppParser.setLanguage(cppGrammar);
  }
  return cppParser;
}

/** Recursively collect call_expression callee names + first-seen line in a subtree. */
function collectCalls(node: TSNode, results: Map<string, number>): void {
  if (node.type === 'call_expression') {
    const fn = node.namedChildren[0];
    let calleeName: string | null = null;
    if (fn) {
      if (fn.type === 'identifier') {
        // plain call: helper(x)
        calleeName = fn.text;
      } else if (fn.type === 'field_expression') {
        // member call: obj.method(args) — field_identifier is the method name
        const fieldId = fn.namedChildren.find((c: TSNode) => c.type === 'field_identifier');
        if (fieldId) calleeName = fieldId.text;
      } else if (fn.type === 'qualified_identifier') {
        // namespace call: ns::func(args) — last child is the identifier
        const last = fn.namedChildren.at(-1);
        if (last?.type === 'identifier') calleeName = last.text;
      }
    }
    if (calleeName && !results.has(calleeName)) {
      results.set(calleeName, node.startPosition.row + 1);
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

export interface CppParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
}

const MAX_STRING = 32000;
const CHUNK_SIZE = 4096;

// Headers we know cannot resolve to project files — drop at parse time so they
// don't pollute the unresolved metric and don't waste resolver work.
const STDLIB_EXACT = new Set([
  // C++ standard library
  'algorithm', 'array', 'atomic', 'bitset', 'cassert', 'cctype', 'cerrno',
  'cfloat', 'chrono', 'climits', 'cmath', 'codecvt', 'complex', 'condition_variable',
  'cstddef', 'cstdint', 'cstdio', 'cstdlib', 'cstring', 'ctime', 'cwchar', 'cwctype',
  'deque', 'exception', 'filesystem', 'forward_list', 'fstream', 'functional',
  'future', 'initializer_list', 'iomanip', 'ios', 'iosfwd', 'iostream', 'istream',
  'iterator', 'limits', 'list', 'locale', 'map', 'memory', 'mutex', 'new', 'numeric',
  'optional', 'ostream', 'queue', 'random', 'ratio', 'regex', 'set', 'shared_mutex',
  'sstream', 'stack', 'stdexcept', 'streambuf', 'string', 'string_view',
  'system_error', 'thread', 'tuple', 'type_traits', 'typeindex', 'typeinfo',
  'unordered_map', 'unordered_set', 'utility', 'valarray', 'variant', 'vector',
  // C standard library
  'assert.h', 'ctype.h', 'errno.h', 'float.h', 'limits.h', 'math.h', 'setjmp.h',
  'signal.h', 'stdarg.h', 'stddef.h', 'stdint.h', 'stdio.h', 'stdlib.h', 'string.h',
  'time.h', 'wchar.h', 'wctype.h',
  // POSIX
  'unistd.h', 'pthread.h', 'fcntl.h', 'dirent.h', 'sys/stat.h', 'sys/types.h',
  'sys/socket.h', 'sys/mman.h', 'sys/ioctl.h', 'sys/wait.h', 'sys/time.h',
  'sys/resource.h', 'sys/eventfd.h', 'sys/epoll.h', 'sys/inotify.h',
  'netinet/in.h', 'netinet/tcp.h', 'arpa/inet.h', 'netdb.h', 'poll.h', 'sched.h',
  'semaphore.h', 'syslog.h', 'termios.h',
  // Windows
  'windows.h', 'winsock2.h', 'ws2tcpip.h',
]);

const THIRD_PARTY_PREFIXES = [
  'boost/', 'gtest/', 'gmock/', 'benchmark/',
  'Qt5/', 'Qt6/', 'QtCore/', 'QtGui/', 'QtWidgets/', 'QtNetwork/',
  'fmt/', 'spdlog/', 'absl/', 'google/',
  'openssl/', 'zlib.h', 'png.h', 'jpeglib.h',
  'glib-2.0/', 'gio/', 'gtk/', 'cairo/', 'pango/',
  'eigen3/', 'Eigen/', 'opencv2/',
  'protobuf/', 'grpcpp/',
  'event2/', 'sodium/', 'secp256k1',
  'kj/', 'mp/', 'capnp/', 'univalue',
];

function isStdlibOrThirdParty(spec: string): boolean {
  if (STDLIB_EXACT.has(spec)) return true;
  for (const p of THIRD_PARTY_PREFIXES) if (spec.startsWith(p)) return true;
  // Heuristic: single-token no extension and no slash → almost certainly stdlib
  if (!spec.includes('/') && !spec.includes('.')) return true;
  return false;
}

function parseContent(parser: TSNode, content: string): TSNode {
  if (content.length <= MAX_STRING) return parser.parse(content);
  return parser.parse((startIndex: number) => {
    if (startIndex >= content.length) return null;
    return content.slice(startIndex, startIndex + CHUNK_SIZE);
  });
}

function extractName(node: TSNode): string | null {
  // Walk into pointer/reference declarators to find the actual identifier
  if (node.type === 'identifier' || node.type === 'field_identifier') return node.text;
  if (node.type === 'qualified_identifier') {
    // A::B → use just B for the symbol name
    const id = node.namedChildren.at(-1);
    return id ? extractName(id) : null;
  }
  if (node.type === 'pointer_declarator' || node.type === 'reference_declarator') {
    return extractName(node.namedChildren[0]);
  }
  if (node.type === 'function_declarator') {
    return extractName(firstChildOfType(node, 'identifier') ??
      firstChildOfType(node, 'qualified_identifier') ??
      node.namedChildren[0]);
  }
  return null;
}

export function parseCppContent(content: string, fileId: string): CppParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse C++ (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const symbols: SymbolNode[] = [];
  const exports: string[] = [];

  function visit(node: TSNode, scope?: string): void {
    // Skip ERROR subtrees — macro-expanded code often produces these
    if (node.type === 'ERROR') return;

    const startLine = node.startPosition.row + 1;
    const endLine   = node.endPosition.row + 1;

    // #include "foo.h" or #include <boost/asio.hpp>
    if (node.type === 'preproc_include') {
      // Quoted include: #include "path/to/file.h"
      const quoted = firstChildOfType(node, 'string_literal');
      if (quoted) {
        const raw = quoted.text.replace(/^"|"$/g, '');
        // Also filter third-party for quoted includes — they can't resolve locally
        if (raw && !isStdlibOrThirdParty(raw)) imports.push(raw);
        return;
      }
      // Angle-bracket include: #include <path/to/file.h>
      const sys = firstChildOfType(node, 'system_lib_string');
      if (sys) {
        const raw = sys.text.replace(/^<|>$/g, '');
        // Skip stdlib and third-party — let resolver handle only local includes
        if (raw && !isStdlibOrThirdParty(raw)) imports.push(raw);
      }
      return;
    }

    // class Foo / struct Foo
    if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
      const nameNode = firstChildOfType(node, 'type_identifier');
      if (nameNode && node.type !== 'ERROR') {
        const name = scope ? `${scope}::${nameNode.text}` : nameNode.text;
        symbols.push({
          id: `${fileId}#${name}`,
          name,
          kind: 'class',
          startLine,
          endLine,
          isExported: true,
          calls: [],
          implementsNames: [],
        });
        exports.push(nameNode.text);
        // Recurse into body for nested declarations
        const body = firstChildOfType(node, 'field_declaration_list');
        if (body) {
          for (const child of body.namedChildren) visit(child, nameNode.text);
        }
      }
      return;
    }

    // Function / method definition: return_type declarator body
    if (node.type === 'function_definition') {
      const declarator = node.namedChildren.find(
        (c: TSNode) => c.type === 'function_declarator' ||
          c.type === 'pointer_declarator' ||
          c.type === 'reference_declarator',
      );
      if (declarator) {
        const name = extractName(declarator);
        if (name) {
          const qualName = scope ? `${scope}::${name}` : name;
          const callsMap = new Map<string, number>();
          const body = firstChildOfType(node, 'compound_statement');
          if (body) collectCalls(body, callsMap);
          symbols.push({
            id: `${fileId}#${qualName}`,
            name: qualName,
            kind: scope ? 'method' : 'function',
            startLine,
            endLine,
            isExported: true,
            calls: callsFromMap(callsMap),
            implementsNames: [],
          });
          if (!scope) exports.push(name);
        }
      }
      return;
    }

    // namespace Foo { ... } — recurse with scope
    if (node.type === 'namespace_definition') {
      const nameNode = firstChildOfType(node, 'namespace_identifier') ?? firstChildOfType(node, 'identifier');
      const body = firstChildOfType(node, 'declaration_list');
      if (body) {
        const nsName = nameNode?.text;
        for (const child of body.namedChildren) visit(child, nsName);
      }
      return;
    }

    // extern "C" { ... } or extern "C" single-decl — recurse without new scope
    if (node.type === 'linkage_specification') {
      const body = firstChildOfType(node, 'declaration_list');
      if (body) {
        for (const child of body.namedChildren) visit(child, scope);
      } else {
        // extern "C" fn(...) { ... } — single function_definition, no braces
        for (const child of node.namedChildren) visit(child, scope);
      }
      return;
    }
  }

  for (const node of root.namedChildren) visit(node);

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
  };
}
