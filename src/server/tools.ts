import type { CodebaseIndex, IndexedFile } from '../types.js';
import { tokenizeName } from '../indexer/tokenize.js';
import { IDF_RARITY_THRESHOLD } from '../constants.js';

// Query tokens that signal the user is working on test/automation code
const TEST_QUERY_KEYWORDS = new Set([
  'test', 'spec', 'mock', 'fixture', 'stub', 'e2e', 'locator', 'automation',
  'pageobject', 'cypress', 'playwright', 'selenium',
]);

/**
 * Parse a domain_filter string into concept groups.
 * - [auth|login|jwt] → one group with synonyms (OR logic)
 * - bare single token → one group (AND logic across groups)
 * - bare PascalCase/camelCase like "GroupHubActionMenu" → one group per split token
 *   (AND across groups, so files matching more tokens rank higher via matchedGroupCount)
 *   The compound form is added as OR alternative to the first group so compound-indexed
 *   files still match.
 */
export function parseConceptGroups(input: string): string[][] {
  const groups: string[][] = [];
  const segmentRe = /\[([^\]]+)\]|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = segmentRe.exec(input)) !== null) {
    if (match[1] !== undefined) {
      // Bracket group: split by | and tokenize each synonym — stays as one OR group
      const synonyms = match[1].split('|').flatMap(s => tokenizeName(s.trim())).filter(Boolean);
      if (synonyms.length > 0) groups.push(synonyms);
    } else if (match[2] !== undefined) {
      // Bare segment: split into individual tokens (PascalCase/camelCase → parts).
      // Each token becomes its own AND group so matchedGroupCount reflects how many
      // parts of the name the file actually contains.
      const tokens = tokenizeName(match[2]);
      const compound = match[2].toLowerCase();
      if (tokens.length <= 1) {
        // Single token (or empty after stop-word filter): one group with compound fallback
        const all = [...new Set([...tokens, compound])].filter(Boolean);
        if (all.length > 0) groups.push(all);
      } else {
        // Multi-token: one group per token; compound added as OR to first group so
        // a file indexed under the full compound name still satisfies the entire query
        groups.push([...new Set([tokens[0], compound])]);
        for (let i = 1; i < tokens.length; i++) {
          groups.push([tokens[i]]);
        }
      }
    }
  }
  return groups;
}

/**
 * Expand a query token with additive plural/singular forms (same rules as index time).
 * Returns the token plus any additional forms.
 */
