import { createRequire } from 'node:module';
import type { SymbolNode, CallSite } from '../../types.js';

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

/** Recursively walk a node and collect call_expression callee names + first-seen line.
 *
 * Kotlin call_expression shapes:
 *   - Simple call:   simple_identifier  call_suffix
 *                    e.g. verifyPassword(...)  → name = "verifyPassword"
 *   - Member call:   navigation_expression  call_suffix
 *                    navigation_expression = receiver  navigation_suffix(.methodName)
 *                    e.g. tokenService.sign(...) → name = "sign"
 */
function collectCalls(node: TSNode, results: Map<string, number>): void {
  if (node.type === 'call_expression') {
    const callee = node.namedChildren[0];
    let name: string | undefined;
    if (callee?.type === 'simple_identifier') {
      name = callee.text;
    } else if (callee?.type === 'navigation_expression') {
      // last named child of navigation_expression is navigation_suffix
      const suffix = callee.namedChildren[callee.namedChildren.length - 1];
      if (suffix?.type === 'navigation_suffix') {
        const id = suffix.namedChildren.find((c: TSNode) => c.type === 'simple_identifier');
        if (id) name = id.text;
      }
    }
    if (name && !results.has(name)) {
      results.set(name, node.startPosition.row + 1);
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
  let packageName = '';

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

  function capturePackage(header: TSNode): void {
    const identifier = header.namedChildren.find(
      (c: TSNode) => c.type === 'identifier',
    );
    if (identifier) {
      packageName = identifier.text;
    } else if (header.text) {
      packageName = header.text.replace(/^package\s+/, '').trim();
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

    // package_header — top-level, before imports
    if (node.type === 'package_header') {
      capturePackage(node);
      continue;
    }

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
            const mCalls = new Map<string, number>();
            const mBody = member.namedChildren.find(
              (c: TSNode) => c.type === 'function_body' || c.type === 'block',
            );
            if (mBody) collectCalls(mBody, mCalls);
            symbols.push({
              id: `${fileId}#${className}.${mName.text}`,
              name: `${className}.${mName.text}`,
              kind: 'method',
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              isExported: mPub,
              calls: callsFromMap(mCalls, mName.text),
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
      const fnCalls = new Map<string, number>();
      const fnBody = node.namedChildren.find(
        (c: TSNode) => c.type === 'function_body' || c.type === 'block',
      );
      if (fnBody) collectCalls(fnBody, fnCalls);
      symbols.push({
        id: `${fileId}#${fnName}`,
        name: fnName,
        kind: 'function',
        startLine,
        endLine,
        isExported: pub,
        calls: callsFromMap(fnCalls, fnName),
        implementsNames: [],
      });
      if (pub) exports.push(fnName);
      continue;
    }
  }

  // Same-package short-name qualification (mirror of Java extractor).
  // Kotlin shares Java package semantics — see coldstart/docs/jvm-same-package-spec.md.
  if (packageName) {
    const importedBasenames = new Set<string>();
    for (const fqcn of imports) {
      const last = fqcn.split('.').pop();
      if (last) importedBasenames.add(last);
    }
    const bareRefs = collectBareKotlinTypeReferences(root);
    for (const name of bareRefs) {
      if (!name) continue;
      const first = name.charCodeAt(0);
      if (first < 65 || first > 90) continue; // not A-Z
      if (JVM_SHORTLIST.has(name)) continue;
      if (importedBasenames.has(name)) continue;
      imports.push(`${packageName}.${name}`);
    }
  }

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols,
  };
}

// ---------------------------------------------------------------------------
// Same-package short-name qualification
// ---------------------------------------------------------------------------

const JVM_SHORTLIST = new Set([
  // java.lang types
  'String', 'Object', 'Integer', 'Long', 'Boolean', 'Double', 'Float',
  'Character', 'Byte', 'Short', 'Void', 'Number', 'Math', 'System',
  'Thread', 'Runnable', 'Exception', 'RuntimeException', 'Throwable',
  'Error', 'Class', 'Enum', 'Iterable', 'Comparable', 'CharSequence',
  'StringBuilder', 'StringBuffer', 'AutoCloseable',
  // common java.lang annotations
  'Override', 'Deprecated', 'SuppressWarnings', 'SafeVarargs',
  'FunctionalInterface',
  // java.util — also commonly used from Kotlin
  'List', 'Map', 'Set', 'Collection', 'Iterator', 'Optional', 'Arrays',
  'Collections', 'Objects', 'ArrayList', 'LinkedList', 'HashMap',
  'LinkedHashMap', 'TreeMap', 'HashSet', 'LinkedHashSet', 'TreeSet',
  'Queue', 'Deque', 'ArrayDeque', 'Stack', 'Vector', 'Properties',
  'Date', 'Calendar', 'TimeZone', 'UUID', 'Random', 'Locale',
  'Comparator', 'Scanner', 'EnumSet', 'EnumMap', 'BitSet',
  // java.util.function / stream / io / time / concurrent
  'Function', 'BiFunction', 'Predicate', 'BiPredicate', 'Consumer',
  'BiConsumer', 'Supplier', 'UnaryOperator', 'BinaryOperator',
  'Stream', 'IntStream', 'LongStream', 'DoubleStream', 'Collectors',
  'File', 'IOException', 'InputStream', 'OutputStream', 'Reader',
  'Writer', 'BufferedReader', 'BufferedWriter', 'PrintWriter',
  'FileNotFoundException', 'Serializable',
  'Instant', 'LocalDate', 'LocalDateTime', 'LocalTime', 'Duration',
  'Period', 'ZoneId', 'ZoneOffset', 'ZonedDateTime', 'OffsetDateTime',
  'CompletableFuture', 'CompletionStage', 'Future', 'ExecutorService',
  'Executor', 'Executors', 'TimeUnit', 'ConcurrentHashMap',
  'ConcurrentMap', 'AtomicInteger', 'AtomicLong', 'AtomicBoolean',
  'AtomicReference',
  // kotlin built-ins commonly used as bare names
  'Any', 'Unit', 'Nothing', 'Int', 'MutableList',
  'MutableMap', 'MutableSet', 'Array', 'Pair', 'Triple', 'Result',
  'Sequence',
  // common kotlin annotations
  'JvmStatic', 'JvmField', 'JvmOverloads', 'Throws', 'Target', 'Retention',
]);

function collectBareKotlinTypeReferences(root: TSNode): Set<string> {
  const bare = new Set<string>();
  function visit(node: TSNode): void {
    // Skip function/constructor bodies — same-package refs only from signatures (perf).
    if (node.type === 'function_body' || node.type === 'getter' || node.type === 'setter') {
      return;
    }
    if (node.type === 'user_type') {
      const id = node.namedChildren.find(
        (c: TSNode) => c.type === 'simple_identifier' || c.type === 'type_identifier',
      );
      if (id && !node.text.includes('.')) bare.add(id.text);
    } else if (node.type === 'type_identifier') {
      bare.add(node.text);
    } else if (node.type === 'annotation') {
      const userType = node.namedChildren.find((c: TSNode) => c.type === 'user_type');
      if (userType && !userType.text.includes('.')) {
        const id = userType.namedChildren.find(
          (c: TSNode) => c.type === 'simple_identifier' || c.type === 'type_identifier',
        );
        if (id) bare.add(id.text);
      }
    }
    for (const child of node.namedChildren) visit(child);
  }
  visit(root);
  return bare;
}
