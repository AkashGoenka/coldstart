/**
 * C# convention-resolver POC
 *
 * Usage: npx tsx docs/resolver-specs/csharp/poc.ts <repo-path>
 *
 * Walks .cs files under the given repo, parses with tree-sitter-c-sharp,
 * and prints proposed synthetic edges for:
 *   - DI registrations (AddScoped<I, Impl>(), AddSingleton, AddTransient, ...)
 *   - Attribute routing ([Route], [HttpGet/Post/Put/Delete])
 *   - EF nav properties (gated to Domain/Entities/AggregatesModel folders)
 *   - Partial-class pairs across files
 *
 * No edits to coldstart-mcp source. Pure read-only research script.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Parser = require('tree-sitter') as { new (): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const csharpGrammar = require('tree-sitter-c-sharp');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

const parser = new Parser();
parser.setLanguage(csharpGrammar);

const SKIP_DIRS = new Set(['bin', 'obj', '.git', 'node_modules', 'packages', '.vs']);

const PRIMITIVE_TYPES = new Set([
  'string', 'int', 'bool', 'Guid', 'DateTime', 'DateTimeOffset', 'decimal',
  'double', 'float', 'byte', 'sbyte', 'short', 'ushort', 'long', 'ulong',
  'char', 'object', 'void', 'TimeSpan', 'Uri',
]);

const COLLECTION_WRAPPERS = new Set([
  'ICollection', 'IReadOnlyCollection', 'IList', 'IReadOnlyList', 'List',
  'HashSet', 'IEnumerable', 'IQueryable', 'IDictionary', 'IReadOnlyDictionary',
  'Dictionary', 'Nullable', 'Lazy', 'Task',
]);

const DI_METHODS = new Set([
  'AddScoped', 'AddSingleton', 'AddTransient',
  'TryAddScoped', 'TryAddSingleton', 'TryAddTransient', 'TryAddEnumerable',
]);

const ENTITY_PATH_HINTS = [
  '/Domain/', '/Entities/', '/Models/', '/AggregatesModel/',
];

const ROUTING_ATTRS = new Set([
  'Route', 'HttpGet', 'HttpPost', 'HttpPut', 'HttpPatch', 'HttpDelete',
  'Area', 'ApiController',
]);

// ---------------------------------------------------------------------------
// File walk
// ---------------------------------------------------------------------------

function walkCSFiles(root: string): string[] {
  const out: string[] = [];
  function visit(dir: string): void {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) visit(p);
      else if (st.isFile() && p.endsWith('.cs')) out.push(p);
    }
  }
  visit(root);
  return out;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

function findAllOfType(node: TSNode, type: string, out: TSNode[]): void {
  if (node.type === type) out.push(node);
  for (const c of node.namedChildren) findAllOfType(c, type, out);
}

function findAllOfTypes(node: TSNode, types: Set<string>, out: TSNode[]): void {
  if (types.has(node.type)) out.push(node);
  for (const c of node.namedChildren) findAllOfTypes(c, types, out);
}

function hasModifier(node: TSNode, name: string): boolean {
  return node.namedChildren.some(
    (c: TSNode) => c.type === 'modifier' && c.text === name,
  );
}

/** Extract the short name from a type node (identifier | generic_name | qualified_name). */
function shortTypeName(node: TSNode): string {
  if (!node) return '';
  if (node.type === 'identifier') return node.text;
  if (node.type === 'generic_name') {
    const id = firstChildOfType(node, 'identifier');
    return id ? id.text : node.text;
  }
  if (node.type === 'qualified_name') {
    // namespace.qualified.Name → return last segment
    return node.text.split('.').pop() ?? node.text;
  }
  if (node.type === 'predefined_type') return node.text;
  return node.text;
}

/** Walk into a generic_name and return its inner type args (short names). */
function genericArgs(node: TSNode): string[] {
  const out: string[] = [];
  if (!node || node.type !== 'generic_name') return out;
  const args = firstChildOfType(node, 'type_argument_list');
  if (!args) return out;
  for (const a of args.namedChildren) out.push(shortTypeName(a));
  return out;
}

