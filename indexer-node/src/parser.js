/**
 * parser.js — File parser for TS/JS and GraphQL files.
 * Designed to run inside a worker thread (no side effects on import).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Domain keyword map (exact copy from Go)
// ---------------------------------------------------------------------------
const domainKeywords = {
  auth:               ['auth', 'login', 'logout', 'session', 'jwt', 'token', 'password', 'oauth', 'permission', 'role'],
  payments:           ['payment', 'billing', 'invoice', 'stripe', 'checkout', 'subscription', 'price'],
  db:                 ['database', 'db', 'query', 'migration', 'schema', 'model', 'repository', 'prisma', 'mongoose', 'sequelize', 'drizzle'],
  api:                ['route', 'router', 'controller', 'endpoint', 'handler', 'middleware', 'request', 'response'],
  ui:                 ['component', 'page', 'layout', 'view', 'render', 'hook', 'style', 'theme', 'modal', 'button'],
  utils:              ['util', 'helper', 'format', 'parse', 'validate', 'transform', 'convert', 'sanitize'],
  config:             ['config', 'env', 'setting', 'constant', 'option'],
  test:               ['test', 'spec', 'mock', 'fixture', 'factory', '__tests__'],
  types:              ['type', 'interface', 'dto', 'schema', 'contract'],
  queue:              ['queue', 'job', 'worker', 'task', 'scheduler', 'cron', 'bull', 'kafka'],
  cache:              ['cache', 'redis', 'memcache', 'store'],
  email:              ['email', 'mail', 'smtp', 'sendgrid', 'template', 'notification'],
  upload:             ['upload', 'file', 'storage', 's3', 'bucket', 'media'],
  search:             ['search', 'index', 'elastic', 'algolia', 'filter', 'query'],
  'graphql-operations': ['gql`', 'apolloclient', 'graphql-tag', '@apollo/client', 'apollo-client', '@apollo/react-hooks'],
  'graphql-schema':   ['typedefs', 'type_defs', 'buildschema', 'makeexecutableschema', 'apolloserver', 'graphqlschema'],
};

// ---------------------------------------------------------------------------
// Entry point names
// ---------------------------------------------------------------------------
const entryPointNames = new Set(['index', 'main', 'app', 'server', 'entry', 'start']);

// ---------------------------------------------------------------------------
// Lazy-loaded parsers via createRequire (CJS compat from ESM workers)
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

let _tsestree = null;
let _gqlParse = null;

function loadTSEstree() {
  if (_tsestree) return _tsestree;
  try {
    _tsestree = _require('@typescript-eslint/typescript-estree');
  } catch {
    _tsestree = null;
  }
  return _tsestree;
}

function loadGQLParse() {
  if (_gqlParse) return _gqlParse;
  try {
    const gql = _require('graphql');
    _gqlParse = gql.parse;
  } catch {
    _gqlParse = null;
  }
  return _gqlParse;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a single file (TS/JS or GraphQL) and return a node object.
 * @param {string} absPath
 * @param {string} relPath
 * @param {boolean} hasReact
 * @returns {object} node
 */
export function parseFile(absPath, relPath, hasReact) {
  const ext = extname(absPath).toLowerCase();
  if (ext === '.graphql' || ext === '.gql') {
    return parseGQLFile(absPath, relPath);
  }
  return parseTSFile(absPath, relPath, hasReact);
}

// ---------------------------------------------------------------------------
// TS/JS parsing
// ---------------------------------------------------------------------------

const TSPARSER_OPTIONS = {
  jsx: true,
  tolerant: true,
  range: false,
  loc: false,
  tokens: false,
  comment: false,
  errorOnUnknownASTType: false,
};

