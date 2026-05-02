import type { CodebaseIndex, IndexedFile } from '../types.js';
import { tokenizeName } from '../indexer/tokenize.js';
import { IDF_RARITY_THRESHOLD } from '../constants.js';

// Query tokens that signal the user is working on test/automation code
export const TEST_QUERY_KEYWORDS = new Set([
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

export function expandQueryToken(token: string): string[] {
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

export function compareMatches(a: MatchResult, b: MatchResult, totalGroups: number): number {
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
