/**
 * Tree-sitter based parser for Java.
 * Extracts symbol-level nodes (classes, interfaces, methods, constructors, enums, fields)
 * and their relationships (calls, extends, implements, imports).
 *
 * Follows the same interface and patterns as ts-parser.ts.
 */
import javaModule from 'tree-sitter-java';
import type { SymbolNode, SymbolKind, CallSite } from '../../types.js';
import { childrenOfType, firstChildOfType, firstChildOfTypes } from './node-helpers.js';
import { makeParser } from './parser-factory.js';

const javaGrammar = javaModule as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

const getParser = makeParser(javaGrammar, { pkg: 'tree-sitter-java', wasm: 'tree-sitter-java.wasm' });

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

/** Recursively walk a node and collect method_invocation callee names + first-seen line. */
function collectCalls(node: TSNode, results: Map<string, number>): void {
  if (node.type === 'method_invocation') {
    // method_invocation grammar: field('object', ...)? field('name', identifier) field('arguments', ...)
    // Use the field accessor — `find(c.type === 'identifier')` returns the receiver
    // identifier when the object is a bare variable (`dispatcher.notifyMessagePost(x)`),
    // not the method name. That made every member-call invisible to gs callers.
    const nameNode = node.childForFieldName('name');
    if (nameNode && !results.has(nameNode.text)) {
      results.set(nameNode.text, node.startPosition.row + 1);
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
// Same-package short-name qualification
// ---------------------------------------------------------------------------
// Java permits referencing types in the same package without an explicit import.
// The extractor walks the AST for bare type-identifier references and qualifies
// them as `<packageName>.<bareName>` before pushing into imports[]. The resolver
// then looks them up against the FQCN index — same path as explicit imports.
// See coldstart/docs/jvm-same-package-spec.md.

const JAVA_LANG_SHORTLIST = new Set([
  // java.lang types
  'String', 'Object', 'Integer', 'Long', 'Boolean', 'Double', 'Float',
  'Character', 'Byte', 'Short', 'Void', 'Number', 'Math', 'System',
  'Thread', 'Runnable', 'Exception', 'RuntimeException', 'Throwable',
  'Error', 'Class', 'Enum', 'Iterable', 'Comparable', 'CharSequence',
  'StringBuilder', 'StringBuffer', 'AutoCloseable',
  // common java.lang annotations
  'Override', 'Deprecated', 'SuppressWarnings', 'SafeVarargs',
  'FunctionalInterface',
  // java.util — extremely common in JDK/Spring code; never project-local
  'List', 'Map', 'Set', 'Collection', 'Iterator', 'Optional', 'Arrays',
  'Collections', 'Objects', 'ArrayList', 'LinkedList', 'HashMap',
  'LinkedHashMap', 'TreeMap', 'HashSet', 'LinkedHashSet', 'TreeSet',
  'Queue', 'Deque', 'ArrayDeque', 'Stack', 'Vector', 'Properties',
  'Date', 'Calendar', 'TimeZone', 'UUID', 'Random', 'Locale',
  'Comparator', 'Scanner', 'EnumSet', 'EnumMap', 'BitSet',
  // java.util.function
  'Function', 'BiFunction', 'Predicate', 'BiPredicate', 'Consumer',
  'BiConsumer', 'Supplier', 'UnaryOperator', 'BinaryOperator',
  // java.util.stream
  'Stream', 'IntStream', 'LongStream', 'DoubleStream', 'Collectors',
  // java.io commons
  'File', 'IOException', 'InputStream', 'OutputStream', 'Reader',
  'Writer', 'BufferedReader', 'BufferedWriter', 'PrintWriter',
  'FileNotFoundException', 'Serializable',
  // java.time
  'Instant', 'LocalDate', 'LocalDateTime', 'LocalTime', 'Duration',
  'Period', 'ZoneId', 'ZoneOffset', 'ZonedDateTime', 'OffsetDateTime',
  'OffsetTime', 'Clock', 'DayOfWeek', 'Month', 'Year', 'YearMonth',
  // java.util.concurrent
  'CompletableFuture', 'CompletionStage', 'Future', 'ExecutorService',
  'Executor', 'Executors', 'TimeUnit', 'ConcurrentHashMap',
  'ConcurrentMap', 'AtomicInteger', 'AtomicLong', 'AtomicBoolean',
  'AtomicReference',
]);

/** Pull a bare type name from a type-node and add to the same-package set,
 *  if it's a single-segment identifier. Generic args inside are skipped (v1).
 */
function addBareTypeName(bareRefs: Set<string>, typeNode: TSNode | null | undefined): void {
  if (!typeNode) return;
  const stripped = stripGenerics(typeNode.text);
  if (stripped && !stripped.includes('.')) bareRefs.add(stripped);
}

/** Add all annotation names found on a modifiers-bearing node. */
function addAnnotationsToBareRefs(bareRefs: Set<string>, node: TSNode): void {
  for (const child of node.namedChildren) {
    if (child.type !== 'modifiers') continue;
    for (const mod of (child.children ?? child.namedChildren)) {
      if (mod.type === 'marker_annotation' || mod.type === 'annotation') {
        const nameNode = mod.childForFieldName('name');
        if (nameNode && !nameNode.text.includes('.')) {
          bareRefs.add(nameNode.text);
        }
      }
    }
  }
}

function getAnnotations(node: TSNode): string[] {
  const annotations: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'modifiers') {
      for (const mod of (child.children ?? child.namedChildren)) {
        if (mod.type === 'marker_annotation' || mod.type === 'annotation') {
          const nameNode = mod.childForFieldName('name');
          if (nameNode) {
            const text = nameNode.text;
            // Extract last segment for scoped identifiers (e.g. org.junit.Test → Test)
            const lastSegment = text.split('.').pop();
            if (lastSegment) annotations.push(lastSegment);
          }
        }
      }
    }
  }
  return annotations;
}

// ---------------------------------------------------------------------------
// Extract symbols from class/interface/enum body
// ---------------------------------------------------------------------------

function extractClassMembers(
  body: TSNode,
  fileId: string,
  parentName: string,
  bareRefs?: Set<string>,
): SymbolNode[] {
  const members: SymbolNode[] = [];

  for (const child of body.namedChildren) {
    const startLine = child.startPosition.row + 1;
    const endLine = child.endPosition.row + 1;

    if (child.type === 'method_declaration') {
      const nameNode = firstChildOfType(child, 'identifier');
      if (!nameNode) continue;
      const methodName = nameNode.text;
      const calls = new Map<string, number>();
      const methodBody = firstChildOfType(child, 'block');
      if (methodBody) collectCalls(methodBody, calls);
      const annotations = getAnnotations(child);

      // Same-package: return type, parameter types, annotations.
      if (bareRefs) {
        addBareTypeName(bareRefs, child.childForFieldName('type'));
        const params = firstChildOfType(child, 'formal_parameters');
        if (params) {
          for (const p of params.namedChildren) {
            if (p.type === 'formal_parameter') {
              addBareTypeName(bareRefs, p.childForFieldName('type'));
              addAnnotationsToBareRefs(bareRefs, p);
            }
          }
        }
        addAnnotationsToBareRefs(bareRefs, child);
      }
      const symbol: SymbolNode = {
        id: `${fileId}#${parentName}.${methodName}`,
        name: `${parentName}.${methodName}`,
        kind: 'method',
        startLine,
        endLine,
        isExported: isPublic(child),
        calls: callsFromMap(calls, methodName),
        implementsNames: [],
      };
      if (annotations.length > 0) symbol.annotations = annotations;
      members.push(symbol);
    } else if (child.type === 'constructor_declaration') {
      const nameNode = firstChildOfType(child, 'identifier');
      if (!nameNode) continue;
      const ctorName = nameNode.text;
      const calls = new Map<string, number>();
      const ctorBody = firstChildOfType(child, 'constructor_body');
      if (ctorBody) collectCalls(ctorBody, calls);
      const annotations = getAnnotations(child);

      // Same-package: parameter types + annotations (constructors have no return type).
      if (bareRefs) {
        const params = firstChildOfType(child, 'formal_parameters');
        if (params) {
          for (const p of params.namedChildren) {
            if (p.type === 'formal_parameter') {
              addBareTypeName(bareRefs, p.childForFieldName('type'));
              addAnnotationsToBareRefs(bareRefs, p);
            }
          }
        }
        addAnnotationsToBareRefs(bareRefs, child);
      }
      const symbol: SymbolNode = {
        id: `${fileId}#${parentName}.${ctorName}`,
        name: `${parentName}.${ctorName}`,
        kind: 'method',
        startLine,
        endLine,
        isExported: isPublic(child),
        calls: callsFromMap(calls),
        implementsNames: [],
      };
      if (annotations.length > 0) symbol.annotations = annotations;
      members.push(symbol);
    } else if (child.type === 'field_declaration') {
      // Same-package: field type + annotations (applies to all fields, not just constants).
      if (bareRefs) {
        addBareTypeName(bareRefs, child.childForFieldName('type'));
        addAnnotationsToBareRefs(bareRefs, child);
      }
      // Symbol extraction is restricted to static final fields (constants).
      if (!isStaticFinal(child)) continue;
      const declarators = childrenOfType(child, 'variable_declarator');
      const annotations = getAnnotations(child);
      for (const decl of declarators) {
        const nameNode = firstChildOfType(decl, 'identifier');
        if (!nameNode) continue;
        const symbol: SymbolNode = {
          id: `${fileId}#${parentName}.${nameNode.text}`,
          name: `${parentName}.${nameNode.text}`,
          kind: 'constant',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        };
        if (annotations.length > 0) symbol.annotations = annotations;
        members.push(symbol);
      }
    } else if (
      child.type === 'class_declaration' ||
      child.type === 'interface_declaration' ||
      child.type === 'enum_declaration' ||
      child.type === 'record_declaration'
    ) {
      // Inner class — extract with parent prefix
      const inner = extractTypeDeclaration(child, fileId, `${parentName}.`, bareRefs);
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
  bareRefs?: Set<string>,
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
      if (bareRefs && extendsName && !extendsName.includes('.')) bareRefs.add(extendsName);

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
            const stripped = stripGenerics(t.text);
            implementsNames.push(stripped);
            if (bareRefs && !stripped.includes('.')) bareRefs.add(stripped);
          }
        }
      }

      const annotations = getAnnotations(node);
      if (bareRefs) addAnnotationsToBareRefs(bareRefs, node);
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
      if (annotations.length > 0) classSymbol.annotations = annotations;

      const symbols: SymbolNode[] = [classSymbol];

      // Extract members from body
      const body = firstChildOfTypes(node, ['class_body', 'record_body']);
      if (body) {
        symbols.push(...extractClassMembers(body, fileId, name, bareRefs));
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
            const stripped = stripGenerics(t.text);
            implementsNames.push(stripped);
            if (bareRefs && !stripped.includes('.')) bareRefs.add(stripped);
          }
        }
      }

      const annotations = getAnnotations(node);
      if (bareRefs) addAnnotationsToBareRefs(bareRefs, node);
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
      if (annotations.length > 0) ifaceSymbol.annotations = annotations;

      const symbols: SymbolNode[] = [ifaceSymbol];

      // Extract method signatures from interface body
      const body = firstChildOfType(node, 'interface_body');
      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'method_declaration' || child.type === 'interface_method_declaration') {
            const mName = firstChildOfType(child, 'identifier');
            if (!mName) continue;
            // Same-package: interface method return type + param types + annotations.
            if (bareRefs) {
              addBareTypeName(bareRefs, child.childForFieldName('type'));
              const params = firstChildOfType(child, 'formal_parameters');
              if (params) {
                for (const p of params.namedChildren) {
                  if (p.type === 'formal_parameter') {
                    addBareTypeName(bareRefs, p.childForFieldName('type'));
                    addAnnotationsToBareRefs(bareRefs, p);
                  }
                }
              }
              addAnnotationsToBareRefs(bareRefs, child);
            }
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
            const stripped = stripGenerics(t.text);
            implementsNames.push(stripped);
            if (bareRefs && !stripped.includes('.')) bareRefs.add(stripped);
          }
        }
      }

      const annotations = getAnnotations(node);
      if (bareRefs) addAnnotationsToBareRefs(bareRefs, node);
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
      if (annotations.length > 0) enumSymbol.annotations = annotations;

      const symbols: SymbolNode[] = [enumSymbol];

      const body = firstChildOfType(node, 'enum_body');
      if (body) {
        symbols.push(...extractClassMembers(body, fileId, name, bareRefs));
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
  return extractJavaFromRoot(root, fileId);
}