function parseTSFile(absPath, relPath, hasReact) {
  const content = readFileSync(absPath, 'utf8');
  const ext = extname(absPath).toLowerCase();
  const language = (ext === '.ts' || ext === '.tsx') ? 'typescript' : 'javascript';
  const hash = createHash('md5').update(content).digest('hex');
  const lineCount = content.split('\n').length;
  const tokenEstimate = Math.floor(content.length / 4);
  const isEntryPoint = checkIsEntryPoint(relPath);

  let imports = [];
  let exports = [];
  let hookNames = [];
  let jsxComponents = [];
  let propsTypes = [];
  let internalHooks = [];

  // Try AST-based extraction first; fall back to regex on parse error
  const tsestree = loadTSEstree();
  if (tsestree) {
    try {
      const ast = tsestree.parse(content, TSPARSER_OPTIONS);
      imports = extractImportsAST(ast);
      exports = extractExportsAST(ast);
      if (hasReact) {
        hookNames = extractHooksAST(ast, exports);
        jsxComponents = extractJSXComponentsAST(ast);
        propsTypes = extractPropsTypeAST(ast);
        internalHooks = extractInternalHooksAST(ast, hookNames);
      }
    } catch {
      // Fall back to regex extraction
      imports = extractImportsRegex(content);
      exports = extractExportsRegex(content);
      if (hasReact) {
        hookNames = extractHooksRegex(content, exports);
      }
    }
  } else {
    imports = extractImportsRegex(content);
    exports = extractExportsRegex(content);
    if (hasReact) {
      hookNames = extractHooksRegex(content, exports);
    }
  }

  const domain = inferDomain(relPath, content);
  const architectural_role = inferRole(relPath, exports);

  const node = {
    id: relPath,
    language,
    exports,
    imports,
    domain,
    is_entry_point: isEntryPoint,
    line_count: lineCount,
    token_estimate: tokenEstimate,
    hash,
    hook_names: hookNames.length > 0 ? hookNames : undefined,
    jsx_components: jsxComponents.length > 0 ? jsxComponents : undefined,
    props_types: propsTypes.length > 0 ? propsTypes : undefined,
    internal_hooks: internalHooks.length > 0 ? internalHooks : undefined,
    architectural_role: architectural_role ?? undefined,
    gql: null,
  };

  // Apollo meta
  const apolloAnnotations = extractApolloMeta(content);
  node.summary = buildSummary(node);
  if (apolloAnnotations.length > 0) {
    node.summary += ' ' + apolloAnnotations.join('. ') + '.';
  }

  return node;
}

// ── AST-based extractors ──────────────────────────────────────────────────

function extractImportsAST(ast) {
  const seen = new Set();
  const imports = [];

  function add(spec) {
    if (spec && !seen.has(spec)) {
      seen.add(spec);
      imports.push(spec);
    }
  }

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'ImportDeclaration') {
      add(node.source?.value);
    } else if (node.type === 'ExportNamedDeclaration' && node.source?.value) {
      add(node.source.value);
    } else if (node.type === 'ExportAllDeclaration' && node.source?.value) {
      add(node.source.value);
    } else if (node.type === 'CallExpression') {
      const callee = node.callee;
      // require('...')
      if (callee?.type === 'Identifier' && callee.name === 'require') {
        const arg = node.arguments?.[0];
        if (arg?.type === 'Literal') add(arg.value);
      }
      // import('...')
      if (node.type === 'CallExpression' && callee?.type === 'Import') {
        const arg = node.arguments?.[0];
        if (arg?.type === 'Literal') add(arg.value);
      }
    } else if (node.type === 'ImportExpression') {
      // dynamic import() — some parsers use ImportExpression
      const src = node.source;
      if (src?.type === 'Literal') add(src.value);
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && c.type) visit(c);
        }
      } else if (child && typeof child === 'object' && child.type) {
        visit(child);
      }
    }
  }

  visit(ast);
  return imports;
}

function extractExportsAST(ast) {
  const seen = new Set();
  const exports = [];

  function add(name) {
    name = (name || '').trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      exports.push(name);
    }
  }

  for (const node of (ast.body ?? [])) {
    if (node.type === 'ExportNamedDeclaration') {
      // export function/class/const/let/var Foo
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.id?.name) {
          add(decl.id.name);
        } else if (decl.declarations) {
          for (const d of decl.declarations) {
            if (d.id?.name) add(d.id.name);
          }
        }
      }
      // export { foo, bar as baz }
      for (const spec of (node.specifiers ?? [])) {
        if (spec.exported?.name) add(spec.exported.name);
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      const name = decl?.id?.name || decl?.name;
      if (name) add(`default:${name}`);
    } else if (node.type === 'ExportAllDeclaration') {
      // export * from '...' — no named symbols to record
    }
  }

  return exports;
}

function extractHooksAST(ast, exportedNames) {
  const seen = new Set();
  const hooks = [];

  function add(name) {
    name = (name || '').trim();
    if (name && /^use[A-Z]/.test(name) && !seen.has(name)) {
      seen.add(name);
      hooks.push(name);
    }
  }

  // From already-extracted exports
  for (const exp of exportedNames) {
    add(exp);
  }

  return hooks.filter(h => /^use[A-Z]/.test(h));
}

