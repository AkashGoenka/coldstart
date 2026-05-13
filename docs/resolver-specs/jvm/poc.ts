#!/usr/bin/env node
/**
 * POC: Spring DI / JPA / @ConfigurationProperties synthetic edges for coldstart.
 *
 * Standalone. Run with:
 *   npx tsx docs/resolver-specs/jvm/poc.ts <repo-path>
 *
 * Walks all .java files under <repo-path>, parses with tree-sitter-java, builds:
 *   - FQCN index            (package + class name → file)
 *   - entity-name index     (@Entity(name=…) or class name → fqcn)
 *   - bean-stereotype index (classes carrying @Service/@Repository/@Controller/…)
 *   - interface-impl index  (interface short name → set of implementing fqcns)
 *
 * Then walks every class a second time and prints proposed synthetic edges:
 *   - DI:     constructor params / @Autowired fields → bean files (incl. interfaces)
 *   - JPA:    @OneToMany/@ManyToOne/@OneToOne/@ManyToMany → target entity file
 *   - CONFIG: @ConfigurationProperties(prefix=…) → application*.{yml,properties}
 *
 * No coldstart imports — this is intentionally self-contained so it can run before
 * any production code is touched.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Parser = require('tree-sitter') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Java = require('tree-sitter-java') as any;

type TSNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const STEREOTYPES = new Set([
  'Component', 'Service', 'Repository', 'Controller', 'RestController', 'Configuration',
]);
const INJECT_ANNOS = new Set(['Autowired', 'Inject', 'Resource']);
const JPA_RELATION_ANNOS = new Set(['OneToMany', 'ManyToOne', 'OneToOne', 'ManyToMany']);
const PRIMITIVE_OR_BUILTIN = new Set([
  'String', 'Integer', 'Long', 'Short', 'Byte', 'Boolean', 'Character', 'Float', 'Double',
  'Object', 'Void', 'Number', 'BigDecimal', 'BigInteger',
  'List', 'Map', 'Set', 'Collection', 'Optional', 'Iterable',
  'LocalDate', 'LocalDateTime', 'LocalTime', 'Instant', 'Duration',
  'UUID', 'URL', 'URI', 'Path', 'File', 'Date', 'Calendar',
  'int', 'long', 'short', 'byte', 'boolean', 'char', 'float', 'double', 'void',
]);
const STOPLIST_PACKAGE_PREFIXES = [
  'java.', 'javax.', 'jakarta.', 'kotlin.', 'kotlinx.', 'scala.',
  'org.springframework.', 'com.sun.', 'sun.',
];

function isStoplisted(fqcnOrShort: string): boolean {
  if (PRIMITIVE_OR_BUILTIN.has(fqcnOrShort)) return true;
  for (const p of STOPLIST_PACKAGE_PREFIXES) if (fqcnOrShort.startsWith(p)) return true;
  return false;
}

// --- file walking ---

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const ents = await fs.readdir(dir, { withFileTypes: true });
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'target'
        || e.name === 'build' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// --- AST helpers ---

function getParser() {
  const p = new Parser();
  p.setLanguage(Java);
  return p;
}

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}
function childrenOfType(node: TSNode, type: string): TSNode[] {
  return node.namedChildren.filter((c: TSNode) => c.type === type);
}
function stripGenerics(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}
function shortName(t: string): string {
  const noG = stripGenerics(t);
  const dot = noG.lastIndexOf('.');
  return dot === -1 ? noG : noG.slice(dot + 1);
}

/** Extract generic type argument(s): List<Pet> -> ["Pet"], Map<K,V> -> ["K","V"] */
function genericArgs(typeNode: TSNode): string[] {
  if (typeNode.type !== 'generic_type') return [];
  const args = firstChildOfType(typeNode, 'type_arguments');
  if (!args) return [];
  const out: string[] = [];
  for (const c of args.namedChildren) {
    if (c.type === 'type_identifier' || c.type === 'scoped_type_identifier' || c.type === 'generic_type') {
      out.push(c.text);
    }
  }
  return out;
}