/** Find enclosing namespace_declaration / file_scoped_namespace_declaration. */
function fileNamespace(root: TSNode): string {
  const candidates: TSNode[] = [];
  findAllOfTypes(root, new Set(['namespace_declaration', 'file_scoped_namespace_declaration']), candidates);
  if (!candidates.length) return '';
  const n = candidates[0];
  const name = firstChildOfType(n, 'qualified_name')
    ?? firstChildOfType(n, 'identifier');
  return name ? name.text : '';
}

// ---------------------------------------------------------------------------
// Per-file parse → facts
// ---------------------------------------------------------------------------

interface ClassDecl {
  file: string;
  namespace: string;
  name: string;
  isPartial: boolean;
  startLine: number;
  isController: boolean;
  routeAttrPath?: string;
}

interface DiReg {
  file: string;
  method: string;       // AddScoped | AddSingleton | ...
  ifaceName: string;
  implName: string | null;
  line: number;
}

interface NavProp {
  file: string;
  ownerClass: string;
  propName: string;
  targetType: string;   // short name of related entity
  line: number;
}

interface RouteHit {
  file: string;
  controllerName: string;
  methodName: string;
  verb: string;
  path: string | null;
  line: number;
}

function parseFile(path: string): {
  classes: ClassDecl[];
  diRegs: DiReg[];
  navs: NavProp[];
  routes: RouteHit[];
} {
  const src = readFileSync(path, 'utf-8');
  const tree = parser.parse(src);
  const root = tree.rootNode;
  const ns = fileNamespace(root);

  const classes: ClassDecl[] = [];
  const diRegs: DiReg[] = [];
  const navs: NavProp[] = [];
  const routes: RouteHit[] = [];

  // --- class_declaration walk
  const classNodes: TSNode[] = [];
  findAllOfTypes(root, new Set(['class_declaration', 'record_declaration', 'struct_declaration', 'interface_declaration']), classNodes);

  for (const cls of classNodes) {
    const id = firstChildOfType(cls, 'identifier');
    if (!id) continue;
    const name = id.text;
    const isPartial = hasModifier(cls, 'partial');
    // Is this an MVC controller? Heuristic: name ends in "Controller" or attribute [ApiController].
    const isController = name.endsWith('Controller') || hasAttrNamed(cls, 'ApiController');
    const routeAttrPath = findAttrStringArg(cls, 'Route');
    classes.push({
      file: path,
      namespace: ns,
      name,
      isPartial,
      startLine: cls.startPosition.row + 1,
      isController,
      routeAttrPath,
    });

    // --- nav properties: only inside entity-folder-gated classes.
    if (ENTITY_PATH_HINTS.some(h => path.includes(h))) {
      const body = firstChildOfType(cls, 'declaration_list');
      if (body) {
        for (const m of body.namedChildren) {
          if (m.type !== 'property_declaration') continue;
          // Type is one of the first children before the property name (identifier).
          // Grammar shape: [modifier]* type identifier accessor_list
          const typeNode = m.namedChildren.find(
            (c: TSNode) => c.type === 'identifier' || c.type === 'generic_name'
              || c.type === 'qualified_name' || c.type === 'predefined_type'
              || c.type === 'nullable_type',
          );
          const idents = m.namedChildren.filter((c: TSNode) => c.type === 'identifier');
          // last identifier before accessor_list is the property name; if type is identifier the name is the 2nd
          const accIdx = m.namedChildren.findIndex((c: TSNode) => c.type === 'accessor_list' || c.type === 'arrow_expression_clause');
          const before = accIdx >= 0 ? m.namedChildren.slice(0, accIdx) : m.namedChildren;
          const beforeIdents = before.filter((c: TSNode) => c.type === 'identifier');
          const propName = beforeIdents[beforeIdents.length - 1]?.text ?? '';
          if (!typeNode || !propName) continue;

          let target: string | null = null;
          if (typeNode.type === 'generic_name') {
            const head = firstChildOfType(typeNode, 'identifier')?.text ?? '';
            if (COLLECTION_WRAPPERS.has(head)) {
              const args = genericArgs(typeNode);
              if (args.length === 1 && !PRIMITIVE_TYPES.has(args[0]) && !COLLECTION_WRAPPERS.has(args[0])) {
                target = args[0];
              }
            }
          } else if (typeNode.type === 'identifier') {
            const t = typeNode.text;
            if (!PRIMITIVE_TYPES.has(t) && !COLLECTION_WRAPPERS.has(t)) target = t;
          }
          // Skip if target equals owner (self-reference) or is same identifier as propname
          if (!target || target === name) continue;
          navs.push({ file: path, ownerClass: name, propName, targetType: target, line: m.startPosition.row + 1 });
          void idents;
        }
      }
    }

    // --- routing attrs on methods
    if (isController) {
      const body = firstChildOfType(cls, 'declaration_list');
      if (body) {
        for (const m of body.namedChildren) {
          if (m.type !== 'method_declaration') continue;
          for (const v of ['HttpGet', 'HttpPost', 'HttpPut', 'HttpPatch', 'HttpDelete']) {
            if (hasAttrNamed(m, v)) {
              const methodNameNode = m.namedChildren.filter((c: TSNode) => c.type === 'identifier').pop();
              routes.push({
                file: path,
                controllerName: name,
                methodName: methodNameNode?.text ?? '?',
                verb: v.replace('Http', '').toUpperCase(),
                path: findAttrStringArg(m, v) ?? null,
                line: m.startPosition.row + 1,
              });
              break;
            }
          }
        }
      }
    }
  }

  // --- DI registrations: walk invocation_expression globally
  const calls: TSNode[] = [];
  findAllOfType(root, 'invocation_expression', calls);
  for (const call of calls) {
    // method: either an identifier (rare for DI) or a member_access_expression whose .name is the method name.
    const methodNode = call.childForFieldName('function') ?? call.namedChildren[0];
    if (!methodNode) continue;

    let methodName = '';
    let typeArgs: string[] = [];
    if (methodNode.type === 'member_access_expression') {
      const nameField = methodNode.childForFieldName('name') ?? methodNode.namedChildren[methodNode.namedChildren.length - 1];
      if (nameField?.type === 'generic_name') {
        methodName = firstChildOfType(nameField, 'identifier')?.text ?? '';
        typeArgs = genericArgs(nameField);
      } else if (nameField?.type === 'identifier') {
        methodName = nameField.text;
      }
    } else if (methodNode.type === 'generic_name') {
      methodName = firstChildOfType(methodNode, 'identifier')?.text ?? '';
      typeArgs = genericArgs(methodNode);
    } else if (methodNode.type === 'identifier') {
      methodName = methodNode.text;
    }

    if (!DI_METHODS.has(methodName)) continue;
    if (typeArgs.length === 2) {
      diRegs.push({
        file: path,
        method: methodName,
        ifaceName: typeArgs[0],
        implName: typeArgs[1],
        line: call.startPosition.row + 1,
      });
    } else if (typeArgs.length === 1) {
      // AddScoped<IFoo>(sp => new Foo(...)) — try to find a `new T(...)` inside the argument list
      const args = call.childForFieldName('arguments') ?? firstChildOfType(call, 'argument_list');
      let impl: string | null = null;
      if (args) {
        const news: TSNode[] = [];
        findAllOfType(args, 'object_creation_expression', news);
        if (news.length) {
          const t = news[0].namedChildren.find((c: TSNode) => c.type === 'identifier' || c.type === 'generic_name' || c.type === 'qualified_name');
          if (t) impl = shortTypeName(t);
        }
      }
      diRegs.push({
        file: path,
        method: methodName,
        ifaceName: typeArgs[0],
        implName: impl,
        line: call.startPosition.row + 1,
      });
    } else {
      // non-generic: AddScoped(typeof(IFoo), typeof(Foo))
      const args = call.childForFieldName('arguments') ?? firstChildOfType(call, 'argument_list');
      if (!args) continue;
      const typeofs: TSNode[] = [];
      findAllOfType(args, 'typeof_expression', typeofs);
      if (typeofs.length >= 2) {
        const t0 = typeofs[0].namedChildren.find((c: TSNode) => c.type === 'identifier' || c.type === 'generic_name' || c.type === 'qualified_name');
        const t1 = typeofs[1].namedChildren.find((c: TSNode) => c.type === 'identifier' || c.type === 'generic_name' || c.type === 'qualified_name');
        if (t0 && t1) {
          diRegs.push({
            file: path,
            method: methodName,
            ifaceName: shortTypeName(t0),
            implName: shortTypeName(t1),
            line: call.startPosition.row + 1,
          });
        }
      }
    }
  }

  return { classes, diRegs, navs, routes };
}