/**
 * Extract JSX component names rendered in this file (PascalCase elements only).
 * e.g. <ActionMenu>, <MemberList> → ['ActionMenu', 'MemberList']
 */
function extractJSXComponentsAST(ast) {
  const seen = new Set();
  const components = [];

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    if (
      (node.type === 'JSXOpeningElement' || node.type === 'JSXIdentifier') &&
      node.type === 'JSXOpeningElement'
    ) {
      const name = node.name;
      // Direct: <ActionMenu>
      if (name?.type === 'JSXIdentifier' && /^[A-Z]/.test(name.name)) {
        if (!seen.has(name.name)) { seen.add(name.name); components.push(name.name); }
      }
      // Member: <Icons.ActionMenu> — take the last part
      if (name?.type === 'JSXMemberExpression') {
        const prop = name.property?.name;
        if (prop && /^[A-Z]/.test(prop) && !seen.has(prop)) {
          seen.add(prop); components.push(prop);
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) { if (c && typeof c === 'object' && c.type) visit(c); }
      } else if (child && typeof child === 'object' && child.type) {
        visit(child);
      }
    }
  }

  visit(ast);
  return components;
}

/**
 * Extract the props type/interface name for the primary exported component.
 * Looks for: function Foo(props: FooProps), const Foo: React.FC<FooProps>, etc.
 */
function extractPropsTypeAST(ast) {
  const seen = new Set();
  const propsTypes = [];

  function add(name) {
    if (name && /Props$|Props[A-Z]/.test(name) && !seen.has(name)) {
      seen.add(name);
      propsTypes.push(name);
    }
  }

  function visitTypeAnnotation(typeNode) {
    if (!typeNode) return;
    // TSTypeReference: FooProps
    if (typeNode.type === 'TSTypeReference') {
      const name = typeNode.typeName?.name || typeNode.typeName?.right?.name;
      add(name);
    }
    // TSGenericType / generic params: React.FC<FooProps>
    if (typeNode.typeParameters?.params) {
      for (const p of typeNode.typeParameters.params) visitTypeAnnotation(p);
    }
  }

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    // function Foo({ ... }: FooProps)
    if (node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
      const firstParam = node.params?.[0];
      if (firstParam?.typeAnnotation?.typeAnnotation) {
        visitTypeAnnotation(firstParam.typeAnnotation.typeAnnotation);
      }
    }

    // const Foo: React.FC<FooProps> = ...
    if (node.type === 'VariableDeclarator' && node.id?.typeAnnotation?.typeAnnotation) {
      visitTypeAnnotation(node.id.typeAnnotation.typeAnnotation);
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) { if (c && typeof c === 'object' && c.type) visit(c); }
      } else if (child && typeof child === 'object' && child.type) {
        visit(child);
      }
    }
  }

  visit(ast);
  return propsTypes;
}

/**
 * Extract internally-called hooks (use* calls that are not exports).
 * e.g. useMembers(), usePermissions() called inside the component body.
 */
function extractInternalHooksAST(ast, exportedHooks) {
  const exportedSet = new Set(exportedHooks);
  const seen = new Set();
  const hooks = [];

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      /^use[A-Z]/.test(node.callee.name) &&
      !exportedSet.has(node.callee.name) &&
      !seen.has(node.callee.name)
    ) {
      seen.add(node.callee.name);
      hooks.push(node.callee.name);
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) { if (c && typeof c === 'object' && c.type) visit(c); }
      } else if (child && typeof child === 'object' && child.type) {
        visit(child);
      }
    }
  }

  visit(ast);
  return hooks;
}

// ── Regex fallback extractors (mirrors Go implementation) ─────────────────

const reImportFrom    = /^import\s+(?:type\s+)?(?:[^'"]+)\s+from\s+['"]([^'"]+)['"]/mg;
const reImportDynamic = /import\(['"]([^'"]+)['"]\)/g;
const reRequire       = /require\(['"]([^'"]+)['"]\)/g;
const reExportNamed   = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/mg;
const reExportBraces  = /^export\s+\{([^}]+)\}/mg;
const reExportDefault = /^export\s+default\s+(\w+)/mg;
const reHookExport    = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+(use[A-Z]\w*)/mg;

function extractImportsRegex(content) {
  const seen = new Set();
  const imports = [];
  function add(spec) {
    if (spec && !seen.has(spec)) { seen.add(spec); imports.push(spec); }
  }
  for (const [, spec] of content.matchAll(reImportFrom))    add(spec);
  for (const [, spec] of content.matchAll(reImportDynamic)) add(spec);
  for (const [, spec] of content.matchAll(reRequire))       add(spec);
  return imports;
}