interface AnnoInfo {
  name: string;             // simple name, e.g. "OneToMany"
  args: Map<string, string>; // named args: mappedBy -> "owner"
  positional: string[];     // positional args (string literal text without quotes)
}

function parseAnnotation(annoNode: TSNode): AnnoInfo {
  // marker_annotation: just a name
  // annotation: name + annotation_argument_list
  const nameNode = annoNode.childForFieldName('name');
  const name = nameNode ? nameNode.text.split('.').pop()! : '';
  const args = new Map<string, string>();
  const positional: string[] = [];

  const argList = annoNode.namedChildren.find((c: TSNode) => c.type === 'annotation_argument_list');
  if (argList) {
    for (const child of argList.namedChildren) {
      if (child.type === 'element_value_pair') {
        const k = child.childForFieldName('key')?.text ?? child.namedChildren[0]?.text;
        const v = child.childForFieldName('value')?.text ?? child.namedChildren[1]?.text;
        if (k && v) args.set(k, stripQuotes(v));
      } else if (child.type === 'string_literal') {
        positional.push(stripQuotes(child.text));
      } else if (child.type === 'identifier' || child.type === 'field_access') {
        positional.push(child.text);
      }
    }
  }
  return { name, args, positional };
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'")) return s.slice(1, -1);
  return s;
}

/** Find all annotation nodes attached to a declaration (in its modifiers child) */
function annotationsOf(decl: TSNode): AnnoInfo[] {
  const out: AnnoInfo[] = [];
  for (const child of decl.namedChildren) {
    if (child.type === 'modifiers') {
      for (const m of (child.children ?? child.namedChildren)) {
        if (m.type === 'marker_annotation' || m.type === 'annotation') {
          out.push(parseAnnotation(m));
        }
      }
    }
  }
  return out;
}

function findAnnotation(infos: AnnoInfo[], name: string): AnnoInfo | undefined {
  return infos.find(a => a.name === name);
}

// --- per-file extraction ---

interface ClassInfo {
  fqcn: string;
  file: string;
  line: number;
  pkg: string;
  name: string;            // simple
  annotations: AnnoInfo[]; // class-level
  implementsList: string[]; // short names of implemented interfaces
  extendsName?: string;
  fields: FieldInfo[];
  ctorParams: CtorParamInfo[];
}
interface FieldInfo {
  name: string;
  typeText: string;        // raw, may have generics
  line: number;
  annotations: AnnoInfo[];
}
interface CtorParamInfo {
  name: string;
  typeText: string;
  line: number;
  annotations: AnnoInfo[];
}

