#!/usr/bin/env npx tsx
/**
 * POC for the PHP / Laravel / Symfony resolver extension described in spec.md.
 *
 * Run:
 *   npx tsx docs/resolver-specs/php/poc.ts <repo-root>
 *
 * Output: proposed synthetic edges, grouped by category. NO production code
 * is modified.
 */

import { createRequire } from 'node:module';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, resolve, basename } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor: any = require('tree-sitter');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const phpModule: any = require('tree-sitter-php');
const phpGrammar = phpModule.php ?? phpModule.php_only;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

const RELATIONSHIP_METHODS = new Set([
  'hasOne', 'hasMany', 'hasOneThrough', 'hasManyThrough',
  'belongsTo', 'belongsToMany',
  'morphOne', 'morphMany', 'morphToMany', 'morphedByMany',
]);

const TWIG_METHODS = new Set(['render', 'renderView', 'renderForm', 'stream']);
const CONTAINER_HELPERS = new Set(['app', 'resolve']);
const CONTAINER_BIND_METHODS = new Set(['bind', 'singleton', 'instance', 'scoped']);
const CONTAINER_STR_STOPLIST = new Set([
  'cache', 'config', 'db', 'log', 'view', 'router', 'session', 'translator',
  'validator', 'queue', 'cookie', 'mailer', 'auth', 'auth.driver', 'redis',
  'files', 'hash', 'encrypter', 'broadcast', 'events', 'request', 'url',
  'redirect',
]);

interface Edge {
  category: string;
  fromFile: string;       // relative to repo root
  fromLine: number;
  surface: string;        // the text we matched (truncated)
  target: string;         // FQCN, dotted view path, or fs path
  resolved: string | null; // relative path to file, or null
}

const edges: Edge[] = [];

// ---------------------------------------------------------------------------
// PSR-4 loader (simplified: only repo-root composer.json)
// ---------------------------------------------------------------------------

interface Psr4Map { [ns: string]: string[]; }

async function loadPsr4(repoRoot: string): Promise<Psr4Map> {
  const map: Psr4Map = {};
  try {
    const raw = await readFile(join(repoRoot, 'composer.json'), 'utf-8');
    const cfg = JSON.parse(raw);
    const add = (section: any) => {
      const p = section?.['psr-4'];
      if (!p) return;
      for (const [ns, dirs] of Object.entries(p)) {
        const nsKey = ns.replace(/\\+$/, '');
        const dirList = Array.isArray(dirs) ? dirs : [dirs as string];
        map[nsKey] = (map[nsKey] || []).concat(dirList.map(d => resolve(repoRoot, d)));
      }
    };
    add(cfg.autoload);
    add(cfg['autoload-dev']);
  } catch { /* ignore */ }
  return map;
}