function extractExportsRegex(content) {
  const seen = new Set();
  const exports = [];
  function add(name) {
    name = (name || '').trim();
    if (name && !seen.has(name)) { seen.add(name); exports.push(name); }
  }
  for (const [, name] of content.matchAll(reExportNamed)) add(name);
  for (const [, group] of content.matchAll(reExportBraces)) {
    for (const sym of group.split(',')) {
      const parts = sym.trim().split(/\s+/);
      if (parts.length === 3 && parts[1] === 'as') add(parts[2]);
      else if (parts.length === 1) add(parts[0]);
    }
  }
  for (const [, name] of content.matchAll(reExportDefault)) add(`default:${name}`);
  return exports;
}

function extractHooksRegex(content, exportedNames) {
  const seen = new Set();
  const hooks = [];
  function add(name) {
    name = (name || '').trim();
    if (name && /^use[A-Z]/.test(name) && !seen.has(name)) { seen.add(name); hooks.push(name); }
  }
  for (const [, name] of content.matchAll(reHookExport)) add(name);
  for (const [, group] of content.matchAll(reExportBraces)) {
    for (const sym of group.split(',')) {
      const parts = sym.trim().split(/\s+/);
      let name;
      if (parts.length === 3 && parts[1] === 'as') name = parts[2];
      else if (parts.length === 1) name = parts[0];
      if (name && name.length > 3 && /^use[A-Z]/.test(name)) add(name);
    }
  }
  return hooks;
}

// ── Apollo meta extraction ────────────────────────────────────────────────