const SYNONYM_MAP: Record<string, string[]> = {
  create: ['add', 'new', 'build', 'make', 'generate', 'insert', 'init', 'construct', 'creation'],
  update: ['edit', 'modify', 'change', 'patch', 'set', 'save', 'alter', 'refresh'],
  delete: ['remove', 'destroy', 'clear', 'drop', 'purge', 'archive', 'erase', 'deletion'],
  read: ['get', 'fetch', 'retrieve', 'load', 'obtain', 'access', 'query'],
  write: ['save', 'store', 'persist', 'commit', 'put'],
  find: ['search', 'locate', 'query', 'lookup', 'filter'],
  list: ['show', 'display', 'enumerate', 'browse'],
  check: ['validate', 'verify', 'assert', 'inspect'],
  handle: ['process', 'manage', 'execute', 'run'],
  call: ['invoke', 'execute', 'trigger', 'dispatch'],
  emit: ['fire', 'trigger', 'dispatch', 'broadcast', 'send'],
  bind: ['attach', 'connect', 'link', 'hook', 'register'],
  render: ['draw', 'display', 'paint', 'show'],
  parse: ['interpret', 'decode', 'extract', 'process'],
  validate: ['check', 'verify', 'assert', 'confirm'],
  authenticate: ['login', 'auth', 'verify', 'sign'],
  authorize: ['permit', 'grant', 'allow', 'check'],
  sort: ['order', 'arrange', 'rank'],
  filter: ['select', 'query', 'reduce', 'narrow'],
  merge: ['combine', 'join', 'consolidate'],
  clone: ['copy', 'duplicate', 'replicate'],
  deploy: ['publish', 'release', 'ship', 'push'],
  build: ['compile', 'bundle', 'assemble', 'construct'],
  configure: ['setup', 'init', 'customize'],
  register: ['add', 'enroll', 'record'],
  submit: ['send', 'post', 'save', 'confirm'],
  upload: ['import', 'attach', 'send'],
  download: ['export', 'fetch', 'pull'],
  open: ['show', 'display', 'expand', 'launch'],
  close: ['hide', 'dismiss', 'collapse', 'destroy'],
  toggle: ['switch', 'flip', 'change'],
  reset: ['clear', 'init', 'restore', 'default'],
  refresh: ['reload', 'update', 'sync'],
  sync: ['refresh', 'update', 'pull', 'push'],
  auth: ['authentication', 'login', 'verify', 'security', 'session'],
  user: ['account', 'profile', 'member', 'person'],
  admin: ['manager', 'moderator', 'operator', 'superuser'],
  config: ['configuration', 'settings', 'options', 'preferences'],
  settings: ['config', 'configuration', 'options', 'preferences'],
  state: ['data', 'status', 'store', 'store'],
  context: ['scope', 'provider', 'wrapper'],
  service: ['handler', 'provider', 'manager', 'helper'],
  helper: ['util', 'utility', 'service', 'manager'],
  util: ['helper', 'utility', 'service'],
  error: ['exception', 'failure', 'fault'],
  event: ['signal', 'trigger', 'action'],
  request: ['query', 'call', 'message'],
  response: ['reply', 'result', 'return'],
  payload: ['data', 'body', 'content'],
  schema: ['type', 'structure', 'definition', 'model'],
  model: ['schema', 'entity', 'type', 'record'],
  modal: ['dialog', 'popup', 'overlay'],
  form: ['input', 'panel', 'dialog'],
  table: ['grid', 'list', 'rows'],
  card: ['container', 'panel', 'widget'],
  button: ['action', 'control', 'trigger'],
  menu: ['nav', 'navigation', 'dropdown'],
  notification: ['alert', 'toast', 'message', 'warning'],
  permission: ['role', 'access', 'policy', 'grant', 'privilege'],
  role: ['permission', 'access', 'policy'],
  policy: ['rule', 'permission', 'access', 'guard'],
  guard: ['check', 'middleware', 'policy', 'protect'],
  route: ['path', 'endpoint', 'url', 'page'],
  endpoint: ['route', 'path', 'url', 'api'],
  hook: ['handler', 'callback', 'listener', 'middleware'],
  middleware: ['handler', 'interceptor', 'wrapper', 'guard'],
  cache: ['store', 'memory', 'buffer'],
  queue: ['buffer', 'list', 'stream'],
  log: ['record', 'track', 'audit', 'write'],
  metric: ['stat', 'measure', 'counter', 'gauge'],
  report: ['summary', 'export', 'analytics'],
  dashboard: ['overview', 'summary', 'home'],
  feed: ['stream', 'list', 'timeline'],
  post: ['message', 'conversation', 'content', 'entry', 'article'],
  message: ['post', 'conversation', 'chat', 'thread', 'inbox'],
  conversation: ['message', 'chat', 'thread', 'pm', 'private', 'post'],
  board: ['forum', 'channel', 'topic'],
  forum: ['board', 'channel', 'community'],
  group: ['role', 'membership', 'team', 'community'],
  private: ['direct', 'dm', 'personal', 'conversation'],
  comment: ['reply', 'message', 'note'],
  tag: ['label', 'badge', 'category'],
  badge: ['label', 'tag', 'icon', 'indicator'],
  category: ['type', 'tag', 'label'],
  search: ['find', 'query', 'filter', 'lookup'],
  import: ['load', 'upload', 'ingest', 'parse'],
  export: ['download', 'save', 'output', 'generate'],
};

function expandQueryToken(token: string): string[] {
  const forms = new Set<string>([token]);

  // Plural/singular expansion
  if (token.length >= 5) {
    if (token.endsWith('es') && token.length > 4) {
      const singular = token.slice(0, -2);
      if (singular.length >= 4) forms.add(singular);
    } else if (token.endsWith('s')) {
      const singular = token.slice(0, -1);
      if (singular.length >= 4) forms.add(singular);
    } else {
      forms.add(token + 's');
      forms.add(token + 'es');
    }
  }

  // Synonym expansion
  const synonyms = SYNONYM_MAP[token];
  if (synonyms) {
    for (const syn of synonyms) forms.add(syn);
  }
  // Also check if this token is a synonym of something, expand to that canonical + its synonyms
  for (const [canonical, syns] of Object.entries(SYNONYM_MAP)) {
    if (syns.includes(token)) {
      forms.add(canonical);
      for (const s of syns) forms.add(s);
      break;
    }
  }

  return [...forms];
}