function parseFile(filePath: string, source: string): ClassInfo[] {
  const tree = getParser().parse(source);
  const root: TSNode = tree.rootNode;
  let pkg = '';
  const classes: ClassInfo[] = [];

  for (const child of root.namedChildren) {
    if (child.type === 'package_declaration') {
      const id = firstChildOfType(child, 'scoped_identifier') ?? firstChildOfType(child, 'identifier');
      if (id) pkg = id.text;
    }
  }

  function visitClass(node: TSNode, prefix = '') {
    const isType = ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'].includes(node.type);
    if (!isType) {
      for (const c of node.namedChildren) visitClass(c, prefix);
      return;
    }
    const nameNode = firstChildOfType(node, 'identifier');
    if (!nameNode) return;
    const name = prefix + nameNode.text;
    const fqcn = pkg ? `${pkg}.${name}` : name;
    const annos = annotationsOf(node);

    // extends / implements
    let extendsName: string | undefined;
    const sc = firstChildOfType(node, 'superclass');
    if (sc) {
      const t = sc.namedChildren.find((c: TSNode) => c.type === 'type_identifier' || c.type === 'generic_type');
      if (t) extendsName = stripGenerics(t.text);
    }
    const implementsList: string[] = [];
    const si = firstChildOfType(node, 'super_interfaces') ?? firstChildOfType(node, 'extends_interfaces');
    if (si) {
      const tl = firstChildOfType(si, 'type_list') ?? firstChildOfType(si, 'interface_type_list') ?? si;
      for (const t of tl.namedChildren) {
        if (t.type === 'type_identifier' || t.type === 'generic_type' || t.type === 'scoped_type_identifier') {
          implementsList.push(stripGenerics(t.text));
        }
      }
    }

    const fields: FieldInfo[] = [];
    const ctorParams: CtorParamInfo[] = [];

    const body = firstChildOfType(node, 'class_body') ?? firstChildOfType(node, 'interface_body') ?? firstChildOfType(node, 'enum_body') ?? firstChildOfType(node, 'record_body');
    if (body) {
      for (const m of body.namedChildren) {
        if (m.type === 'field_declaration') {
          const typeNode = m.childForFieldName('type') ?? m.namedChildren.find((c: TSNode) => /type/.test(c.type));
          const typeText = typeNode ? typeNode.text : '';
          const annos2 = annotationsOf(m);
          for (const decl of childrenOfType(m, 'variable_declarator')) {
            const fnName = firstChildOfType(decl, 'identifier');
            fields.push({
              name: fnName?.text ?? '',
              typeText,
              line: m.startPosition.row + 1,
              annotations: annos2,
            });
          }
        } else if (m.type === 'constructor_declaration') {
          const params = firstChildOfType(m, 'formal_parameters');
          if (!params) continue;
          for (const p of params.namedChildren) {
            if (p.type !== 'formal_parameter') continue;
            const typeNode = p.childForFieldName('type') ?? p.namedChildren.find((c: TSNode) => /type/.test(c.type));
            const idNode = p.childForFieldName('name') ?? firstChildOfType(p, 'identifier');
            ctorParams.push({
              name: idNode?.text ?? '',
              typeText: typeNode ? typeNode.text : '',
              line: p.startPosition.row + 1,
              annotations: annotationsOf(p),
            });
          }
        }
        // recurse into inner classes
        if (m.type === 'class_declaration' || m.type === 'interface_declaration') {
          visitClass(m, `${name}.`);
        }
      }
    }

    classes.push({
      fqcn, file: filePath, line: node.startPosition.row + 1,
      pkg, name, annotations: annos, implementsList, extendsName,
      fields, ctorParams,
    });
  }

  for (const child of root.namedChildren) visitClass(child);
  return classes;
}

// --- main ---

type Edge = {
  kind: 'DI' | 'JPA' | 'CONFIG' | 'JPA-SAMEPKG';
  fromFile: string;
  fromLine: number;
  toFile: string;
  detail: string;
};

