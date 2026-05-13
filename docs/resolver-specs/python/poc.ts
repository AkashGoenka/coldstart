#!/usr/bin/env npx tsx
/**
 * POC for the Python / Django / Flask / Celery / importlib resolver
 * extension described in spec.md.
 *
 * Run:
 *   npx tsx docs/resolver-specs/python/poc.ts [repo-root]
 *
 * Default repo-root: ~/benchmark/repos/arches/arches-coldstart
 *
 * Output: proposed synthetic edges, grouped by category, written to stdout.
 * NO production code is modified.
 */

import { createRequire } from 'node:module';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor: any = require('tree-sitter');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pythonGrammar: any = require('tree-sitter-python');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SETTINGS_KEYS = new Set([
  'MIDDLEWARE', 'MIDDLEWARE_CLASSES',
  'INSTALLED_APPS',
  'AUTHENTICATION_BACKENDS',
  'TEMPLATES', 'LOGGING',
  'ROOT_URLCONF', 'WSGI_APPLICATION', 'ASGI_APPLICATION',
  'DEFAULT_AUTO_FIELD', 'AUTH_USER_MODEL',
  'PASSWORD_HASHERS', 'STORAGES',
  'DEFAULT_FILE_STORAGE', 'STATICFILES_STORAGE',
  'REST_FRAMEWORK', 'CELERY_BEAT_SCHEDULE',
]);

const STOPLIST_PREFIXES = [
  'django.', 'flask.', 'fastapi.', 'starlette.', 'pydantic.',
  'sqlalchemy.', 'celery.', 'kombu.', 'rest_framework.',
  'oauth2_provider.', 'guardian.', 'corsheaders.',
  'django_celery_beat.', 'django_celery_results.', 'django_hosts.',
  'debug_toolbar.', 'silk.', 'webpack_loader.',
  'pgtrigger.', 'revproxy.', 'django_recaptcha.', 'django_migrate_sql.',
  'logging.', 'os.', 'sys.', 'io.', 're.', 'json.',
  'pathlib.', 'typing.', 'collections.', 'functools.',
  'itertools.', 'hashlib.', 'asyncio.', 'dataclasses.',
  'enum.', 'datetime.', 'uuid.',
];

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__',
  'site-packages', '.tox', 'build', 'dist', '.mypy_cache', '.pytest_cache',
]);

// Tighter regex: at least one dot, identifier-ish chunks.
const DOTTED_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/;

// ---------------------------------------------------------------------------
// Edge collector
// ---------------------------------------------------------------------------

interface Edge {
  category: string;
  fromFile: string;       // relative to repo root
  fromLine: number;
  surface: string;        // truncated source snippet
  target: string;         // dotted module/class path
  resolved: string | null; // relative path to file in index, or null
}

const edges: Edge[] = [];
const skipped: Array<{ reason: string; file: string; line: number; surface: string }> = [];

// ---------------------------------------------------------------------------
// File-index helpers
// ---------------------------------------------------------------------------

const pythonFiles: string[] = []; // absolute paths

async function walk(dir: string, repoRoot: string): Promise<void> {
  let entries: any[] = [];
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, repoRoot);
    } else if (e.isFile() && p.endsWith('.py')) {
      pythonFiles.push(p);
    }
  }
}

/**
 * Try to resolve a dotted module path to a file in the index.
 * - Strip a trailing CamelCase segment (assume it's a class name) before mapping.
 * - Walk up from fromFile looking for {ancestor}/<path>.py or .../__init__.py.
 * - Fall back to a global tail-match search across the index.
 */
function resolveDotted(
  raw: string,
  fromFile: string,
  repoRoot: string,
): string | null {
  if (!raw || raw.length < 2) return null;
  const parts = raw.split('.');
  // Try two interpretations: full path as module, and path with last segment
  // stripped (it might be a class or function name). Classes are unambiguous
  // (CamelCase) so we try the strip first for those; for lowercase we try the
  // full path first and fall back to strip.
  const lastIsClass = parts.length > 1 && /^[A-Z]/.test(parts[parts.length - 1]);
  const candidates: string[][] = [];
  if (lastIsClass) {
    candidates.push(parts.slice(0, -1));
    candidates.push(parts);
  } else {
    candidates.push(parts);
    if (parts.length > 1) candidates.push(parts.slice(0, -1));
  }
  for (const modParts of candidates) {
    const r = tryOne(modParts.join('/'), fromFile, repoRoot);
    if (r) return r;
  }
  return null;
}