const reGQLTaggedConst = /const\s+(\w+)\s*=\s*gql\s*`/g;
const reApolloHook     = /(useQuery|useMutation|useSubscription|useLazyQuery)\s*[<(]/g;
const reApolloClient   = /new\s+ApolloClient\s*\(/;
const reApolloImport   = /from\s+['"](?:@apollo\/client|apollo-client|@apollo\/react-hooks)['"]/;
const reTanstackImport = /from\s+['"](?:@tanstack\/react-query|react-query)['"]/;

function extractApolloMeta(content) {
  const annotations = [];

  const gqlMatches = [...content.matchAll(reGQLTaggedConst)].map(m => m[1]);
  if (gqlMatches.length > 0) {
    annotations.push(`gql-tags: ${gqlMatches.join(', ')}`);
  }

  const isApolloFile  = reApolloImport.test(content);
  const isTanstackFile = reTanstackImport.test(content);
  if (isApolloFile && !isTanstackFile) {
    const seen = new Set();
    const hookNames = [];
    for (const [, name] of content.matchAll(reApolloHook)) {
      if (!seen.has(name)) { seen.add(name); hookNames.push(name); }
    }
    if (hookNames.length > 0) {
      annotations.push(`apollo-hooks: ${hookNames.join(', ')}`);
    }
  }

  if (reApolloClient.test(content)) {
    annotations.push('apollo-client-setup');
  }

  return annotations;
}

// ── Architectural role inference ──────────────────────────────────────────
//
// Convention-based, framework-agnostic. Targets the directory and file-naming
// patterns that hold across Express, Fastify, NestJS, Hapi, Next.js, Nuxt,
// Koa, and every framework that follows the same developer conventions.
// Returns null rather than guessing when no signal is present.

const ROLE_DIR_PATTERNS = [
  [/\/(routes?|controllers?|handlers?|endpoints?)\//i, 'router'],
  [/\/api\//i,                                          'router'],
  [/\/pages\//i,                                        'router'], // Next.js pages router
  [/\/services?\//i,                                    'service'],
  [/\/(repositories?|repos?|dao|stores?)\//i,           'repository'],
  [/\/models?\//i,                                      'repository'],
  [/\/(middleware|interceptors?|guards?|filters?)\//i,  'middleware'],
];

const ROLE_FILE_PATTERNS = [
  [/\.(route|router|controller|handler|endpoint)\.[jt]sx?$/i, 'router'],
  [/\.service\.[jt]sx?$/i,                                    'service'],
  [/\.(repository|repo|model|dao)\.[jt]sx?$/i,                'repository'],
  [/\.(middleware|interceptor|guard|filter)\.[jt]sx?$/i,      'middleware'],
];

// Next.js App Router file conventions — only these specific names are routes
const NEXTJS_APP_ROUTER_RE = /\/app\/.*\/(page|layout|route|loading|error|not-found)\.[jt]sx?$/i;

/**
 * Infer the architectural role of a file from its path and export names.
 * Returns one of 'router' | 'service' | 'repository' | 'middleware' | null.
 */
function inferRole(relPath, exports) {
  const slashed = '/' + relPath; // prepend so patterns like /routes/ match root-level dirs too

  // Next.js App Router special case (more precise than the generic /app/ dir)
  if (NEXTJS_APP_ROUTER_RE.test(slashed)) return 'router';

  // Directory conventions (strongest signal)
  for (const [re, role] of ROLE_DIR_PATTERNS) {
    if (re.test(slashed)) return role;
  }

  // File suffix conventions
  for (const [re, role] of ROLE_FILE_PATTERNS) {
    if (re.test(relPath)) return role;
  }

  // Export naming: HTTP verb prefix = likely a route handler
  if (exports.some(e => /^(get|post|put|patch|delete|head|handle|process)[A-Z]/.test(e))) {
    return 'router';
  }

  return null;
}

// ── Domain inference ──────────────────────────────────────────────────────

function inferDomain(relPath, content) {
  const combined = (relPath + ' ' + content.slice(0, 2000)).toLowerCase();

  let bestDomain = '';
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestScore === 0 ? 'misc' : bestDomain;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function checkIsEntryPoint(relPath) {
  const base = basename(relPath);
  const noExt = base.replace(/\.[^.]+$/, '').toLowerCase();
  return entryPointNames.has(noExt);
}

function buildSummary(node) {
  const parts = [];

  if (node.is_entry_point) parts.push('Entry point.');

  if (node.exports && node.exports.length > 0) {
    const shown = node.exports.slice(0, 5);
    parts.push(`Exports: ${shown.join(', ')}.`);
  }

  if (node.props_types && node.props_types.length > 0) {
    parts.push(`Props: ${node.props_types.join(', ')}.`);
  }

  if (node.jsx_components && node.jsx_components.length > 0) {
    const shown = node.jsx_components.slice(0, 8);
    parts.push(`Renders: ${shown.join(', ')}.`);
  }

  if (node.internal_hooks && node.internal_hooks.length > 0) {
    const shown = node.internal_hooks.slice(0, 5);
    parts.push(`Uses: ${shown.join(', ')}.`);
  }

  if (node.hook_names && node.hook_names.length > 0) {
    parts.push(`Hooks: ${node.hook_names.join(', ')}.`);
  }

  if (node.imports && node.imports.length > 0) {
    parts.push(`${node.imports.length} import(s).`);
  }

  parts.push(`Domain: ${node.domain}.`);
  parts.push(`~${node.token_estimate} tokens.`);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// GraphQL parsing
// ---------------------------------------------------------------------------

function parseGQLFile(absPath, relPath) {
  const rawBytes = readFileSync(absPath);
  const content = rawBytes.toString('utf8');
  const hash = createHash('md5').update(rawBytes).digest('hex');
  const lineCount = content.split('\n').length;
  const tokenEstimate = Math.floor(content.length / 4);

  const stripped = stripGQLComments(content);
  const meta = extractGQLMetaRegex(stripped);
  const imports = extractGQLImports(content);

  const node = {
    id: relPath,
    language: 'graphql',
    exports: buildGQLExports(meta),
    imports,
    domain: inferGQLDomain(relPath, meta),
    is_entry_point: false,
    line_count: lineCount,
    token_estimate: tokenEstimate,
    hash,
    gql: meta,
  };

  node.summary = buildGQLSummary(node);
  return node;
}

// GraphQL regex patterns (mirrors Go)
const reGQLType        = /^type\s+(\w+)(?:\s+implements\s+[\w&\s]+)?\s*\{/mg;
const reGQLInput       = /^input\s+(\w+)\s*\{/mg;
const reGQLInterface   = /^interface\s+(\w+)\s*\{/mg;
const reGQLEnum        = /^enum\s+(\w+)\s*\{/mg;
const reGQLUnion       = /^union\s+(\w+)\s*=/mg;
const reGQLQuery       = /^query\s+(\w+)/mg;
const reGQLMutation    = /^mutation\s+(\w+)/mg;
const reGQLSubscription = /^subscription\s+(\w+)/mg;
const reGQLFragment    = /^fragment\s+(\w+)\s+on\s+\w+/mg;
const reGQLExtend      = /^extend\s+type\s+(\w+)/mg;
const reGQLImportRe    = /^#\s*import\s+['"]([^'"]+)['"]/mg;
const reGQLSchemaBlock = /^schema\s*\{/m;

const rootTypes = new Set(['Query', 'Mutation', 'Subscription']);

function extractGQLMetaRegex(content) {
  const meta = {
    types_defined:  [],
    queries:        [],
    mutations:      [],
    subscriptions:  [],
    fragments:      [],
    inputs:         [],
    enums:          [],
    interfaces:     [],
    unions:         [],
    is_schema:      false,
  };

  for (const [, name] of content.matchAll(reGQLType)) {
    if (rootTypes.has(name)) {
      meta.is_schema = true;
    } else {
      meta.types_defined.push(name);
    }
  }

  if (reGQLSchemaBlock.test(content)) meta.is_schema = true;

  for (const [, name] of content.matchAll(reGQLExtend))       meta.types_defined.push(`extend:${name}`);
  for (const [, name] of content.matchAll(reGQLInput))        meta.inputs.push(name);
  for (const [, name] of content.matchAll(reGQLInterface))    meta.interfaces.push(name);
  for (const [, name] of content.matchAll(reGQLEnum))         meta.enums.push(name);
  for (const [, name] of content.matchAll(reGQLUnion))        meta.unions.push(name);
  for (const [, name] of content.matchAll(reGQLQuery))        meta.queries.push(name);
  for (const [, name] of content.matchAll(reGQLMutation))     meta.mutations.push(name);
  for (const [, name] of content.matchAll(reGQLSubscription)) meta.subscriptions.push(name);
  for (const [, name] of content.matchAll(reGQLFragment))     meta.fragments.push(name);

  return meta;
}

function extractGQLImports(content) {
  const seen = new Set();
  const imports = [];
  for (const [, spec] of content.matchAll(reGQLImportRe)) {
    if (!seen.has(spec)) { seen.add(spec); imports.push(spec); }
  }
  return imports;
}

function buildGQLExports(meta) {
  const exports = [];
  for (const t of meta.types_defined)  exports.push(`type:${t}`);
  for (const q of meta.queries)        exports.push(`query:${q}`);
  for (const m of meta.mutations)      exports.push(`mutation:${m}`);
  for (const s of meta.subscriptions)  exports.push(`subscription:${s}`);
  for (const f of meta.fragments)      exports.push(`fragment:${f}`);
  for (const i of meta.inputs)         exports.push(`input:${i}`);
  for (const e of meta.enums)          exports.push(`enum:${e}`);
  for (const i of meta.interfaces)     exports.push(`interface:${i}`);
  for (const u of meta.unions)         exports.push(`union:${u}`);
  return exports;
}

function inferGQLDomain(relPath, meta) {
  if (meta.is_schema) return 'graphql-schema';
  if (meta.queries.length > 0 || meta.mutations.length > 0 || meta.subscriptions.length > 0) return 'graphql-operations';
  if (meta.fragments.length > 0) return 'graphql-fragments';

  const lower = relPath.toLowerCase();
  if (lower.includes('auth'))    return 'auth';
  if (lower.includes('user'))    return 'graphql-schema';
  if (lower.includes('payment')) return 'payments';
  return 'graphql-schema';
}

function buildGQLSummary(node) {
  const m = node.gql;
  if (!m) return `GraphQL file. ~${node.token_estimate} tokens.`;

  const parts = [];
  if (m.is_schema)          parts.push('Schema file.');
  if (m.types_defined.length > 0) {
    const shown = m.types_defined.slice(0, 4);
    parts.push(`Types: ${shown.join(', ')}.`);
  }
  if (m.queries.length > 0)       parts.push(`Queries: ${m.queries.join(', ')}.`);
  if (m.mutations.length > 0)     parts.push(`Mutations: ${m.mutations.join(', ')}.`);
  if (m.subscriptions.length > 0) parts.push(`Subscriptions: ${m.subscriptions.join(', ')}.`);
  if (m.fragments.length > 0)     parts.push(`Fragments: ${m.fragments.join(', ')}.`);
  if (m.inputs.length > 0)        parts.push(`Inputs: ${m.inputs.join(', ')}.`);
  if (m.enums.length > 0)         parts.push(`Enums: ${m.enums.join(', ')}.`);
  if (node.imports.length > 0)    parts.push(`${node.imports.length} import(s).`);
  parts.push(`~${node.token_estimate} tokens.`);

  return parts.join(' ');
}

function stripGQLComments(content) {
  return content
    .split('\n')
    .map(line => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#') && !trimmed.startsWith('#import')) return '';
      return line;
    })
    .join('\n');
}