// ============================================================================
// get-overview
// ============================================================================

export type MatchResult = {
  path: string;
  matchedGroupCount: number;
  totalConvergence: number;
  concentration: number;
  score: number;
  idfScore: number;
  allMatchedTokens: Set<string>;
  // Tiebreaker signals
  compoundLength: number;    // longest filename token length (shorter = more precise)
};

/**
 * Match a file against concept groups. Returns null if no group matched.
 * Computes convergence, concentration, and IDF score per the ranking plan.
 */
export function matchFile(
  file: IndexedFile,
  conceptGroups: string[][],
  index: CodebaseIndex,
  totalQueryGroups: number,
): MatchResult | null {
  const totalFiles = index.files.size;
  let matchedGroupCount = 0;
  let totalConvergence = 0;
  let idfScore = 0;
  const allMatchedTokens = new Set<string>();

  for (const group of conceptGroups) {
    const groupMatchedTokens = new Set<string>();

    for (const queryToken of group) {
      const expanded = expandQueryToken(queryToken);
      for (const qt of expanded) {
        // Exact match
        if (file.domainMap[qt] !== undefined) {
          groupMatchedTokens.add(qt);
        }
        // Substring match: indexed token contains query token.
        // Restricted to tokens with path or filename evidence — symbol-only compound
        // tokens (e.g. "canadminbadges" from a policy helper) inflate matchedGroupCount
        // across unrelated queries without being meaningful navigation signals.
        for (const indexedToken of Object.keys(file.domainMap)) {
          const entry = file.domainMap[indexedToken];
          if (entry.filename === 0 && entry.path === 0) continue;
          if (
            indexedToken.length > 6 &&
            indexedToken.length > qt.length &&
            indexedToken.includes(qt)
          ) {
            groupMatchedTokens.add(indexedToken);
          }
        }
      }
    }

    if (groupMatchedTokens.size > 0) {
      matchedGroupCount++;
      const accumulated = { filename: 0, path: 0, symbol: 0 };
      let groupBestIdf = 0;

      for (const token of groupMatchedTokens) {
        const entry = file.domainMap[token];
        accumulated.filename += entry.filename;
        accumulated.path     += entry.path;
        accumulated.symbol   += entry.symbol;
        allMatchedTokens.add(token);

        const docFreq = index.tokenDocFreq.get(token) ?? 1;
        const idf = Math.log(totalFiles / docFreq);
        if (idf > groupBestIdf) groupBestIdf = idf;
      }

      const groupConvergence =
        (accumulated.filename > 0 ? 1 : 0) +
        (accumulated.path     > 0 ? 1 : 0) +
        (accumulated.symbol   > 0 ? 1 : 0);

      totalConvergence += groupConvergence;
      idfScore         += groupBestIdf;
    }
  }

  if (matchedGroupCount === 0) return null;

  const domainSize = Object.keys(file.domainMap).length;
  const concentration = domainSize > 0 ? allMatchedTokens.size / domainSize : 0;
  const score = totalQueryGroups > 0 ? totalConvergence / (totalQueryGroups * 3) : 0;

  // Signal 1: longest filename-backed token length (shorter = more precise match)
  let compoundLength = 0;
  for (const token of Object.keys(file.domainMap)) {
    const entry = file.domainMap[token];
    if (entry.filename > 0 && token.length > compoundLength) {
      compoundLength = token.length;
    }
  }

  return {
    path: file.relativePath,
    matchedGroupCount,
    totalConvergence,
    concentration,
    score,
    idfScore,
    allMatchedTokens,
    compoundLength,
  };
}