function hasAttrNamed(memberNode: TSNode, attrName: string): boolean {
  const attrLists: TSNode[] = [];
  // Attribute lists may be direct children of the declaration, OR siblings preceding it
  // in tree-sitter-c-sharp depending on grammar version. Walk the member node itself first.
  for (const c of memberNode.namedChildren) {
    if (c.type === 'attribute_list') attrLists.push(c);
  }
  for (const al of attrLists) {
    for (const a of al.namedChildren) {
      if (a.type !== 'attribute') continue;
      const nm = firstChildOfType(a, 'identifier')?.text
        ?? firstChildOfType(a, 'qualified_name')?.text;
      if (nm === attrName) return true;
    }
  }
  return false;
}

function findAttrStringArg(memberNode: TSNode, attrName: string): string | undefined {
  for (const c of memberNode.namedChildren) {
    if (c.type !== 'attribute_list') continue;
    for (const a of c.namedChildren) {
      if (a.type !== 'attribute') continue;
      const nm = firstChildOfType(a, 'identifier')?.text
        ?? firstChildOfType(a, 'qualified_name')?.text;
      if (nm !== attrName) continue;
      const args = firstChildOfType(a, 'attribute_argument_list');
      if (!args) continue;
      for (const arg of args.namedChildren) {
        const strNode = firstChildOfType(arg, 'string_literal')
          ?? firstChildOfType(arg, 'verbatim_string_literal');
        if (strNode) {
          return strNode.text.replace(/^@?"|"$/g, '');
        }
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const repoArg = process.argv[2];
  if (!repoArg) {
    console.error('Usage: tsx poc.ts <repo-path>');
    process.exit(1);
  }
  const repo = repoArg.endsWith(sep) ? repoArg.slice(0, -1) : repoArg;
  const files = walkCSFiles(repo);

  const allClasses: ClassDecl[] = [];
  const allDi: DiReg[] = [];
  const allNav: NavProp[] = [];
  const allRoutes: RouteHit[] = [];
  let parseErrors = 0;

  for (const f of files) {
    try {
      const r = parseFile(f);
      allClasses.push(...r.classes);
      allDi.push(...r.diRegs);
      allNav.push(...r.navs);
      allRoutes.push(...r.routes);
    } catch (e) {
      parseErrors++;
      if (parseErrors < 3) console.error(`  parse error: ${f}: ${(e as Error).message}`);
    }
  }

  // Build short-name → fileId index
  const shortNameIndex = new Map<string, ClassDecl[]>();
  for (const c of allClasses) {
    if (!shortNameIndex.has(c.name)) shortNameIndex.set(c.name, []);
    shortNameIndex.get(c.name)!.push(c);
  }

  const rel = (p: string) => relative(repo, p);

  console.log(`\n=== POC RUN ===`);
  console.log(`Repo: ${repo}`);
  console.log(`Files scanned: ${files.length}`);
  console.log(`Classes/records/structs/interfaces: ${allClasses.length}`);
  console.log(`Parse errors: ${parseErrors}`);

  // --- 1. Partial class pairs
  const partialGroups = new Map<string, ClassDecl[]>();
  for (const c of allClasses) {
    if (!c.isPartial) continue;
    const key = `${c.namespace}::${c.name}`;
    if (!partialGroups.has(key)) partialGroups.set(key, []);
    partialGroups.get(key)!.push(c);
  }
  const partialEdges: { a: string; b: string; key: string }[] = [];
  for (const [key, group] of partialGroups) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        partialEdges.push({ a: rel(group[i].file), b: rel(group[j].file), key });
      }
    }
  }

  console.log(`\n--- Partial class edges (${partialEdges.length}) ---`);
  for (const e of partialEdges.slice(0, 30)) {
    console.log(`  [${e.key}]`);
    console.log(`    ${e.a}  <->  ${e.b}`);
  }
  if (partialEdges.length > 30) console.log(`  ... and ${partialEdges.length - 30} more`);

  // --- 2. DI registrations → resolved edges
  console.log(`\n--- DI registrations (${allDi.length}) ---`);
  let diResolved = 0;
  let diIfaceUnknown = 0;
  let diImplUnknown = 0;
  const diEdges: { from: string; iface: string; impl: string; ifaceFile: string; implFile: string; method: string }[] = [];
  for (const d of allDi) {
    const ifaceMatches = shortNameIndex.get(d.ifaceName) ?? [];
    const implMatches = d.implName ? (shortNameIndex.get(d.implName) ?? []) : [];
    if (!ifaceMatches.length) diIfaceUnknown++;
    if (d.implName && !implMatches.length) diImplUnknown++;
    if (ifaceMatches.length && implMatches.length) {
      diResolved++;
      for (const i of ifaceMatches) for (const j of implMatches) {
        diEdges.push({
          from: rel(d.file),
          iface: d.ifaceName, impl: d.implName!,
          ifaceFile: rel(i.file), implFile: rel(j.file),
          method: d.method,
        });
      }
    }
  }
  console.log(`  resolved (iface+impl found): ${diResolved} / ${allDi.length}`);
  console.log(`  iface short-name unknown: ${diIfaceUnknown}`);
  console.log(`  impl short-name unknown (factory or external): ${diImplUnknown}`);
  for (const e of diEdges.slice(0, 25)) {
    console.log(`  ${e.method}<${e.iface}, ${e.impl}>`);
    console.log(`    at:    ${e.from}`);
    console.log(`    edge:  ${e.ifaceFile}  ->  ${e.implFile}`);
  }
  if (diEdges.length > 25) console.log(`  ... and ${diEdges.length - 25} more`);

  // --- 3. EF nav properties
  console.log(`\n--- EF nav properties (${allNav.length}) ---`);
  let navResolved = 0;
  const navEdges: { from: string; to: string; owner: string; prop: string; target: string }[] = [];
  for (const n of allNav) {
    const matches = shortNameIndex.get(n.targetType) ?? [];
    if (!matches.length) continue;
    navResolved++;
    for (const m of matches) {
      if (m.file === n.file) continue;
      navEdges.push({ from: rel(n.file), to: rel(m.file), owner: n.ownerClass, prop: n.propName, target: n.targetType });
    }
  }
  console.log(`  resolved: ${navResolved} / ${allNav.length}`);
  for (const e of navEdges.slice(0, 20)) {
    console.log(`  ${e.owner}.${e.prop}: ${e.target}`);
    console.log(`    ${e.from}  ->  ${e.to}`);
  }
  if (navEdges.length > 20) console.log(`  ... and ${navEdges.length - 20} more`);

  // --- 4. Attribute routing (metadata; no edge)
  console.log(`\n--- Attribute routes (${allRoutes.length}) ---`);
  for (const r of allRoutes.slice(0, 25)) {
    console.log(`  [Http${r.verb}${r.path ? `("${r.path}")` : ''}] ${r.controllerName}.${r.methodName}`);
    console.log(`    ${rel(r.file)}:${r.line}`);
  }
  if (allRoutes.length > 25) console.log(`  ... and ${allRoutes.length - 25} more`);

  console.log(`\n=== SUMMARY ===`);
  console.log(`  partial edges:   ${partialEdges.length}`);
  console.log(`  DI edges:        ${diEdges.length}`);
  console.log(`  EF nav edges:    ${navEdges.length}`);
  console.log(`  routes recorded: ${allRoutes.length}`);
}

main();