async function main() {
  const repo = process.argv[2];
  if (!repo) {
    console.error('Usage: poc.ts <repo-path>');
    process.exit(1);
  }
  const all = await walk(repo);
  const javaFiles = all.filter(f => f.endsWith('.java'));
  const configFiles = all.filter(f => /\/application[^/]*\.(ya?ml|properties)$/.test(f));

  console.log(`# scanned: ${javaFiles.length} java, ${configFiles.length} config files in ${repo}`);
  console.log();

  // pass 1: parse all classes
  const allClasses: ClassInfo[] = [];
  for (const f of javaFiles) {
    try {
      const src = await fs.readFile(f, 'utf-8');
      allClasses.push(...parseFile(f, src));
    } catch (e) {
      console.error(`# parse failed: ${f}: ${(e as Error).message}`);
    }
  }

  // build indexes
  const byFqcn = new Map<string, ClassInfo>();
  const byShortName = new Map<string, ClassInfo[]>(); // for same-package resolution
  const byEntityName = new Map<string, ClassInfo>();
  const beans = new Map<string, ClassInfo>();        // fqcn → bean info (stereotype hit)
  const interfaceImpls = new Map<string, ClassInfo[]>(); // ifaceShortName → impls
  for (const c of allClasses) {
    byFqcn.set(c.fqcn, c);
    const arr = byShortName.get(c.name) ?? [];
    arr.push(c);
    byShortName.set(c.name, arr);
    const entityAnno = findAnnotation(c.annotations, 'Entity');
    if (entityAnno) {
      const ename = entityAnno.args.get('name') ?? c.name;
      if (!byEntityName.has(ename)) byEntityName.set(ename, c);
    }
    for (const a of c.annotations) {
      if (STEREOTYPES.has(a.name)) {
        beans.set(c.fqcn, c);
        break;
      }
    }
    for (const iface of c.implementsList) {
      const sn = shortName(iface);
      const arr2 = interfaceImpls.get(sn) ?? [];
      arr2.push(c);
      interfaceImpls.set(sn, arr2);
    }
  }

  // helper: resolve a short type name from a referencing class
  function resolveType(typeText: string, fromPkg: string): ClassInfo[] {
    const stripped = stripGenerics(typeText);
    if (isStoplisted(stripped)) return [];
    if (stripped.includes('.')) {
      const hit = byFqcn.get(stripped);
      return hit ? [hit] : [];
    }
    // try same package first
    const samePkgFqcn = `${fromPkg}.${stripped}`;
    if (byFqcn.has(samePkgFqcn)) return [byFqcn.get(samePkgFqcn)!];
    // try entity-name index
    if (byEntityName.has(stripped)) return [byEntityName.get(stripped)!];
    // fall back to short-name map (may be ambiguous)
    return byShortName.get(stripped) ?? [];
  }

  // pass 2: emit synthetic edges
  const edges: Edge[] = [];

  for (const c of allClasses) {
    // --- DI: constructor params + @Autowired fields ---
    const isBean = beans.has(c.fqcn);
    // Constructor injection: treat any class with at least one ctor param as a DI site
    // (Spring 4.3+ implicit). Filtering on isBean would miss test classes but for the
    // POC we accept them.
    for (const p of c.ctorParams) {
      const t = stripGenerics(p.typeText);
      if (isStoplisted(t) || PRIMITIVE_OR_BUILTIN.has(shortName(t))) continue;
      const targets = resolveDI(t, c.pkg);
      for (const tgt of targets) {
        edges.push({
          kind: 'DI',
          fromFile: c.file,
          fromLine: p.line,
          toFile: tgt.file,
          detail: `${c.name}(${shortName(t)} ${p.name})  →  ${tgt.fqcn}${tgt.isInterfaceTarget ? ' [interface]' : ''}`,
        });
      }
    }
    for (const f of c.fields) {
      if (!findAnnotation(f.annotations, 'Autowired') && !findAnnotation(f.annotations, 'Inject')
          && !findAnnotation(f.annotations, 'Resource')) continue;
      const t = stripGenerics(f.typeText);
      if (isStoplisted(t)) continue;
      const targets = resolveDI(t, c.pkg);
      for (const tgt of targets) {
        edges.push({
          kind: 'DI',
          fromFile: c.file,
          fromLine: f.line,
          toFile: tgt.file,
          detail: `@Autowired ${shortName(t)} ${f.name}  →  ${tgt.fqcn}`,
        });
      }
    }

    // --- JPA relationships ---
    for (const f of c.fields) {
      const relAnno = f.annotations.find(a => JPA_RELATION_ANNOS.has(a.name));
      if (!relAnno) continue;

      // Prefer targetEntity=Foo.class arg if present
      let targetShort: string | null = null;
      const tgtArg = relAnno.args.get('targetEntity');
      if (tgtArg) {
        targetShort = tgtArg.replace(/\.class$/, '');
      } else {
        // Else: generic arg of collection, or the bare type
        // re-parse typeNode shape from typeText is brittle; use string heuristic
        const m = /^[^<]+<\s*([^,>]+)\s*[,>]/.exec(f.typeText);
        if (m) targetShort = stripGenerics(m[1]).trim();
        else targetShort = stripGenerics(f.typeText);
      }
      if (!targetShort || isStoplisted(targetShort) || PRIMITIVE_OR_BUILTIN.has(shortName(targetShort))) continue;
      const resolved = resolveType(targetShort, c.pkg);
      // Only emit if target is itself a JPA entity (precision filter)
      const entityTargets = resolved.filter(r => findAnnotation(r.annotations, 'Entity'));
      for (const tgt of entityTargets) {
        const samePkg = tgt.pkg === c.pkg;
        edges.push({
          kind: samePkg ? 'JPA-SAMEPKG' : 'JPA',
          fromFile: c.file,
          fromLine: f.line,
          toFile: tgt.file,
          detail: `@${relAnno.name} ${shortName(f.typeText)} ${f.name}  →  ${tgt.fqcn}`,
        });
      }
    }

    // --- @ConfigurationProperties ---
    const cp = findAnnotation(c.annotations, 'ConfigurationProperties');
    if (cp) {
      const prefix = cp.args.get('prefix') ?? cp.args.get('value') ?? cp.positional[0] ?? '';
      if (prefix) {
        for (const cf of configFiles) {
          // crude: read and look for the prefix as a key path
          // do this lazily — re-read each time (POC speed is fine)
          try {
            const ctext = require('node:fs').readFileSync(cf, 'utf-8');
            const dotted = prefix.replace(/\./g, '.');
            if (ctext.includes(dotted)) {
              edges.push({
                kind: 'CONFIG',
                fromFile: c.file,
                fromLine: c.line,
                toFile: cf,
                detail: `@ConfigurationProperties(prefix="${prefix}")  →  ${path.basename(cf)}`,
              });
            }
          } catch { /* noop */ }
        }
      }
    }
  }

  // resolveDI helper closes over indexes
  function resolveDI(typeText: string, fromPkg: string): Array<ClassInfo & { isInterfaceTarget?: boolean }> {
    const stripped = stripGenerics(typeText);
    if (isStoplisted(stripped)) return [];
    const sn = shortName(stripped);
    const resolved = resolveType(stripped, fromPkg);
    if (resolved.length === 0) return [];
    const out: Array<ClassInfo & { isInterfaceTarget?: boolean }> = [];
    for (const r of resolved) {
      // If r itself is a bean, emit it
      if (beans.has(r.fqcn)) {
        out.push(r);
        continue;
      }
      // If r is an interface (no class body for our purposes — heuristic: check via implementsList of others)
      const impls = interfaceImpls.get(sn) ?? [];
      const beanImpls = impls.filter(i => beans.has(i.fqcn));
      if (beanImpls.length > 0) {
        for (const bi of beanImpls) out.push(bi);
      } else {
        // No concrete bean impl found — emit the interface file itself (Spring Data repo case)
        out.push({ ...r, isInterfaceTarget: true });
      }
    }
    return out;
  }

  // --- print ---
  console.log(`# indexes: ${byFqcn.size} classes, ${beans.size} beans, ${byEntityName.size} entities, ${interfaceImpls.size} interfaces`);
  console.log(`# edges:   ${edges.length} total`);
  for (const k of ['DI', 'JPA', 'JPA-SAMEPKG', 'CONFIG'] as const) {
    const n = edges.filter(e => e.kind === k).length;
    console.log(`#   ${k.padEnd(12)} ${n}`);
  }
  console.log();

  // Group by kind
  for (const k of ['DI', 'JPA', 'JPA-SAMEPKG', 'CONFIG'] as const) {
    const subset = edges.filter(e => e.kind === k);
    if (subset.length === 0) continue;
    console.log(`## ${k}`);
    for (const e of subset) {
      console.log(`  ${rel(e.fromFile, repo)}:${e.fromLine}  →  ${rel(e.toFile, repo)}`);
      console.log(`      ${e.detail}`);
    }
    console.log();
  }
}

function rel(p: string, root: string): string {
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

main().catch(e => { console.error(e); process.exit(1); });