function tryOne(rel: string, fromFile: string, repoRoot: string): string | null {
  if (!rel) return null;

  let dir = dirname(fromFile);
  for (let i = 0; i < 64; i++) {
    const direct = join(dir, rel + '.py');
    if (existsSync(direct)) return relative(repoRoot, direct);
    const pkg = join(dir, rel, '__init__.py');
    if (existsSync(pkg)) return relative(repoRoot, pkg);
    const src = join(dir, 'src', rel + '.py');
    if (existsSync(src)) return relative(repoRoot, src);
    const srcPkg = join(dir, 'src', rel, '__init__.py');
    if (existsSync(srcPkg)) return relative(repoRoot, srcPkg);
    if (dir === repoRoot) break;
    const parent = dirname(dir);
    if (parent === dir || !parent.startsWith(repoRoot)) break;
    dir = parent;
  }
  // Global tail-match: scan pythonFiles for any file whose path ends in /<rel>.py
  // or whose dirname ends in /<rel> and basename is __init__.py.
  const tailFile = '/' + rel + '.py';
  const tailPkg = '/' + rel + '/__init__.py';
  const matches: string[] = [];
  for (const f of pythonFiles) {
    if (f.endsWith(tailFile) || f.endsWith(tailPkg)) matches.push(f);
  }
  if (matches.length === 1) return relative(repoRoot, matches[0]);
  return null;
}