function compareMatches(a: MatchResult, b: MatchResult, totalGroups: number): number {
  // Tier 0: files matching ALL query concept groups rank above files missing any group.
  // This prevents a file with 1-group full convergence (score=0.50) beating a file that
  // covers all 2 groups shallowly (score=0.33). Does NOT apply when no file can cover
  // all groups (vocab mismatch) — in that case both fall to the same tier and compete
  // on score as normal.
  const aFull = a.matchedGroupCount === totalGroups;
  const bFull = b.matchedGroupCount === totalGroups;
  if (aFull !== bFull) return aFull ? -1 : 1;

  // Primary: normalized score = totalConvergence / (totalQueryGroups × 3)
  // This is a 0→1 signal: fraction of perfect evidence achieved across all query groups
  const scoreDiff = b.score - a.score;
  if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

  if (a.idfScore !== b.idfScore)
    return b.idfScore - a.idfScore;

  if (a.allMatchedTokens.size !== b.allMatchedTokens.size)
    return b.allMatchedTokens.size - a.allMatchedTokens.size;

  // Tiebreaker: prefer files with shorter compound filename tokens (more focused/specific)
  const clenDiff = a.compoundLength - b.compoundLength;
  if (Math.abs(clenDiff) >= 3)
    return clenDiff;

  // Final tiebreaker: concentration (matched tokens / domain vocabulary size)
  // Only kicks in for true ties where all signals above are equal.
  const concDiff = b.concentration - a.concentration;
  if (Math.abs(concDiff) > 1e-9) return concDiff;

  return 0;
}

export function handleGetOverview(
  index: CodebaseIndex,
  params: {
    domain_filter?: string;
    max_results?: number;
    include_tests?: boolean;
  },
): object {
  const { domain_filter, max_results = 10, include_tests = false } = params;

  if (!domain_filter) {
    return {
      error: 'domain_filter is required',
      hint: 'Provide one or more keywords relevant to your task (e.g. "auth", "payment user"). Synonym groups: "[auth|login|jwt] payment".',
      totalFiles: index.files.size,
    };
  }

  const conceptGroups = parseConceptGroups(domain_filter);
  if (conceptGroups.length === 0) {
    return { error: 'domain_filter produced no usable tokens after filtering stop words.' };
  }

  const allTokens = conceptGroups.flat();
  const isTestQuery = include_tests || allTokens.some(t => TEST_QUERY_KEYWORDS.has(t));
  const totalFiles = index.files.size;

  const matched: MatchResult[] = [];
  let excludedTestCount = 0;

  for (const file of index.files.values()) {
    // Exclude barrels — barrels themselves are noise results
    if (file.isBarrel) continue;

    if (!isTestQuery && file.isTestFile) {
      // Count test files that would have matched, for the hint
      const result = matchFile(file, conceptGroups, index, conceptGroups.length);
      if (result !== null) excludedTestCount++;
      continue;
    }

    const result = matchFile(file, conceptGroups, index, conceptGroups.length);
    if (result !== null) matched.push(result);
  }

  // Predicate B: rarity OR multi-concept coverage
  const afterB = matched.filter(m => {
    const hasRareToken = [...m.allMatchedTokens].some(token => {
      const docFreq = index.tokenDocFreq.get(token) ?? 1;
      return Math.log(totalFiles / docFreq) > IDF_RARITY_THRESHOLD;
    });
    return hasRareToken || m.matchedGroupCount > 1;
  });

  afterB.sort((a, b) => compareMatches(a, b, conceptGroups.length));

  // 0-results fallback: reverse substring matching
  if (afterB.length === 0) {
    const fallbackMatched: MatchResult[] = [];

    for (const file of index.files.values()) {
      if (file.isBarrel) continue;
      if (!isTestQuery && file.isTestFile) continue;

      let matchedGroupCount = 0;
      const allMatchedTokens = new Set<string>();

      for (const group of conceptGroups) {
        let groupHit = false;
        for (const queryToken of group) {
          const expanded = expandQueryToken(queryToken);
          for (const qt of expanded) {
            for (const indexedToken of Object.keys(file.domainMap)) {
              if (indexedToken.length >= 4 && qt.includes(indexedToken)) {
                allMatchedTokens.add(indexedToken);
                groupHit = true;
              }
            }
          }
        }
        if (groupHit) matchedGroupCount++;
      }

      if (matchedGroupCount > 0) {
        fallbackMatched.push({
          path: file.relativePath,
          matchedGroupCount,
          totalConvergence: 0,
          concentration: 0,
          score: 0,
          idfScore: 0,
          allMatchedTokens,
          compoundLength: 0,
        });
      }
    }

    fallbackMatched.sort((a, b) => b.matchedGroupCount - a.matchedGroupCount);
    const truncated = fallbackMatched.length > max_results;
    const results = fallbackMatched.slice(0, max_results).map(m => m.path);

    const response: Record<string, unknown> = { filter: domain_filter };

    if (fallbackMatched.length === 0) {
      response.results = [];
      response.note = 'No matches found.';
    } else {
      response.fallback = true;
      response.note = 'No primary matches. Showing broad fallback matches. Try a shorter term or synonym group [term|alternative] if results look wrong.';
      response.results = results;
      if (truncated) {
        response.truncated = true;
        response.message = `[TRUNCATED: ${fallbackMatched.length - max_results} additional matches omitted.]`;
      }
    }

    if (excludedTestCount > 0) {
      response.excluded_test_files = excludedTestCount;
      response.hint = 'Test files were excluded. Pass include_tests: true to include them.';
    }

    return response;
  }

  // Truncation
  const truncated = afterB.length > max_results;
  const results = afterB.slice(0, max_results).map(m => m.path);

  const response: Record<string, unknown> = {
    filter: domain_filter,
    results,
  };

  if (truncated) {
    response.truncated = true;
    response.message = `[TRUNCATED: ${afterB.length - max_results} additional matches omitted. If a filename above looks right, call get-structure on it. Otherwise narrow your query by adding a more specific token.]`;
  }

  if (excludedTestCount > 0) {
    response.excluded_test_files = excludedTestCount;
    response.hint = 'Test files were excluded. Pass include_tests: true to include them.';
  }

  return response;
}

