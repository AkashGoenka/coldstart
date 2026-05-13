#!/usr/bin/env tsx
/**
 * POC: JS/TS framework-convention edge extraction.
 *
 *   npx tsx docs/resolver-specs/js-ts/poc.ts <repo-path>
 *
 * Prints proposed synthetic edges per framework. No production wiring.
 * Research-only — see spec.md.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

type EdgeKind =
  | 'next:page-to-layout'
  | 'next:page-to-sibling'
  | 'next:parallel-fallback'
  | 'next:pages-to-app'
  | 'next:pages-to-document'
  | 'sveltekit:page-to-layout'
  | 'sveltekit:page-to-server-load'
  | 'sveltekit:page-to-sibling'
  | 'nest:module-providers'
  | 'glob:auto-load';

interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  note?: string;
}

const NEXT_SPECIAL = new Set([
  'page', 'layout', 'loading', 'error', 'not-found', 'template', 'default', 'route',
]);
const EXTS = ['.tsx', '.ts', '.jsx', '.js'];

function exists(p: string): boolean { try { return fs.statSync(p).isFile(); } catch { return false; } }
function dirExists(p: string): boolean { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function findFileWithExt(dir: string, base: string): string | null {
  for (const ext of EXTS) {
    const p = path.join(dir, base + ext);
    if (exists(p)) return p;
  }
  return null;
}

function readSafe(p: string): string {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.svelte-kit', 'dist', 'build', '.turbo',
  'coverage', '.cache', '.nuxt',
]);

function walkAll(root: string, maxDepth = 12): string[] {
  const out: string[] = [];
  function visit(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) visit(p, depth + 1);
      else if (e.isFile()) out.push(p);
    }
  }
  visit(root, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

interface PackageJson { dependencies?: Record<string,string>; devDependencies?: Record<string,string>; }
function readPkg(p: string): PackageJson { try { return JSON.parse(readSafe(p)) as PackageJson; } catch { return {}; } }
function hasDep(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function detectFrameworkRoots(root: string): {
  next: string[]; sveltekit: string[]; nest: string[]; nuxt: string[];
} {
  const result = { next: [] as string[], sveltekit: [] as string[], nest: [] as string[], nuxt: [] as string[] };
  for (const file of walkAll(root, 6)) {
    if (path.basename(file) !== 'package.json') continue;
    const dir = path.dirname(file);
    const pkg = readPkg(file);
    if (hasDep(pkg, 'next')) result.next.push(dir);
    if (hasDep(pkg, '@sveltejs/kit')) result.sveltekit.push(dir);
    if (hasDep(pkg, '@nestjs/core') || hasDep(pkg, '@nestjs/common')) result.nest.push(dir);
    if (hasDep(pkg, 'nuxt')) result.nuxt.push(dir);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Next.js
// ---------------------------------------------------------------------------

function nextRouteEdges(pkgDir: string): Edge[] {
  const edges: Edge[] = [];
  const candidates = ['app', 'src/app', 'apps/web/app', 'apps/docs/app'];
  for (const rel of candidates) {
    const appDir = path.join(pkgDir, rel);
    if (dirExists(appDir)) edges.push(...nextAppRouterEdges(appDir));
  }
  // pages router
  const pagesCandidates = ['pages', 'src/pages', 'apps/web/pages'];
  for (const rel of pagesCandidates) {
    const pagesDir = path.join(pkgDir, rel);
    if (dirExists(pagesDir)) edges.push(...nextPagesRouterEdges(pagesDir));
  }
  return edges;
}

function nextAppRouterEdges(appDir: string): Edge[] {
  const edges: Edge[] = [];
  const files = walkAll(appDir);
  // Group files by parent dir
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const d = path.dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(path.basename(f));
  }
  function nameInDir(dir: string, base: string): string | null {
    const files = byDir.get(dir);
    if (!files) return null;
    for (const ext of EXTS) {
      const target = base + ext;
      if (files.includes(target)) return path.join(dir, target);
    }
    return null;
  }
  for (const file of files) {
    const base = path.basename(file);
    const stem = base.replace(/\.(tsx|ts|jsx|js)$/, '');
    if (!NEXT_SPECIAL.has(stem)) continue;
    if (stem === 'page' || stem === 'route') {
      // Walk ancestors collecting layouts
      let cur = path.dirname(file);
      while (cur.startsWith(appDir) || cur === appDir) {
        const layout = nameInDir(cur, 'layout');
        if (layout && layout !== file) {
          edges.push({ from: file, to: layout, kind: 'next:page-to-layout' });
        }
        if (cur === appDir) break;
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
      // Same-dir siblings
      const dir = path.dirname(file);
      for (const sib of ['loading', 'error', 'not-found', 'template']) {
        const target = nameInDir(dir, sib);
        if (target) edges.push({ from: file, to: target, kind: 'next:page-to-sibling' });
      }
      // Parallel-slot fallbacks: sibling dirs starting with '@'
      try {
        const siblings = fs.readdirSync(dir, { withFileTypes: true });
        for (const s of siblings) {
          if (s.isDirectory() && s.name.startsWith('@')) {
            const slotDefault = nameInDir(path.join(dir, s.name), 'default');
            if (slotDefault) edges.push({ from: file, to: slotDefault, kind: 'next:parallel-fallback' });
          }
        }
      } catch {}
    }
    if (stem === 'layout') {
      // Layout → ancestor layouts
      let cur = path.dirname(path.dirname(file)); // skip own dir
      while (cur.startsWith(appDir) || cur === appDir) {
        const layout = nameInDir(cur, 'layout');
        if (layout) edges.push({ from: file, to: layout, kind: 'next:page-to-layout', note: 'layout-to-ancestor-layout' });
        if (cur === appDir) break;
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }
  }
  return edges;
}

function nextPagesRouterEdges(pagesDir: string): Edge[] {
  const edges: Edge[] = [];
  const app = findFileWithExt(pagesDir, '_app');
  const doc = findFileWithExt(pagesDir, '_document');
  const files = walkAll(pagesDir);
  for (const f of files) {
    const base = path.basename(f);
    if (base.startsWith('_')) continue;             // skip _app, _document, _error
    if (f.startsWith(path.join(pagesDir, 'api') + path.sep)) continue;
    if (!/\.(tsx|ts|jsx|js)$/.test(base)) continue;
    if (app) edges.push({ from: f, to: app, kind: 'next:pages-to-app' });
    if (doc) edges.push({ from: f, to: doc, kind: 'next:pages-to-document' });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// SvelteKit
// ---------------------------------------------------------------------------

function sveltekitEdges(pkgDir: string): Edge[] {
  const edges: Edge[] = [];
  const routesDir = path.join(pkgDir, 'src', 'routes');
  if (!dirExists(routesDir)) return edges;
  const files = walkAll(routesDir);
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const d = path.dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(path.basename(f));
  }
  function findIn(dir: string, prefix: string, extWhitelist: string[]): string | null {
    const list = byDir.get(dir);
    if (!list) return null;
    for (const ext of extWhitelist) {
      const target = prefix + ext;
      if (list.includes(target)) return path.join(dir, target);
    }
    return null;
  }
  for (const file of files) {
    const base = path.basename(file);
    if (base !== '+page.svelte' && base !== '+server.ts' && base !== '+server.js') continue;
    const dir = path.dirname(file);
    // page-server pair
    if (base === '+page.svelte') {
      const pserver = findIn(dir, '+page.server', ['.ts', '.js']);
      if (pserver) edges.push({ from: file, to: pserver, kind: 'sveltekit:page-to-server-load' });
      const pclient = findIn(dir, '+page', ['.ts', '.js']);
      if (pclient) edges.push({ from: file, to: pclient, kind: 'sveltekit:page-to-sibling' });
      const err = findIn(dir, '+error', ['.svelte']);
      if (err) edges.push({ from: file, to: err, kind: 'sveltekit:page-to-sibling' });
    }
    // Walk ancestors for layouts
    let cur = dir;
    while (cur.startsWith(routesDir) || cur === routesDir) {
      const layout = findIn(cur, '+layout', ['.svelte']);
      if (layout && layout !== file) edges.push({ from: file, to: layout, kind: 'sveltekit:page-to-layout' });
      const slayout = findIn(cur, '+layout.server', ['.ts', '.js']);
      if (slayout) edges.push({ from: file, to: slayout, kind: 'sveltekit:page-to-layout', note: 'server-layout' });
      if (cur === routesDir) break;
      const p = path.dirname(cur);
      if (p === cur) break;
      cur = p;
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// NestJS @Module — naive parse just to demonstrate
// ---------------------------------------------------------------------------

function nestModuleEdges(pkgDir: string): Edge[] {
  const edges: Edge[] = [];
  const files = walkAll(pkgDir).filter(f => f.endsWith('.module.ts') || f.endsWith('.module.js'));
  for (const file of files) {
    const src = readSafe(file);
    const moduleMatch = src.match(/@Module\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    if (!moduleMatch) continue;
    const body = moduleMatch[1];
    const providersArr = /providers\s*:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '';
    const controllersArr = /controllers\s*:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '';
    const provNames = providersArr.split(',').map(s => s.trim()).filter(Boolean);
    const ctrlNames = controllersArr.split(',').map(s => s.trim()).filter(Boolean);
    // Edges from each controller to each provider IN THIS MODULE
    // (proxy for the DI-resolves-by-module-scope rule). Real implementation
    // would resolve identifier→file via the file's import map.
    for (const ctrl of ctrlNames) {
      for (const prov of provNames) {
        edges.push({
          from: file,
          to: `[${ctrl} → ${prov}] (module scope, identifier-only; needs import resolution)`,
          kind: 'nest:module-providers',
          note: 'POC stops at name extraction; production would resolve identifier→file via the module file\'s own import map',
        });
      }
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Glob-loaded directories (fs.readdirSync + require/import in loop)
// ---------------------------------------------------------------------------

function globLoadEdges(rootDir: string): Edge[] {
  const edges: Edge[] = [];
  const candidates = walkAll(rootDir).filter(f => /\.(js|ts|mjs|cjs)$/.test(f));
  for (const file of candidates) {
    const src = readSafe(file);
    if (!src.includes('readdirSync')) continue;
    if (!/readdirSync\s*\(\s*(__dirname|path\.join\([^)]*__dirname)/.test(src)) continue;
    // Must contain require()/import() inside loop-ish surface
    if (!/forEach|\.map\s*\(/.test(src)) continue;
    if (!/require\s*\(|import\s*\(/.test(src)) continue;
    // Emit edges to siblings (same dir, same extension family)
    const dir = path.dirname(file);
    let siblings: string[] = [];
    try {
      siblings = fs.readdirSync(dir).filter(n => n !== path.basename(file) && /\.(js|ts|mjs|cjs)$/.test(n));
    } catch {}
    for (const sib of siblings) {
      edges.push({ from: file, to: path.join(dir, sib), kind: 'glob:auto-load' });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const repo = process.argv[2];
  if (!repo) {
    console.error('usage: tsx poc.ts <repo-path>');
    process.exit(1);
  }
  const abs = path.resolve(repo);
  if (!dirExists(abs)) {
    console.error(`not a directory: ${abs}`);
    process.exit(1);
  }
  console.log(`# POC scan: ${abs}\n`);
  const fw = detectFrameworkRoots(abs);
  console.log(`detected: next=${fw.next.length} sveltekit=${fw.sveltekit.length} nest=${fw.nest.length} nuxt=${fw.nuxt.length}`);
  for (const dir of fw.next) console.log(`  next pkg: ${path.relative(abs, dir) || '.'}`);
  for (const dir of fw.sveltekit) console.log(`  sveltekit pkg: ${path.relative(abs, dir) || '.'}`);
  for (const dir of fw.nest) console.log(`  nest pkg: ${path.relative(abs, dir) || '.'}`);
  console.log();

  const allEdges: Edge[] = [];
  for (const dir of fw.next) allEdges.push(...nextRouteEdges(dir));
  for (const dir of fw.sveltekit) allEdges.push(...sveltekitEdges(dir));
  for (const dir of fw.nest) allEdges.push(...nestModuleEdges(dir));
  allEdges.push(...globLoadEdges(abs));

  // Summary by kind
  const byKind = new Map<string, number>();
  for (const e of allEdges) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  console.log('## edge summary');
  for (const [k, v] of [...byKind.entries()].sort()) console.log(`  ${k.padEnd(32)} ${v}`);
  console.log(`  TOTAL                            ${allEdges.length}`);
  console.log();

  // Print up to N edges per kind for readability
  const PRINT_PER_KIND = 40;
  const seenCount = new Map<string, number>();
  console.log('## sample edges');
  for (const e of allEdges) {
    const c = seenCount.get(e.kind) ?? 0;
    if (c >= PRINT_PER_KIND) continue;
    seenCount.set(e.kind, c + 1);
    const from = path.relative(abs, e.from);
    const to = e.to.startsWith('[') ? e.to : path.relative(abs, e.to);
    console.log(`  [${e.kind}] ${from}  ->  ${to}${e.note ? '  // ' + e.note : ''}`);
  }
}

main();
