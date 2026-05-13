/**
 * Rails autoload synthetic-edge POC for coldstart-mcp.
 *
 * Walks a Rails repo's app/**\/*.rb tree, extracts capitalized constant
 * references and `render` calls, resolves them via Rails autoload
 * conventions, and prints proposed synthetic edges.
 *
 * Standalone — does NOT integrate with coldstart's graph.
 *
 * Usage:
 *   npx tsx docs/resolver-specs/ruby/poc.ts [rails-repo-path]
 *
 * Default repo: ~/benchmark/repos/mastodon/mastodon-coldstart
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new (): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rubyGrammar = require('tree-sitter-ruby') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const parser = new ParserCtor();
parser.setLanguage(rubyGrammar);

// ---------------------------------------------------------------------------
// Stoplist (cf. spec §3)
// ---------------------------------------------------------------------------

const STOP_TOP_LEVEL = new Set<string>([
  // Ruby builtins
  'Object', 'Kernel', 'Module', 'Class', 'BasicObject', 'Proc', 'Method', 'UnboundMethod',
  'String', 'Symbol', 'Integer', 'Float', 'Numeric', 'Rational', 'Complex',
  'TrueClass', 'FalseClass', 'NilClass', 'Array', 'Hash', 'Set', 'Range',
  'Regexp', 'MatchData', 'Time', 'Date', 'DateTime', 'IO', 'File', 'Dir',
  'Pathname', 'URI', 'Tempfile', 'Struct', 'OpenStruct', 'Comparable',
  'Enumerable', 'Enumerator', 'StandardError', 'RuntimeError', 'ArgumentError',
  'TypeError', 'NameError', 'NoMethodError', 'NotImplementedError', 'IOError',
  'EOFError', 'SystemCallError', 'ZeroDivisionError', 'FloatDomainError',
  'IndexError', 'KeyError', 'RangeError', 'StopIteration', 'ThreadError',
  'FiberError', 'LocalJumpError', 'SignalException', 'Errno', 'Encoding',
  'Thread', 'Fiber', 'Mutex', 'Queue', 'ConditionVariable', 'GC',
  'ObjectSpace', 'Process', 'Signal', 'Math', 'Random', 'JSON', 'YAML',
  'CSV', 'Base64', 'Digest', 'OpenSSL', 'Net', 'ERB', 'CGI', 'Logger',
  'SecureRandom', 'FileUtils', 'Forwardable', 'Singleton', 'BigDecimal',
  'Marshal', 'NoMatchingPatternError', 'NoMatchingPatternKeyError',
  'FrozenError', 'Data', 'Comparable', 'Exception', 'ScriptError',
  'LoadError', 'SyntaxError', 'SystemExit', 'Interrupt', 'Warning',
  'GC', 'TracePoint', 'Method', 'Refinement',
  // Rails framework
  'Rails', 'ActiveRecord', 'ActiveModel', 'ActiveSupport', 'ActionController',
  'ActionView', 'ActionDispatch', 'ActionMailer', 'ActionCable', 'ActionPack',
  'ActiveJob', 'ActiveStorage', 'ActionText', 'ActionMailbox', 'ActiveResource',
  'Concern', 'Mime', 'MIME', 'I18n', 'Migration', 'Schema', 'Devise',
  'Doorkeeper', 'Sidekiq', 'Paperclip', 'CarrierWave', 'Pundit', 'Kaminari',
  'WillPaginate', 'RSpec', 'Minitest', 'Faker', 'FactoryBot', 'Webpacker',
  'RSolr', 'Redis', 'Memcached', 'Resque', 'GoodJob', 'Que', 'DelayedJob',
  'Aws', 'Azure', 'Google', 'GraphQL', 'Stripe', 'Twilio', 'Twitter',
  'OmniAuth', 'Bundler', 'Gem', 'Rake', 'Rack', 'Sprockets', 'Webrick',
  'Capybara', 'Cucumber', 'Chewy', 'Elasticsearch', 'OpenSearch',
  'Mail', 'Premailer', 'Nokogiri', 'Loofah', 'Sanitize', 'HTTP', 'HTTParty',
  'Faraday', 'RestClient', 'Excon', 'Typhoeus', 'Patron', 'Curb',
  'Mongoid', 'Sequel', 'ROM', 'Hanami', 'Dry', 'ROM', 'Trailblazer',
  'Pry', 'Awesome_print', 'Awesome', 'Byebug', 'Debug', 'Inspect',
  'Rugged', 'Octokit', 'Git', 'Github', 'Gitlab', 'Bitbucket',
  'Sass', 'Less', 'Stylus', 'Coffee', 'CoffeeScript', 'TypeScript',
  'Ostruct', 'Set', 'Singleton', 'PP', 'PrettyPrint', 'Benchmark',
  // Mastodon-specific common libs found in spot checks
  'ActiveResource', 'Webrick',
]);

const STOP_PREFIXES = [
  'ActiveRecord::', 'ActiveModel::', 'ActiveSupport::', 'ActionController::',
  'ActionView::', 'ActionDispatch::', 'ActionMailer::', 'ActionCable::',
  'ActiveJob::', 'ActiveStorage::', 'Rails::', 'Concern::',
  'Devise::', 'Doorkeeper::', 'Sidekiq::', 'Pundit::', 'Kaminari::',
  'OmniAuth::', 'OAuth::', 'OAuth2::', 'JWT::', 'OpenSSL::', 'Net::',
  'URI::', 'Errno::', 'Encoding::', 'Process::', 'Math::', 'File::',
  'IO::', 'Dir::', 'Thread::', 'JSON::', 'YAML::', 'CSV::', 'ERB::',
  'Digest::', 'Base64::', 'Mime::', 'MIME::', 'I18n::', 'Aws::',
  'Google::', 'GraphQL::', 'Stripe::', 'Mail::', 'Nokogiri::',
  'HTTP::', 'HTTParty::', 'Faraday::', 'Chewy::', 'Sprockets::',
  'Bundler::', 'Gem::', 'Rake::', 'Rack::', 'Bundler::', 'Logger::',
  'Sanitize::', 'Loofah::', 'Premailer::', 'Twitter::', 'Twilio::',
  'OmniAuth::', 'FactoryBot::', 'RSpec::', 'Minitest::', 'Capybara::',
];

function isStoplisted(fqcn: string, fqcnIndex: Map<string, string>): boolean {
  const head = fqcn.split('::')[0];
  // If we *do* have this in our app index, never stoplist (per spec §3.3)
  if (lookupFqcn(fqcn, fqcnIndex)) return false;
  if (STOP_TOP_LEVEL.has(head)) return true;
  for (const p of STOP_PREFIXES) if (fqcn.startsWith(p)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// underscore (ActiveSupport::Inflector-equivalent for our needs)
// ---------------------------------------------------------------------------

function underscore(s: string): string {
  return s
    .replace(/::/g, '/')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// FQCN index
// ---------------------------------------------------------------------------

interface AppInfo {
  appRoot: string;
  autoloadRoots: string[];      // absolute paths to autoload roots
  rubyFiles: string[];           // absolute .rb paths under app/**
  viewFiles: string[];           // absolute paths under app/views/**
}

function walk(dir: string, out: string[], filter: (p: string) => boolean): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, filter);
    else if (filter(p)) out.push(p);
  }
}

function discoverApp(appRoot: string): AppInfo {
  const appDir = join(appRoot, 'app');
  const autoloadRoots: string[] = [];
  for (const e of readdirSync(appDir)) {
    const p = join(appDir, e);
    if (!statSync(p).isDirectory()) continue;
    if (e === 'views' || e === 'javascript' || e === 'assets') continue;
    autoloadRoots.push(p);
    // concerns/ subdir is itself a root
    const concerns = join(p, 'concerns');
    if (existsSync(concerns) && statSync(concerns).isDirectory()) {
      autoloadRoots.push(concerns);
    }
  }
  const rubyFiles: string[] = [];
  walk(appDir, rubyFiles, p => p.endsWith('.rb'));
  const viewFiles: string[] = [];
  const viewDir = join(appDir, 'views');
  if (existsSync(viewDir)) walk(viewDir, viewFiles, () => true);
  return { appRoot, autoloadRoots, rubyFiles, viewFiles };
}

function buildFqcnIndex(info: AppInfo): Map<string, string> {
  // Map of snake_cased FQCN path (e.g. "admin/user") → absolute file path.
  const idx = new Map<string, string>();
  for (const root of info.autoloadRoots) {
    // For this root, the relative path of any .rb (minus .rb) is the FQCN path.
    const files: string[] = [];
    walk(root, files, p => p.endsWith('.rb'));
    for (const f of files) {
      let rel = relative(root, f).slice(0, -3); // strip .rb
      // Strip a leading concerns/ segment (when iterating from a non-concerns root)
      // e.g. app/models/concerns/visibility.rb under root app/models becomes "visibility"
      if (rel.startsWith('concerns/') || rel.startsWith('concerns' + sep)) {
        rel = rel.slice('concerns/'.length);
      }
      const key = rel.split(sep).join('/');
      // First write wins (autoloadRoots iterated in app/ order).
      if (!idx.has(key)) idx.set(key, f);
    }
  }
  return idx;
}

function lookupFqcn(fqcn: string, idx: Map<string, string>): string | null {
  const key = underscore(fqcn);
  return idx.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// AST walking
// ---------------------------------------------------------------------------

interface FoundRef {
  fqcn: string;
  line: number;
}

interface FoundRender {
  kind: 'view' | 'partial' | 'layout' | 'template';
  name: string;
  line: number;
}

function isDefinitionContext(node: N): boolean {
  // True if this constant node is a *definition* site, not a reference.
  // node.parent may be `class`, `module`, `superclass`, `assignment` LHS, etc.
  const p = node.parent;
  if (!p) return false;
  // class Foo … / module Foo … — the constant is the first named child
  if (p.type === 'class' || p.type === 'module') {
    if (p.namedChildren[0] === node) return true;
  }
  // superclass: `< Foo` — Foo is a *reference* actually (to the parent class).
  // We DO want to capture it. The existing extractor handles it as
  // extendsName, but we still emit it from here — graph.ts will dedup.
  // So do NOT mark superclass as definition.
  // Assignment LHS: `FOO = 1` — constant on LHS is a definition.
  if (p.type === 'assignment') {
    if (p.namedChildren[0] === node) return true;
  }
  // method param default — actually still a reference, leave it.
  return false;
}

function shouldSkipParent(node: N): boolean {
  // Skip refs inside contexts already handled elsewhere or that aren't real
  // references.
  // Walk up: if we're inside an `include`/`extend`/`prepend` call's arglist,
  // skip — already handled by existing extractor.
  // Likewise if we're the receiver/arg of has_many/belongs_to/etc. — those
  // take symbols, but defensive.
  let p = node.parent;
  while (p) {
    if (p.type === 'call' || p.type === 'command') {
      const mNode = p.type === 'call'
        ? p.childForFieldName?.('method')
        : p.namedChildren[0];
      const m = mNode?.text;
      if (m === 'include' || m === 'extend' || m === 'prepend') return true;
    }
    // Don't keep walking past statement boundaries — keep it local.
    if (p.type === 'body_statement' || p.type === 'program' || p.type === 'method' || p.type === 'class' || p.type === 'module') break;
    p = p.parent;
  }
  return false;
}

function collectRefs(root: N): FoundRef[] {
  const out: FoundRef[] = [];
  const seenByLine = new Set<string>();
  function visit(node: N): void {
    if (node.type === 'constant' || node.type === 'scope_resolution') {
      // For scope_resolution, recursing would re-collect each segment as
      // a `constant`. We want only the *outer* scope_resolution, not its
      // children. So when we hit a scope_resolution we emit and don't recurse.
      if (node.type === 'scope_resolution') {
        if (!isDefinitionContext(node) && !shouldSkipParent(node)) {
          const txt = node.text;
          const line = node.startPosition.row + 1;
          const key = `${txt}@${line}`;
          if (!seenByLine.has(key)) {
            seenByLine.add(key);
            out.push({ fqcn: txt, line });
          }
        }
        // do not recurse into children — avoids duplicating segments
        return;
      }
      // Bare `constant`
      if (!isDefinitionContext(node) && !shouldSkipParent(node)) {
        const txt = node.text;
        const line = node.startPosition.row + 1;
        const key = `${txt}@${line}`;
        if (!seenByLine.has(key)) {
          seenByLine.add(key);
          out.push({ fqcn: txt, line });
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(root);
  return out;
}

function collectRenders(root: N): FoundRender[] {
  const out: FoundRender[] = [];
  function visit(node: N): void {
    if (node.type === 'call' || node.type === 'command') {
      const mNode = node.type === 'call'
        ? node.childForFieldName?.('method')
        : node.namedChildren[0];
      if (mNode?.type === 'identifier' && mNode.text === 'render') {
        const line = node.startPosition.row + 1;
        // Args
        let argNodes: N[] = [];
        if (node.type === 'command') argNodes = node.namedChildren.slice(1);
        else {
          const args = node.namedChildren.find((c: N) => c.type === 'argument_list' || c.type === 'arguments');
          if (args) argNodes = args.namedChildren;
        }
        if (argNodes.length === 0) { for (const c of node.namedChildren) visit(c); return; }
        const first = argNodes[0];
        if (first.type === 'string' || first.type === 'string_literal') {
          const sc = first.namedChildren.find((c: N) => c.type === 'string_content');
          const txt = sc?.text ?? first.text.replace(/^['"]|['"]$/g, '');
          if (txt) out.push({ kind: 'view', name: txt, line });
        } else if (first.type === 'simple_symbol') {
          out.push({ kind: 'view', name: first.text.replace(/^:/, ''), line });
        } else {
          // hash form: render template: '...', partial: '...', layout: '...'
          const walkPairs = (n: N): void => {
            if (n.type === 'pair' && n.namedChildren.length >= 2) {
              const k = n.namedChildren[0];
              const v = n.namedChildren[1];
              const keyText = (k.type === 'hash_key_symbol' ? k.text : k.text.replace(/^:/, '')).replace(/:$/, '');
              if (['template', 'partial', 'layout'].includes(keyText)) {
                let vText: string | null = null;
                if (v.type === 'string' || v.type === 'string_literal') {
                  const sc = v.namedChildren.find((c: N) => c.type === 'string_content');
                  vText = sc?.text ?? v.text.replace(/^['"]|['"]$/g, '');
                } else if (v.type === 'simple_symbol') {
                  vText = v.text.replace(/^:/, '');
                }
                if (vText) {
                  const kind = keyText === 'template' ? 'template' : keyText === 'partial' ? 'partial' : 'layout';
                  out.push({ kind: kind as FoundRender['kind'], name: vText, line });
                }
              }
            }
            for (const c of n.namedChildren) walkPairs(c);
          };
          for (const a of argNodes) walkPairs(a);
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(root);
  return out;
}

// ---------------------------------------------------------------------------
// View resolution
// ---------------------------------------------------------------------------

const VIEW_EXTS = ['.html.erb', '.html.haml', '.html.slim', '.json.jbuilder',
  '.json.rabl', '.text.erb', '.xml.builder', '.rss.ruby'];

function controllerStem(file: string, appRoot: string): string | null {
  const rel = relative(join(appRoot, 'app', 'controllers'), file);
  if (rel.startsWith('..')) return null;
  return rel.replace(/_controller\.rb$/, '').split(sep).join('/');
}

function resolveView(target: FoundRender, fromFile: string, info: AppInfo): string | null {
  let basePath: string;
  let name = target.name;
  if (target.kind === 'layout') {
    basePath = join(info.appRoot, 'app', 'views', 'layouts', name);
  } else if (target.kind === 'template') {
    basePath = join(info.appRoot, 'app', 'views', name);
  } else {
    // 'view' (default render) or 'partial'
    let dir: string;
    let leaf: string;
    if (name.includes('/')) {
      dir = name.substring(0, name.lastIndexOf('/'));
      leaf = name.substring(name.lastIndexOf('/') + 1);
    } else {
      // Inside controller? Use its stem. Inside a view? Use the view's dir.
      const stem = controllerStem(fromFile, info.appRoot);
      if (stem) {
        dir = stem;
        leaf = name;
      } else {
        // For view files: use their own directory under app/views/
        const rel = relative(join(info.appRoot, 'app', 'views'), fromFile);
        dir = dirname(rel).split(sep).join('/');
        leaf = name;
      }
    }
    if (target.kind === 'partial') leaf = '_' + leaf;
    basePath = join(info.appRoot, 'app', 'views', dir, leaf);
  }
  for (const ext of VIEW_EXTS) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Edge {
  fromFile: string;
  toFile: string;
  reason: string;
  refLine: number;
}

function main(): void {
  const argRoot = process.argv[2];
  const appRoot = argRoot ?? join(homedir(), 'benchmark', 'repos', 'mastodon', 'mastodon-coldstart');
  if (!existsSync(join(appRoot, 'app'))) {
    console.error(`No app/ directory under ${appRoot}`);
    process.exit(1);
  }
  console.error(`# Scanning ${appRoot}`);
  const info = discoverApp(appRoot);
  console.error(`# Autoload roots: ${info.autoloadRoots.length}`);
  console.error(`# Ruby files:     ${info.rubyFiles.length}`);
  console.error(`# View files:     ${info.viewFiles.length}`);
  const fqcnIndex = buildFqcnIndex(info);
  console.error(`# FQCN index entries: ${fqcnIndex.size}`);

  const edges: Edge[] = [];
  const seen = new Set<string>(); // (fromRel|toRel|reason)
  let constRefs = 0;
  let constResolved = 0;
  let constStoplisted = 0;
  let renderRefs = 0;
  let renderResolved = 0;

  for (const file of info.rubyFiles) {
    let content: string;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    if (content.length > 500_000) continue; // skip absurd files
    let tree;
    try { tree = parser.parse(content); } catch { continue; }
    const root = tree.rootNode;
    const refs = collectRefs(root);
    constRefs += refs.length;

    for (const r of refs) {
      if (isStoplisted(r.fqcn, fqcnIndex)) { constStoplisted++; continue; }
      const target = lookupFqcn(r.fqcn, fqcnIndex);
      if (!target || target === file) continue;
      constResolved++;
      const fromRel = relative(appRoot, file);
      const toRel = relative(appRoot, target);
      const key = `${fromRel}|${toRel}|const:${r.fqcn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromFile: fromRel, toFile: toRel, reason: `constant '${r.fqcn}'`, refLine: r.line });
    }

    // Render only inside controllers/mailers/views
    const isController = file.includes(`${sep}controllers${sep}`);
    const isMailer = file.includes(`${sep}mailers${sep}`);
    if (isController || isMailer) {
      const renders = collectRenders(root);
      renderRefs += renders.length;
      for (const rd of renders) {
        const tgt = resolveView(rd, file, info);
        if (!tgt) continue;
        renderResolved++;
        const fromRel = relative(appRoot, file);
        const toRel = relative(appRoot, tgt);
        const key = `${fromRel}|${toRel}|render:${rd.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ fromFile: fromRel, toFile: toRel, reason: `render '${rd.name}' (${rd.kind})`, refLine: rd.line });
      }
    }
  }

  // Also scan view files for `render` calls
  for (const vfile of info.viewFiles) {
    if (!/\.(erb|haml|slim)$/.test(vfile) && !vfile.endsWith('.jbuilder')) continue;
    let content: string;
    try { content = readFileSync(vfile, 'utf-8'); } catch { continue; }
    // Extract just embedded ruby. For ERB-ish files, brute-grep render calls.
    // Keep it simple — regex over the raw file.
    const re = /render\s+(?:\(\s*)?(?:partial\s*:\s*['"]([^'"]+)['"]|template\s*:\s*['"]([^'"]+)['"]|layout\s*:\s*['"]([^'"]+)['"]|['"]([^'"]+)['"]|:([a-z_][a-zA-Z_0-9]*))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const partial = m[1];
      const template = m[2];
      const layout = m[3];
      const plain = m[4];
      const sym = m[5];
      let kind: FoundRender['kind'] = 'view';
      let name = '';
      if (partial) { kind = 'partial'; name = partial; }
      else if (template) { kind = 'template'; name = template; }
      else if (layout) { kind = 'layout'; name = layout; }
      else if (plain) { kind = 'partial'; name = plain; }  // bare string from view = partial
      else if (sym) { kind = 'partial'; name = sym; }
      else continue;
      const line = content.slice(0, m.index).split('\n').length;
      const tgt = resolveView({ kind, name, line }, vfile, info);
      if (!tgt) continue;
      renderResolved++;
      const fromRel = relative(appRoot, vfile);
      const toRel = relative(appRoot, tgt);
      const key = `${fromRel}|${toRel}|render:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromFile: fromRel, toFile: toRel, reason: `render '${name}' (${kind})`, refLine: line });
    }
  }

  // Sort: by fromFile, then refLine.
  edges.sort((a, b) => a.fromFile.localeCompare(b.fromFile) || a.refLine - b.refLine);

  console.error('');
  console.error(`# Total constant refs scanned:   ${constRefs}`);
  console.error(`# Constant refs stoplisted:      ${constStoplisted}`);
  console.error(`# Constant edges resolved:       ${constResolved}`);
  console.error(`# Render refs scanned:           ${renderRefs}`);
  console.error(`# Render edges resolved:         ${renderResolved}`);
  console.error(`# Unique edges emitted:          ${edges.length}`);
  console.error('');

  for (const e of edges) {
    console.log(`${e.fromFile}:${e.refLine} → ${e.toFile} [reason: ${e.reason}]`);
  }
}

main();