function resolveFqcn(fqcn: string, psr4: Psr4Map, repoRoot: string): string | null {
  const norm = fqcn.replace(/^\\+/, '').replace(/\\/g, '/');
  const entries = Object.entries(psr4).sort((a, b) => b[0].length - a[0].length);
  for (const [ns, dirs] of entries) {
    const nsSlash = ns.replace(/\\/g, '/');
    if (norm !== nsSlash && !norm.startsWith(nsSlash + '/')) continue;
    const suffix = norm.slice(nsSlash.length).replace(/^\//, '');
    for (const dir of dirs) {
      const candidate = join(dir, suffix + '.php');
      if (existsSync(candidate)) return relative(repoRoot, candidate);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'storage', 'public', 'bootstrap/cache']);

async function* walk(root: string, dir = root): AsyncGenerator<string> {
  let entries: any[] = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(root, full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// PHP parsing
// ---------------------------------------------------------------------------

const parser = new ParserCtor();
parser.setLanguage(phpGrammar);

const MAX_STR = 32000;
const CHUNK = 4096;
function parsePhp(content: string): Node {
  if (content.length <= MAX_STR) return parser.parse(content).rootNode;
  return parser.parse((idx: number) => idx >= content.length ? null : content.slice(idx, idx + CHUNK)).rootNode;
}

function childOfType(n: Node, t: string): Node | null {
  return n.namedChildren.find((c: Node) => c.type === t) ?? null;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '');
}

interface FileImports {
  fqcnByShort: Map<string, string>; // short class name -> full FQCN from `use` stmts
  namespace: string;
}

function collectImports(root: Node): FileImports {
  const fqcnByShort = new Map<string, string>();
  let namespace = '';
  function walk(node: Node) {
    if (node.type === 'namespace_definition') {
      const nameNode = childOfType(node, 'namespace_name');
      if (nameNode) namespace = nameNode.text;
    }
    if (node.type === 'namespace_use_declaration') {
      for (const clause of node.namedChildren) {
        if (clause.type !== 'namespace_use_clause') continue;
        const qn = childOfType(clause, 'qualified_name') ?? childOfType(clause, 'name');
        if (!qn) continue;
        const fqcn = qn.text;
        // Check for alias
        const alias = childOfType(clause, 'namespace_aliasing_clause');
        let short: string;
        if (alias) {
          const aliasName = childOfType(alias, 'name');
          short = aliasName ? aliasName.text : fqcn.split('\\').pop()!;
        } else {
          short = fqcn.split('\\').pop()!;
        }
        fqcnByShort.set(short, fqcn);
      }
    }
    for (const c of node.namedChildren) walk(c);
  }
  walk(root);
  return { fqcnByShort, namespace };
}

/**
 * Extract a class name (FQCN-or-short) from a class_constant_access node:
 *   Foo::class -> "Foo"
 *   App\Models\User::class -> "App\Models\User"
 * Or from a string literal:
 *   "App\\Models\\User" -> "App\Models\User"
 * Returns null on anything else.
 */
function extractClassRef(argNode: Node): string | null {
  if (!argNode) return null;
  if (argNode.type === 'argument') argNode = argNode.namedChildren[0] ?? argNode;
  if (!argNode) return null;
  if (argNode.type === 'class_constant_access_expression') {
    // first child is class name (name or qualified_name)
    const cls = argNode.namedChildren[0];
    if (cls && (cls.type === 'name' || cls.type === 'qualified_name')) {
      return cls.text;
    }
  }
  if (argNode.type === 'string' || argNode.type === 'encapsed_string') {
    // string children: 'string_content' or just the raw text including quotes
    const content = childOfType(argNode, 'string_content') ?? childOfType(argNode, 'encapsed_string_content');
    const raw = content ? content.text : stripQuotes(argNode.text);
    // strings can have escaped backslashes: "App\\Models\\User" — PHP source has literal \\,
    // tree-sitter gives us the source text. Treat \\ as \.
    return raw.replace(/\\\\/g, '\\');
  }
  return null;
}

function shortToFqcn(name: string, imports: FileImports): string {
  if (name.includes('\\')) return name;            // already FQCN
  if (imports.fqcnByShort.has(name)) return imports.fqcnByShort.get(name)!;
  // Same-namespace fallback
  if (imports.namespace) return imports.namespace + '\\' + name;
  return name;
}

// ---------------------------------------------------------------------------
// Per-file PHP analysis
// ---------------------------------------------------------------------------

function analyzePhp(content: string, fileRel: string, repoRoot: string, psr4: Psr4Map): void {
  let root: Node;
  try { root = parsePhp(content); } catch { return; }
  const imports = collectImports(root);
  const inModels = fileRel.includes('app/Models/') || fileRel.includes('app\\Models\\');

  function walk(node: Node) {
    // 1) member_call_expression — many cases
    if (node.type === 'member_call_expression') {
      const nameNode = node.childForFieldName('name');
      const objNode = node.childForFieldName('object');
      const argsNode = node.childForFieldName('arguments');
      const methodName = nameNode?.text;
      const args = argsNode?.namedChildren ?? [];

      // Eloquent relationship (gated to app/Models/)
      if (inModels && methodName && RELATIONSHIP_METHODS.has(methodName) && args.length > 0) {
        const ref = extractClassRef(args[0]);
        if (ref) {
          const fqcn = shortToFqcn(ref, imports);
          edges.push({
            category: 'eloquent-relation',
            fromFile: fileRel,
            fromLine: node.startPosition.row + 1,
            surface: `$this->${methodName}(${ref}::class)`,
            target: fqcn,
            resolved: resolveFqcn(fqcn, psr4, repoRoot),
          });
        }
      }

      // Twig render: $this->render('blog/post_show.html.twig')
      if (objNode?.text === '$this' && methodName && TWIG_METHODS.has(methodName) && args.length > 0) {
        const arg = args[0].type === 'argument' ? args[0].namedChildren[0] : args[0];
        if (arg && (arg.type === 'string' || arg.type === 'encapsed_string')) {
          // Reject concatenation forms (binary_expression with '.')
          // The arg IS the string node only if no concat happened
          const content = childOfType(arg, 'string_content') ?? childOfType(arg, 'encapsed_string_content');
          const tplPath = content ? content.text : stripQuotes(arg.text);
          // Walk up from current file dir to find templates/
          const tplResolved = resolveTwig(tplPath, fileRel, repoRoot);
          edges.push({
            category: 'symfony-twig-render',
            fromFile: fileRel,
            fromLine: node.startPosition.row + 1,
            surface: `$this->${methodName}('${tplPath}')`,
            target: tplPath,
            resolved: tplResolved,
          });
        }
      }

      // Container bind: $this->app->bind(IFoo::class, Foo::class) / singleton(...)
      if (
        objNode?.text === '$this->app' &&
        methodName && CONTAINER_BIND_METHODS.has(methodName) &&
        args.length >= 1
      ) {
        const abstractRef = extractClassRef(args[0]);
        const concreteRef = args.length >= 2 ? extractClassRef(args[1]) : null;
        for (const ref of [abstractRef, concreteRef].filter(Boolean) as string[]) {
          const fqcn = shortToFqcn(ref, imports);
          edges.push({
            category: 'laravel-container-bind',
            fromFile: fileRel,
            fromLine: node.startPosition.row + 1,
            surface: `$this->app->${methodName}(${ref}::class, ...)`,
            target: fqcn,
            resolved: resolveFqcn(fqcn, psr4, repoRoot),
          });
        }
      }
    }

    // 2) function_call_expression — app(...) / resolve(...)
    if (node.type === 'function_call_expression') {
      const nameNode = node.namedChildren[0];
      const argsNode = node.childForFieldName('arguments');
      const args = argsNode?.namedChildren ?? [];
      if (nameNode && (nameNode.type === 'name' || nameNode.type === 'qualified_name')) {
        const fnName = nameNode.text;
        if (CONTAINER_HELPERS.has(fnName) && args.length > 0) {
          const ref = extractClassRef(args[0]);
          if (ref) {
            const fqcn = shortToFqcn(ref, imports);
            // skip string-id case (no backslash, no class-const) — heuristic: if
            // arg was a string literal AND the original arg text contained '.',
            // it's a service id like 'cache.store'. Surface form check:
            const isStringId = args[0].text.startsWith("'") || args[0].text.startsWith('"');
            const looksLikeServiceId = isStringId && !ref.includes('\\') && (ref.includes('.') || CONTAINER_STR_STOPLIST.has(ref));
            if (looksLikeServiceId) { /* skip */ }
            else {
              edges.push({
                category: 'laravel-container-make',
                fromFile: fileRel,
                fromLine: node.startPosition.row + 1,
                surface: `${fnName}(${ref}::class)`,
                target: fqcn,
                resolved: resolveFqcn(fqcn, psr4, repoRoot),
              });
            }
          }
        }
      }
    }

    // 3) Symfony #[Route] attribute
    if (node.type === 'attribute') {
      // attribute: name '(' arguments? ')'
      const nameNode = childOfType(node, 'name') ?? childOfType(node, 'qualified_name');
      if (nameNode?.text === 'Route') {
        const argsNode = childOfType(node, 'arguments');
        const args = argsNode?.namedChildren ?? [];
        if (args.length > 0) {
          const a = args[0].type === 'argument' ? args[0].namedChildren[0] : args[0];
          if (a && (a.type === 'string' || a.type === 'encapsed_string')) {
            const c = childOfType(a, 'string_content');
            const path = c ? c.text : stripQuotes(a.text);
            edges.push({
              category: 'symfony-route-attr',
              fromFile: fileRel,
              fromLine: node.startPosition.row + 1,
              surface: `#[Route('${path}')]`,
              target: path,
              resolved: fileRel, // route lives on this controller; no separate file
            });
          }
        }
      }
    }

    for (const c of node.namedChildren) walk(c);
  }

  walk(root);
}

// ---------------------------------------------------------------------------
// Blade
// ---------------------------------------------------------------------------

const BLADE_REGEX = /@(include|includeIf|includeWhen|includeUnless|extends|component)\s*\(\s*(['"])([^'"]+)\2/g;

function analyzeBlade(content: string, fileRel: string, repoRoot: string): void {
  let m: RegExpExecArray | null;
  // Compute line numbers cheaply.
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') lineStarts.push(i + 1);
  function lineOf(offset: number): number {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }
  BLADE_REGEX.lastIndex = 0;
  while ((m = BLADE_REGEX.exec(content)) !== null) {
    const directive = m[1];
    const path = m[3];
    const resolved = resolveBlade(path, fileRel, repoRoot);
    edges.push({
      category: 'laravel-blade-include',
      fromFile: fileRel,
      fromLine: lineOf(m.index),
      surface: `@${directive}('${path}')`,
      target: path,
      resolved,
    });
  }
}

function findAncestorDir(start: string, target: string, repoRoot: string): string | null {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, target);
    if (existsSync(candidate)) return candidate;
    if (dir === repoRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveBlade(path: string, fileRel: string, repoRoot: string): string | null {
  const startDir = dirname(join(repoRoot, fileRel));
  const viewsRoot = findAncestorDir(startDir, 'resources/views', repoRoot)
    ?? join(repoRoot, 'resources/views');
  // Vendor namespace: "mail::message" -> resources/views/vendor/mail/message.blade.php
  if (path.includes('::')) {
    const [vendor, rest] = path.split('::');
    const candidate = join(viewsRoot, 'vendor', vendor, rest.replace(/\./g, '/') + '.blade.php');
    if (existsSync(candidate)) return relative(repoRoot, candidate);
    return null;
  }
  const candidate = join(viewsRoot, path.replace(/\./g, '/') + '.blade.php');
  if (existsSync(candidate)) return relative(repoRoot, candidate);
  return null;
}

function resolveTwig(path: string, fileRel: string, repoRoot: string): string | null {
  const startDir = dirname(join(repoRoot, fileRel));
  const tplRoot = findAncestorDir(startDir, 'templates', repoRoot) ?? join(repoRoot, 'templates');
  const candidate = join(tplRoot, path);
  if (existsSync(candidate)) return relative(repoRoot, candidate);
  return null;
}

// ---------------------------------------------------------------------------
// Symfony services.yaml (hand-rolled minimal scanner)
// ---------------------------------------------------------------------------

async function analyzeServicesYaml(repoRoot: string, psr4: Psr4Map): Promise<void> {
  const path = join(repoRoot, 'config/services.yaml');
  if (!existsSync(path)) return;
  const content = await readFile(path, 'utf-8');
  const fileRel = relative(repoRoot, path);
  const lines = content.split('\n');
  let inServices = false;
  let servicesIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^services:\s*$/.test(trimmed)) { inServices = true; servicesIndent = raw.search(/\S/); continue; }
    if (!inServices) continue;
    const indent = raw.search(/\S/);
    if (indent <= servicesIndent && /^[A-Za-z]/.test(trimmed)) {
      // left the services section
      inServices = false;
      continue;
    }
    // Top-level service key at indent == servicesIndent + N (usually 4)
    // We want keys that are either FQCN-shaped ("App\Foo: ...") or namespace globs ("App\: ...")
    const keyMatch = trimmed.match(/^([A-Za-z_\\][A-Za-z0-9_\\]*\\?)\s*:\s*(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const rest = keyMatch[2];
    if (!key.includes('\\') && key !== '_defaults' && key !== '_instanceof') continue;
    if (key === '_defaults' || key === '_instanceof') continue;
    if (key.endsWith('\\')) {
      // Glob form: look for 'resource:' on subsequent indented lines
      let resource: string | null = null;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const inner = lines[j];
        const innerIndent = inner.search(/\S/);
        if (innerIndent <= indent) break;
        const rm = inner.trim().match(/^resource:\s*['"]?([^'"#]+)['"]?/);
        if (rm) { resource = rm[1].trim(); break; }
      }
      if (resource) {
        const resolvedDir = resolve(dirname(path), resource);
        edges.push({
          category: 'symfony-services-glob',
          fromFile: fileRel,
          fromLine: i + 1,
          surface: `${key}: resource: '${resource}'`,
          target: key + '* -> ' + resource,
          resolved: existsSync(resolvedDir) ? relative(repoRoot, resolvedDir) : null,
        });
      }
    } else {
      // Explicit class key. If `class:` is set on a child line, use it; else key is the FQCN.
      let fqcn = key;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const inner = lines[j];
        const innerIndent = inner.search(/\S/);
        if (innerIndent <= indent) break;
        const cm = inner.trim().match(/^class:\s*['"]?([^'"#]+)['"]?/);
        if (cm) { fqcn = cm[1].trim(); break; }
      }
      edges.push({
        category: 'symfony-services-explicit',
        fromFile: fileRel,
        fromLine: i + 1,
        surface: `${key}:`,
        target: fqcn,
        resolved: resolveFqcn(fqcn, psr4, repoRoot),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const repoRoot = resolve(process.argv[2] || '.');
  if (!existsSync(repoRoot)) {
    console.error(`No such dir: ${repoRoot}`);
    process.exit(1);
  }
  console.error(`Analyzing: ${repoRoot}`);
  const psr4 = await loadPsr4(repoRoot);
  console.error(`PSR-4 prefixes: ${Object.keys(psr4).join(', ') || '(none)'}`);

  let phpCount = 0, bladeCount = 0;
  for await (const file of walk(repoRoot)) {
    const rel = relative(repoRoot, file);
    if (rel.endsWith('.blade.php')) {
      try {
        const content = await readFile(file, 'utf-8');
        analyzeBlade(content, rel, repoRoot);
        bladeCount++;
      } catch { /* skip */ }
    } else if (rel.endsWith('.php')) {
      try {
        const content = await readFile(file, 'utf-8');
        analyzePhp(content, rel, repoRoot, psr4);
        phpCount++;
      } catch { /* skip */ }
    }
  }

  await analyzeServicesYaml(repoRoot, psr4);

  console.error(`\nFiles scanned: ${phpCount} PHP, ${bladeCount} Blade`);
  console.error(`Edges emitted: ${edges.length}\n`);

  // Group & print
  const byCat = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!byCat.has(e.category)) byCat.set(e.category, []);
    byCat.get(e.category)!.push(e);
  }
  for (const [cat, list] of [...byCat.entries()].sort()) {
    const resolved = list.filter(e => e.resolved).length;
    console.log(`## ${cat}  (${list.length} total, ${resolved} resolved)\n`);
    // Print first 20 per category to keep output readable
    for (const e of list.slice(0, 20)) {
      const tag = e.resolved ? 'OK' : '--';
      console.log(`  [${tag}] ${e.fromFile}:${e.fromLine}  ${e.surface}`);
      console.log(`         -> ${e.target}`);
      if (e.resolved) console.log(`         => ${e.resolved}`);
    }
    if (list.length > 20) console.log(`  ... (${list.length - 20} more)`);
    console.log();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