// ============================================================================
// trace-deps
// ============================================================================
export function handleTraceDeps(
  index: CodebaseIndex,
  params: {
    file_path: string;
    direction?: 'imports' | 'importers' | 'both';
    depth?: number;
  },
): object {
  if (!params.file_path) {
    return { error: 'file_path is required' };
  }
  const direction = params.direction ?? 'both';
  const maxDepth = Math.min(params.depth ?? 1, 3);

  // Find file by relative path (or suffix match)
  const fileEntry = findFileByPath(index, params.file_path);
  if (!fileEntry) {
    return { error: `File not found: ${params.file_path}` };
  }
  const [fileId, file] = fileEntry;

  function collectDeps(
    startId: string,
    getNeighbors: (id: string) => string[],
    depth: number,
  ): object[] {
    const visited = new Set<string>();
    const result: object[] = [];

    function traverse(id: string, currentDepth: number): void {
      if (currentDepth > depth || visited.has(id)) return;
      visited.add(id);
      for (const neighborId of getNeighbors(id)) {
        if (visited.has(neighborId)) continue;
        const neighbor = index.files.get(neighborId);
        if (!neighbor) continue;
        result.push({
          path: neighbor.relativePath,
          language: neighbor.language,
          exports: neighbor.exports.slice(0, 10),
          importedByCount: neighbor.importedByCount,
          depth: currentDepth,
        });
        if (currentDepth < depth) {
          traverse(neighborId, currentDepth + 1);
        }
      }
    }

    traverse(startId, 1);
    return result;
  }

  const response: Record<string, unknown> = {
    file: {
      path: file.relativePath,
      language: file.language,
    },
  };

  if (direction === 'imports' || direction === 'both') {
    response.imports = collectDeps(
      fileId,
      id => index.outEdges.get(id) ?? [],
      maxDepth,
    );
  }
  if (direction === 'importers' || direction === 'both') {
    response.importers = collectDeps(
      fileId,
      id => index.inEdges.get(id) ?? [],
      maxDepth,
    );
  }

  return response;
}

// ============================================================================
// get-structure
// ============================================================================
export function handleGetStructure(
  index: CodebaseIndex,
  params: { file_path: string },
): object {
  if (!params.file_path) {
    return { error: 'file_path is required' };
  }
  const fileEntry = findFileByPath(index, params.file_path);
  if (!fileEntry) {
    return { error: `File not found: ${params.file_path}` };
  }
  const [fileId, file] = fileEntry;

  // Classify imports as internal vs external
  const edges = index.edges.filter(e => e.from === fileId);
  const internalImports = edges
    .map(e => {
      const target = index.files.get(e.to);
      return target ? { specifier: e.specifier, resolvedPath: target.relativePath } : null;
    })
    .filter(Boolean);

  const allImportSpecifiers = file.imports;
  const resolvedSpecifiers = new Set(edges.map(e => e.specifier));
  const externalImports = allImportSpecifiers.filter(s => !resolvedSpecifiers.has(s));

  // Build symbol summary (TS/JS only)
  const symbolSummary = file.symbols.length > 0
    ? file.symbols
        .filter(s => s.isExported || s.kind === 'class' || s.kind === 'function')
        .map(s => ({
          name: s.name,
          kind: s.kind,
          lines: `${s.startLine}-${s.endLine}`,
          ...(s.extendsName ? { extends: s.extendsName } : {}),
          ...(s.implementsNames.length > 0 ? { implements: s.implementsNames } : {}),
          ...(s.calls.length > 0 ? { calls: s.calls.slice(0, 8) } : {}),
        }))
    : undefined;

  return {
    path: file.relativePath,
    exports: file.exports,
    ...(symbolSummary ? { symbols: symbolSummary } : {}),
    imports: {
      internal: internalImports,
      external: externalImports,
    },
    lineCount: file.lineCount,
    importedByCount: file.importedByCount,
  };
}