function isStoplisted(s: string): boolean {
  for (const p of STOPLIST_PREFIXES) if (s.startsWith(p)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Tree-sitter walking
// ---------------------------------------------------------------------------

let parser: any = null;
function getParser(): any {
  if (!parser) {
    parser = new ParserCtor();
    parser.setLanguage(pythonGrammar);
  }
  return parser;
}

function stringContent(node: Node): string | null {
  if (!node || node.type !== 'string') return null;
  // Strip leading/trailing quote(s) — handle b"...", r"...", etc.
  let t = node.text;
  t = t.replace(/^[bBrRuUfF]+/, '');
  if (t.startsWith('"""') || t.startsWith("'''")) {
    return t.slice(3, -3);
  }
  return t.replace(/^['"]|['"]$/g, '');
}

function trunc(s: string, n = 100): string {
  s = s.replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function walkAll(node: Node, fn: (n: Node) => void): void {
  fn(node);
  for (const c of node.namedChildren) walkAll(c, fn);
}

// ---------------------------------------------------------------------------
// Per-file extractors
// ---------------------------------------------------------------------------

function extractSettingsStrings(root: Node, fromFile: string, repoRoot: string): void {
  // Find top-level assignments and aug-assignments matching SETTINGS_KEYS.
  function processRhs(rhs: Node, lhsKey: string): void {
    walkAll(rhs, (n: Node) => {
      if (n.type !== 'string') return;
      const s = stringContent(n);
      if (!s) return;
      if (!DOTTED_RE.test(s)) return;
      if (isStoplisted(s)) {
        skipped.push({
          reason: `stoplist: ${lhsKey}`,
          file: relative(repoRoot, fromFile),
          line: n.startPosition.row + 1,
          surface: trunc(n.text),
        });
        return;
      }
      const resolved = resolveDotted(s, fromFile, repoRoot);
      edges.push({
        category: `settings:${lhsKey}`,
        fromFile: relative(repoRoot, fromFile),
        fromLine: n.startPosition.row + 1,
        surface: trunc(n.text),
        target: s,
        resolved,
      });
    });
  }

  for (const n of root.namedChildren) {
    if (n.type !== 'expression_statement') continue;
    const inner = n.namedChildren[0];
    if (!inner) continue;
    // Direct assignment: MIDDLEWARE = [...]
    if (inner.type === 'assignment') {
      const lhs = inner.namedChildren[0];
      const rhs = inner.namedChildren[inner.namedChildren.length - 1];
      if (lhs?.type === 'identifier' && SETTINGS_KEYS.has(lhs.text)) {
        processRhs(rhs, lhs.text);
      }
      continue;
    }
    // Augmented assignment: INSTALLED_APPS += (...)
    if (inner.type === 'augmented_assignment') {
      const lhs = inner.namedChildren[0];
      const rhs = inner.namedChildren[inner.namedChildren.length - 1];
      if (lhs?.type === 'identifier' && SETTINGS_KEYS.has(lhs.text)) {
        processRhs(rhs, lhs.text);
      }
      continue;
    }
    // Method call: MIDDLEWARE.insert(0, "..."), MIDDLEWARE.append("...")
    if (inner.type === 'call') {
      const fn = inner.namedChildren[0];
      if (fn?.type === 'attribute') {
        const obj = fn.namedChildren[0];
        const meth = fn.namedChildren[1];
        if (obj?.type === 'identifier' && SETTINGS_KEYS.has(obj.text)) {
          const argList = inner.namedChildren.find((c: Node) => c.type === 'argument_list');
          if (argList) {
            // Only positional string args
            for (const arg of argList.namedChildren) {
              if (arg.type === 'string') {
                processRhs(arg, `${obj.text}.${meth?.text ?? '?'}`);
              }
            }
          }
        }
      }
    }
  }
}

function extractUrlIncludes(root: Node, fromFile: string, repoRoot: string): void {
  walkAll(root, (n: Node) => {
    if (n.type !== 'call') return;
    const fn = n.namedChildren[0];
    if (fn?.type !== 'identifier' || fn.text !== 'include') return;
    const argList = n.namedChildren.find((c: Node) => c.type === 'argument_list');
    if (!argList) return;
    const first = argList.namedChildren[0];
    if (!first || first.type !== 'string') return;
    const s = stringContent(first);
    if (!s || !DOTTED_RE.test(s)) return;
    if (isStoplisted(s)) {
      skipped.push({
        reason: 'stoplist: url include',
        file: relative(repoRoot, fromFile),
        line: n.startPosition.row + 1,
        surface: trunc(n.text),
      });
      return;
    }
    const resolved = resolveDotted(s, fromFile, repoRoot);
    edges.push({
      category: 'url:include',
      fromFile: relative(repoRoot, fromFile),
      fromLine: n.startPosition.row + 1,
      surface: trunc(n.text),
      target: s,
      resolved,
    });
  });
}

function extractImportlibAndGetModel(root: Node, fromFile: string, repoRoot: string): void {
  walkAll(root, (n: Node) => {
    if (n.type !== 'call') return;
    const fn = n.namedChildren[0];
    if (!fn) return;

    // importlib.import_module("...")
    if (fn.type === 'attribute' && fn.namedChildren[1]?.text === 'import_module') {
      const obj = fn.namedChildren[0];
      if (obj?.text === 'importlib') {
        const argList = n.namedChildren.find((c: Node) => c.type === 'argument_list');
        const first = argList?.namedChildren[0];
        if (!first) return;
        if (first.type !== 'string') {
          skipped.push({
            reason: `import_module: non-literal arg (${first.type})`,
            file: relative(repoRoot, fromFile),
            line: n.startPosition.row + 1,
            surface: trunc(n.text),
          });
          return;
        }
        const s = stringContent(first);
        if (!s || !/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(s)) return;
        if (isStoplisted(s)) {
          skipped.push({
            reason: 'stoplist: import_module',
            file: relative(repoRoot, fromFile),
            line: n.startPosition.row + 1,
            surface: trunc(n.text),
          });
          return;
        }
        const resolved = resolveDotted(s + '.X', fromFile, repoRoot)
                       ?? resolveDotted(s, fromFile, repoRoot);
        edges.push({
          category: 'importlib:import_module',
          fromFile: relative(repoRoot, fromFile),
          fromLine: n.startPosition.row + 1,
          surface: trunc(n.text),
          target: s,
          resolved,
        });
      }
    }

    // apps.get_model("app_label", "Model") or apps.get_model("app_label.Model")
    if (fn.type === 'attribute' && fn.namedChildren[1]?.text === 'get_model') {
      const argList = n.namedChildren.find((c: Node) => c.type === 'argument_list');
      if (!argList) return;
      const args = argList.namedChildren.filter((c: Node) => c.type !== 'comment');
      if (args.length === 0) return;
      let appLabel: string | null = null;
      let modelName: string | null = null;
      const a0 = stringContent(args[0]);
      if (!a0) return;
      if (args.length >= 2 && args[1].type === 'string') {
        appLabel = a0;
        modelName = stringContent(args[1]);
      } else if (a0.includes('.')) {
        const parts = a0.split('.');
        appLabel = parts[0];
        modelName = parts.slice(1).join('.');
      } else {
        return;
      }
      if (!appLabel || !modelName) return;
      // Try resolving as <ancestor>/<app_label>/models.py
      const candidate = `${appLabel}.models.${modelName}`;
      const resolved = resolveDotted(candidate, fromFile, repoRoot);
      edges.push({
        category: 'orm:apps.get_model',
        fromFile: relative(repoRoot, fromFile),
        fromLine: n.startPosition.row + 1,
        surface: trunc(n.text),
        target: `${appLabel}.${modelName}`,
        resolved,
      });
    }

    // send_task("dotted.task.name")
    if ((fn.type === 'attribute' && fn.namedChildren[1]?.text === 'send_task')
        || (fn.type === 'identifier' && fn.text === 'send_task')) {
      const argList = n.namedChildren.find((c: Node) => c.type === 'argument_list');
      const first = argList?.namedChildren[0];
      if (first?.type === 'string') {
        const s = stringContent(first);
        if (s && DOTTED_RE.test(s) && !isStoplisted(s)) {
          const resolved = resolveDotted(s, fromFile, repoRoot);
          edges.push({
            category: 'celery:send_task',
            fromFile: relative(repoRoot, fromFile),
            fromLine: n.startPosition.row + 1,
            surface: trunc(n.text),
            target: s,
            resolved,
          });
        }
      }
    }
  });
}

function extractCeleryTaskDefs(root: Node, fromFile: string, repoRoot: string): void {
  // @shared_task(name="...") or @app.task(name="...")
  walkAll(root, (n: Node) => {
    if (n.type !== 'decorated_definition') return;
    const decorators = n.namedChildren.filter((c: Node) => c.type === 'decorator');
    for (const dec of decorators) {
      const call = dec.namedChildren.find((c: Node) => c.type === 'call');
      if (!call) continue;
      const fn = call.namedChildren[0];
      const fnText = fn?.text ?? '';
      const looksLikeTask =
        fnText === 'shared_task' ||
        fnText.endsWith('.task') ||
        fnText === 'task';
      if (!looksLikeTask) continue;
      const argList = call.namedChildren.find((c: Node) => c.type === 'argument_list');
      if (!argList) continue;
      for (const arg of argList.namedChildren) {
        if (arg.type !== 'keyword_argument') continue;
        const k = arg.namedChildren[0];
        const v = arg.namedChildren[1];
        if (k?.text === 'name' && v?.type === 'string') {
          const s = stringContent(v);
          if (s && DOTTED_RE.test(s)) {
            // No edge — this is a *registration*; reverse direction (send_task → here).
            edges.push({
              category: 'celery:@task(name=)',
              fromFile: relative(repoRoot, fromFile),
              fromLine: n.startPosition.row + 1,
              surface: trunc(dec.text),
              target: s,
              resolved: relative(repoRoot, fromFile), // self
            });
          }
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const repoRoot = process.argv[2]
    ?? join(homedir(), 'benchmark/repos/arches/arches-coldstart');
  if (!existsSync(repoRoot)) {
    console.error(`repo not found: ${repoRoot}`);
    process.exit(1);
  }
  console.error(`# scanning ${repoRoot}`);
  await walk(repoRoot, repoRoot);
  console.error(`# ${pythonFiles.length} python files`);

  const p = getParser();
  let parsed = 0;
  for (const f of pythonFiles) {
    let content: string;
    try { content = await readFile(f, 'utf-8'); } catch { continue; }
    if (content.length > 500_000) continue;
    let tree: any;
    try {
      if (content.length <= 32000) {
        tree = p.parse(content);
      } else {
        tree = p.parse((idx: number) => idx >= content.length ? null : content.slice(idx, idx + 4096));
      }
    } catch { continue; }
    const root = tree.rootNode;
    const base = basename(f);
    const isSettings = base === 'settings.py' || base.startsWith('settings_');
    const isUrls = base === 'urls.py' || dirname(f).endsWith('/urls');
    if (isSettings) extractSettingsStrings(root, f, repoRoot);
    if (isUrls) extractUrlIncludes(root, f, repoRoot);
    extractImportlibAndGetModel(root, f, repoRoot);
    extractCeleryTaskDefs(root, f, repoRoot);
    parsed++;
  }
  console.error(`# parsed ${parsed} files`);
  console.error(`# emitted ${edges.length} candidate edges (${skipped.length} skipped)`);

  // Group by category
  const byCat = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = e.category;
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(e);
  }
  const cats = [...byCat.keys()].sort();
  for (const cat of cats) {
    const list = byCat.get(cat)!;
    console.log(`\n## ${cat} (${list.length})`);
    for (const e of list) {
      const arrow = e.resolved ? '→' : '↛';
      console.log(
        `${e.fromFile}:${e.fromLine} ${arrow} ${e.resolved ?? '(unresolved)'} ` +
        `[target: ${e.target}, surface: ${e.surface}]`
      );
    }
  }

  console.log(`\n## SKIPPED (${skipped.length})`);
  for (const s of skipped.slice(0, 200)) {
    console.log(`${s.file}:${s.line} [reason: ${s.reason}, surface: ${s.surface}]`);
  }
  if (skipped.length > 200) console.log(`... (${skipped.length - 200} more)`);

  // Summary
  console.log(`\n## SUMMARY`);
  let resolvedN = 0, unresolvedN = 0;
  for (const e of edges) { e.resolved ? resolvedN++ : unresolvedN++; }
  console.log(`total candidate edges: ${edges.length}`);
  console.log(`  resolved (target file in index):   ${resolvedN}`);
  console.log(`  unresolved (third-party or miss):  ${unresolvedN}`);
  console.log(`skipped (stoplist + dynamic args):    ${skipped.length}`);
  for (const cat of cats) {
    const list = byCat.get(cat)!;
    const r = list.filter(e => e.resolved).length;
    console.log(`  ${cat}: ${list.length} total, ${r} resolved`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