/**
 * Symbol/import extraction from an already-parsed root node. Split out from
 * parseJavaContent so the traversal can run against any tree-sitter-compatible
 * tree — native node-tree-sitter OR web-tree-sitter. Used by the wasm spike to
 * verify the extractor yields byte-identical output on both engines.
 */
export function extractJavaFromRoot(root: TSNode, fileId: string): JavaParseResult {
  const imports: string[] = [];
  const exports: string[] = [];
  const rawSymbols: SymbolNode[] = [];
  let packageName = '';
  // Bare-type-reference collector for same-package qualification. Populated
  // inline by extractTypeDeclaration / extractClassMembers as they walk.
  const bareRefs = new Set<string>();

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

      const result = extractTypeDeclaration(node, fileId, '', bareRefs);
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

  // Same-package short-name qualification — Java permits referring to types in
  // the same package without an explicit import. bareRefs is populated inline
  // by the symbol-extraction walk above. Exclude names shadowed by an explicit
  // import or in the JDK shortlist, then push qualified FQCNs into imports[].
  if (packageName) {
    const importedBasenames = new Set<string>();
    for (const fqcn of imports) {
      const last = fqcn.split('.').pop();
      if (last) importedBasenames.add(last);
    }
    for (const name of bareRefs) {
      if (!name) continue;
      const first = name.charCodeAt(0);
      if (first < 65 || first > 90) continue; // not A-Z
      if (JAVA_LANG_SHORTLIST.has(name)) continue;
      if (importedBasenames.has(name)) continue;
      imports.push(`${packageName}.${name}`);
    }
  }

  // Resolve intra-file calls
  const symbolIdByName = new Map<string, string>(rawSymbols.map(s => [s.name, s.id]));
  const resolvedSymbols = rawSymbols.map(sym => ({
    ...sym,
    calls: sym.calls.map(c => ({ name: symbolIdByName.get(c.name) ?? c.name, line: c.line })),
  }));

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols: resolvedSymbols,
    packageName,
  };
}