// ============================================================================
// trace-impact
// ============================================================================
export function handleTraceImpact(
  index: CodebaseIndex,
  params: {
    symbol: string;
    file?: string;
    depth?: number;
  },
): object {
  const { symbol, file: filePath, depth: requestedDepth } = params;

  if (!symbol) {
    return { error: 'symbol is required' };
  }

  const maxDepth = Math.min(requestedDepth ?? 3, 10);
  const TRUNCATE_AT = 50;

  // -------------------------------------------------------------------------
  // Step 1: Find target symbol
  // -------------------------------------------------------------------------
  const candidates = findSymbolCandidates(index, symbol, filePath);

  if (candidates.length === 0) {
    return {
      error: `Symbol not found: ${symbol}`,
      suggestions: fuzzyMatchSymbols(index, symbol).slice(0, 5),
    };
  }

  if (candidates.length > 1) {
    return {
      error: `Symbol "${symbol}" is ambiguous (${candidates.length} matches). Provide file to disambiguate.`,
      candidates: candidates.map(c => ({
        symbol: c.name,
        file: c.fileEntry.relativePath,
        kind: c.kind,
      })),
    };
  }

  const target = candidates[0];

  // -------------------------------------------------------------------------
  // Step 2: Build symbol-level reverse adjacency map (inEdges)
  // Exclude 'exports' edges — a file exporting a symbol is not impacted by it
  // -------------------------------------------------------------------------
  const symInEdges = new Map<string, Array<{ from: string; type: string }>>();

  for (const edge of index.symbolEdges) {
    if (edge.type === 'exports') continue;
    if (!symInEdges.has(edge.to)) symInEdges.set(edge.to, []);
    symInEdges.get(edge.to)!.push({ from: edge.from, type: edge.type });
  }

  // -------------------------------------------------------------------------
  // Step 3: BFS traversal from target
  // -------------------------------------------------------------------------
  type ImpactEntry = {
    symbolId: string;
    depth: number;
    path: string[];     // symbolIds from target → this node
    relationship: string;
  };

  const visited = new Set<string>([target.id]);
  const impacted: ImpactEntry[] = [];

  // Queue items: [symbolId, depth, pathSoFar, relationship]
  const queue: Array<{ id: string; depth: number; path: string[]; rel: string }> = [];

  for (const inc of symInEdges.get(target.id) ?? []) {
    if (!visited.has(inc.from)) {
      queue.push({ id: inc.from, depth: 1, path: [target.id, inc.from], rel: inc.type });
    }
  }

  while (queue.length > 0) {
    const { id, depth, path, rel } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    impacted.push({ symbolId: id, depth, path, relationship: rel });

    if (depth >= maxDepth) continue;

    for (const inc of symInEdges.get(id) ?? []) {
      if (!visited.has(inc.from)) {
        queue.push({ id: inc.from, depth: depth + 1, path: [...path, inc.from], rel: inc.type });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Resolve symbolIds to human-readable info
  // -------------------------------------------------------------------------
  const symInfo = buildSymbolInfoMap(index);

  function resolveId(id: string): { name: string; file: string; kind: string } {
    const info = symInfo.get(id);
    if (info) return info;
    // Fallback: parse the id format "fileId#symbolName"
    const hash = id.lastIndexOf('#');
    if (hash !== -1) return { name: id.slice(hash + 1), file: id.slice(0, hash), kind: 'unknown' };
    return { name: id, file: '', kind: 'unknown' };
  }

  const truncated = impacted.length > TRUNCATE_AT;
  const displayImpacted = truncated ? impacted.slice(0, TRUNCATE_AT) : impacted;

  // -------------------------------------------------------------------------
  // Step 5: Build summary
  // -------------------------------------------------------------------------
  const byDepth: Record<number, number> = {};
  const byRelationship: Record<string, number> = {};
  const affectedFilesSet = new Set<string>();

  for (const entry of impacted) {
    byDepth[entry.depth] = (byDepth[entry.depth] ?? 0) + 1;
    byRelationship[entry.relationship] = (byRelationship[entry.relationship] ?? 0) + 1;
    const info = symInfo.get(entry.symbolId);
    if (info) affectedFilesSet.add(info.file);
  }

  return {
    target: {
      symbol: target.name,
      file: target.fileEntry.relativePath,
      type: target.kind,
    },
    impacted: displayImpacted.map(entry => {
      const info = resolveId(entry.symbolId);
      return {
        symbol: info.name,
        file: info.file,
        type: info.kind,
        relationship: entry.relationship,
        depth: entry.depth,
        path: entry.path.map(sid => resolveId(sid).name),
      };
    }),
    summary: {
      totalImpacted: impacted.length,
      byDepth,
      byRelationship,
      affectedFiles: [...affectedFilesSet].sort(),
      ...(truncated ? { truncatedAt: TRUNCATE_AT, note: 'Impact set exceeded limit; results truncated' } : {}),
    },
  };
}

// ============================================================================
// Helper: build a flat map of symbolId → { name, file, kind }
// ============================================================================
function buildSymbolInfoMap(index: CodebaseIndex): Map<string, { name: string; file: string; kind: string }> {
  const map = new Map<string, { name: string; file: string; kind: string }>();
  for (const file of index.files.values()) {
    for (const sym of file.symbols) {
      map.set(sym.id, { name: sym.name, file: file.relativePath, kind: sym.kind });
    }
  }
  return map;
}

// ============================================================================
// Helper: find symbol candidates by name (with optional file filter)
// ============================================================================
type IndexedFileLike = {
  relativePath: string;
  symbols: import('../types.js').SymbolNode[];
};

function findSymbolCandidates(
  index: CodebaseIndex,
  symbolName: string,
  filePath?: string,
): Array<{ id: string; name: string; kind: string; fileEntry: IndexedFileLike }> {
  const results: Array<{ id: string; name: string; kind: string; fileEntry: IndexedFileLike }> = [];

  const searchIn = (file: IndexedFileLike) => {
    for (const sym of file.symbols) {
      if (sym.name === symbolName) {
        results.push({ id: sym.id, name: sym.name, kind: sym.kind, fileEntry: file });
      }
    }
  };

  if (filePath) {
    const fileEntry = findFileByPath(index, filePath);
    if (fileEntry) searchIn(fileEntry[1]);
  } else {
    for (const file of index.files.values()) {
      searchIn(file);
    }
  }

  return results;
}

// ============================================================================
// Helper: fuzzy-match symbol names (for error suggestions)
// ============================================================================
function fuzzyMatchSymbols(
  index: CodebaseIndex,
  query: string,
): Array<{ symbol: string; file: string; kind: string }> {
  const results: Array<{ symbol: string; file: string; kind: string }> = [];
  const lq = query.toLowerCase();

  for (const file of index.files.values()) {
    for (const sym of file.symbols) {
      if (sym.name.toLowerCase().includes(lq) || lq.includes(sym.name.toLowerCase())) {
        results.push({ symbol: sym.name, file: file.relativePath, kind: sym.kind });
        if (results.length >= 10) return results;
      }
    }
  }

  return results;
}

// ============================================================================
// Helper: find file by path (exact relative, or suffix)
// ============================================================================
function findFileByPath(
  index: CodebaseIndex,
  pathQuery: string | undefined,
): [string, (typeof index.files extends Map<string, infer V> ? V : never)] | null {
  if (!pathQuery) return null;
  // Normalize
  const normalized = pathQuery.replace(/\\/g, '/');

  // Exact match first
  if (index.files.has(normalized)) {
    return [normalized, index.files.get(normalized)!];
  }

  // Suffix match
  for (const [id, file] of index.files) {
    if (id.endsWith(normalized) || id.includes(normalized)) {
      return [id, file];
    }
  }

  return null;
}
