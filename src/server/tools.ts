import { readFileSync } from 'node:fs';
import type { CodebaseIndex, IndexedFile, SymbolNode } from '../types.js';
import { IDF_RARITY_THRESHOLD } from '../constants.js';
import {
  extractContentTokens,
  deriveInPageTokenLinks,
  deriveRelatedFiles,
  deriveNameEchoFiles,
  isShapedToken,
  RELATED_FILES_CAP,
  type RelatedFile,
} from '../indexer/content-tokens.js';
import {
  TEST_QUERY_KEYWORDS,
  parseConceptGroups,
  expandLexical,
  expandSynonyms,
  matchFile,
  compareMatches,
  type MatchResult,
} from './scoring.js';
import { compileGlob, matchesGlob } from './glob.js';

export { parseConceptGroups, matchFile, type MatchResult };

// For a target file, find callers of its exported symbols via symbolEdges.
// Returns up to CALLERS_CAP unique caller files, each with up to a few example
// caller-symbol/line pairs.
const CALLERS_CAP = 12;
const CALL_LINES_PER_CALLER_FILE = 3;
function buildCallersForFile(
  fileId: string,
  file: IndexedFile,
  index: CodebaseIndex,
): { exportedSymbol: string; callers: string[] }[] {
  // Build a map: exported symbolId → list of incoming calls (caller symbolId + line)
  const exportedIds = new Set(
    file.symbols.filter(s => s.isExported).map(s => s.id),
  );
  if (exportedIds.size === 0) return [];

  // exportedSymbolId → caller fileId → [caller info]
  const callsTo = new Map<string, Map<string, { symbolName: string; line?: number }[]>>();

  // symInfo for resolving symbolIds → fileId+name. Build lazily on first hit.
  let symInfo: Map<string, { name: string; file: string; kind: string }> | null = null;
  function info() {
    if (!symInfo) symInfo = buildSymbolInfoMap(index);
    return symInfo;
  }

  for (const edge of index.symbolEdges) {
    if (edge.type !== 'calls') continue;
    if (!exportedIds.has(edge.to)) continue;

    const fromInfo = info().get(edge.from);
    // Skip self-references inside the target file
    if (fromInfo?.file === file.relativePath) continue;
    const callerFile = fromInfo?.file;
    const callerName = fromInfo?.name ?? edge.from;
    if (!callerFile) continue;

    if (!callsTo.has(edge.to)) callsTo.set(edge.to, new Map());
    const perFile = callsTo.get(edge.to)!;
    if (!perFile.has(callerFile)) perFile.set(callerFile, []);
    perFile.get(callerFile)!.push({ symbolName: callerName, line: edge.line });
  }

  const out: { exportedSymbol: string; callers: string[] }[] = [];
  for (const sym of file.symbols) {
    if (!sym.isExported) continue;
    const perFile = callsTo.get(sym.id);
    if (!perFile || perFile.size === 0) continue;

    const callers: string[] = [];
    let truncated = 0;
    for (const [callerFile, callsList] of perFile) {
      if (callers.length >= CALLERS_CAP) {
        truncated += 1;
        continue;
      }
      const samples = callsList.slice(0, CALL_LINES_PER_CALLER_FILE).map(c => {
        if (typeof c.line === 'number' && c.line > 0) {
          return `${callerFile}:${c.line} (${c.symbolName})`;
        }
        return `${callerFile} (${c.symbolName})`;
      });
      const extra = callsList.length - samples.length;
      callers.push(samples.join('; ') + (extra > 0 ? ` +${extra} more` : ''));
    }
    if (truncated > 0) callers.push(`[+${truncated} more caller files]`);
    out.push({ exportedSymbol: sym.name, callers });
  }
  return out;
}

// Build a single GO result entry.
function buildResultEntry(
  m: MatchResult,
  index: CodebaseIndex,
): Record<string, unknown> {
  return {
    path: m.path,
    matched: formatMatchedTokens(m, index),
    channel: matchChannel(m, index),
  };
}

// Annotate import links AMONG the shown results (in-page only — bounded by
// page size, no hub fan-out; arches measurement: median 2 links/page). An edge
// between two shown files is the same structural evidence get-structure would
// deliver one call later; surfacing it at wall-1 hands the agent its
// read-trigger evidence (gold-timeline: GS edges are the dominant read
// trigger) without a turn spent.
function annotateInPageImports(
  results: Record<string, unknown>[],
  index: CodebaseIndex,
): void {
  const pageIds = new Set(results.map(r => r.path as string));
  for (const r of results) {
    const importers = (index.inEdges.get(r.path as string) ?? []).filter(id =>
      pageIds.has(id),
    );
    if (importers.length === 0) continue;
    const names = importers.slice(0, 2).map(id => id.split('/').pop());
    r.importedByShown =
      names.join(', ') +
      (importers.length > 2 ? ` +${importers.length - 2}` : '');
  }
}

// Annotate rare-content-token links AMONG the shown results. The pair shares
// identifier/string tokens that are rare corpus-wide (df 2–5) but have NO
// import edge — exactly the relations the import graph cannot see (migrations
// ↔ models, config-by-name, cross-language pairs). Display-only; the line
// names the shared token because a relation is the actionable unit — bare
// filenames in context stay inert (q16: wall-1 exposure was universal in all
// 21 runs and inert in 16).
const LINK_TOKENS_SHOWN = 3;
function annotateInPageTokenLinks(
  results: Record<string, unknown>[],
  index: CodebaseIndex,
  queryTokens: string[],
): void {
  const pageIds = results.map(r => r.path as string);
  const links = deriveInPageTokenLinks(pageIds, index, queryTokens);
  if (links.length === 0) return;
  const byPath = new Map(results.map(r => [r.path as string, r]));
  for (const link of links) {
    const host = byPath.get(link.a);
    if (!host) continue;
    const otherIds = [link.b, ...(link.alsoB ?? [])];
    const otherNames = otherIds.slice(0, 2).map(id => id.split('/').pop()).join(', ') +
      (otherIds.length > 2 ? ` +${otherIds.length - 2}` : '');
    const shown = link.tokens.slice(0, LINK_TOKENS_SHOWN).map(t => `\`${t}\``).join(', ');
    const extra = link.tokens.length - LINK_TOKENS_SHOWN;
    const line = `~ shares ${shown}${extra > 0 ? ` +${extra}` : ''} with ${otherNames} (also listed)`;
    const existing = host.tokenLinks as string[] | undefined;
    if (existing) existing.push(line);
    else host.tokenLinks = [line];
  }
}

// Factual classification of HOW a file matched, from per-token DomainEvidence
// (not a role/purpose claim — see [[coldstart-is-evidence-not-classifier]]).
//   'symbol' — matched only on declared code names (exports/classes/functions)
//   'name'   — matched only on file/dir names (visible in the path)
//   'mixed'  — matched on both
type MatchChannel = 'symbol' | 'name' | 'mixed';
function matchChannel(m: MatchResult, index: CodebaseIndex): MatchChannel {
  const file = index.files.get(m.path);
  let sym = false;
  let nameOrDir = false;
  if (file) {
    for (const t of m.allMatchedTokens) {
      const ev = file.domainMap[t];
      if (!ev) continue;
      if (ev.symbol > 0) sym = true;
      if (ev.filename > 0 || ev.path > 0) nameOrDir = true;
    }
  }
  if (sym && !nameOrDir) return 'symbol';
  if (nameOrDir && !sym) return 'name';
  return 'mixed';
}

// Rarest first (lowest docFreq). Capped — leading tokens are the navigation
// signal; later tokens add bytes without adding lift.
const MATCHED_TOKENS_PER_RESULT = 5;
function formatMatchedTokens(m: MatchResult, index: CodebaseIndex): string[] {
  // Display = literal-query-driven matches only (synonym matches feed ranking but
  // aren't shown — the agent didn't type them). Drop separator-joined compounds
  // (`a_b_c` / `a-b-c`): tokenizeName never emits separators, so any matched token
  // containing one is the verbatim filename/dir form already visible in the path.
  const tokens = [...m.displayTokens].filter(
    t => !t.includes('_') && !t.includes('-'),
  );
  tokens.sort(
    (a, b) =>
      (index.tokenDocFreq.get(a) ?? 1) - (index.tokenDocFreq.get(b) ?? 1),
  );
  return tokens.slice(0, MATCHED_TOKENS_PER_RESULT);
}

// One line per result: `path [tok1, tok2, ...]`. Plain text — the agent reads
// this, JSON metadata gets skimmed.
function formatResultLine(entry: Record<string, unknown>): string {
  const path = entry.path as string;
  const matched = entry.matched as string[];
  const link = entry.importedByShown as string | undefined;
  return `${path} matched: [${matched.join(', ')}]${
    link ? ` ← imported by ${link} (also listed)` : ''
  }`;
}

const GO_FOOTER =
  'Next: `get-structure` the best `[matched]` fit; reformulate only if no result fits.';

// ============================================================================
// get-overview
// ============================================================================

// ---------------------------------------------------------------------------
// Content-presence fallback (option B). For query tokens that match ZERO
// declared names (where GO is structurally blind), report where the token
// lives in file BODIES — or, for identifier-shaped tokens only, that it
// appears nowhere. Characterized on 52 real runs (2026-06-12): 24% of real GO
// query tokens are declared-name-invisible; clean fires named gold 8/17;
// absence assertions are valid ONLY for shaped tokens (unshaped words never
// enter contentTokens, so their absence proves nothing). Display-only.
// ---------------------------------------------------------------------------
const CONTENT_PRESENCE_MAX_LINES = 3;
const CONTENT_PRESENCE_FLOOD = 8; // df above this → count only, never a file list

function deriveContentPresenceLines(
  rawQuery: string,
  index: CodebaseIndex,
): string[] {
  const presence = index.contentPresenceIndex;
  if (!presence || presence.size === 0) return [];

  const words: string[] = [];
  const seen = new Set<string>();
  for (const w of rawQuery.split(/[\s[\]|,]+/)) {
    if (w.length < 4 || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(w)) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(w);
  }

  const listed: string[] = [];
  const absent: string[] = [];
  const flood: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    const norm = lower.replace(/[.-]/g, '_');
    // Skip tokens GO can match: any lexical form present among declared names
    let declared = false;
    for (const form of new Set([...expandLexical(lower), ...expandLexical(norm)])) {
      if ((index.tokenDocFreq.get(form) ?? 0) > 0) {
        declared = true;
        break;
      }
    }
    if (declared) continue;

    const entry = presence.get(lower) ?? presence.get(norm);
    if (entry) {
      if (entry.n <= CONTENT_PRESENCE_FLOOD) {
        listed.push(
          `\`${w}\` matches no declared name but appears in file CONTENT of: ${entry.files.join(', ')}`,
        );
      } else {
        flood.push(
          `\`${w}\` matches no declared name; found in ${entry.n} files' content — scope with \`path\` or grep`,
        );
      }
    } else if (isShapedToken(w) || isShapedToken(w.replace(/[.-]/g, '_'))) {
      absent.push(
        `\`${w}\` appears NOWHERE in indexed file content — this identifier does not exist in the repo; do not grep spelling variants`,
      );
    }
  }
  return [...listed, ...absent, ...flood].slice(0, CONTENT_PRESENCE_MAX_LINES);
}

export function handleGetOverview(
  index: CodebaseIndex,
  params: {
    query?: string;
    domain_filter?: string; // legacy alias, accepted but undocumented
    max_results?: number;
    include_tests?: boolean;
    path?: string;
    page?: number;
  },
): object {
  const {
    max_results = 10,
    include_tests = false,
    path: pathSpec,
    page = 1,
  } = params;
  const query = params.query ?? params.domain_filter;

  if (!query) {
    return {
      error: 'query is required',
      __rawText:
        'Error: missing `query`. Provide one or more keywords (e.g. "auth", "payment user"). Synonym groups: "[auth|login|jwt] payment".',
    };
  }

  const conceptGroups = parseConceptGroups(query);
  if (conceptGroups.length === 0) {
    return {
      error: 'query produced no usable tokens after filtering stop words.',
      __rawText:
        'Error: `query` produced no usable tokens after filtering stop words. Use concrete domain words (e.g. "auth", "tile resource graph").',
    };
  }

  const compiledGlob = pathSpec ? compileGlob(pathSpec) : null;
  const contentPresenceLines = deriveContentPresenceLines(query, index);

  const allTokens = conceptGroups.flat();
  const isTestQuery = include_tests || allTokens.some(t => TEST_QUERY_KEYWORDS.has(t));
  const totalFiles = index.files.size;

  const matched: MatchResult[] = [];
  let excludedTestCount = 0;
  let excludedByPathCount = 0;

  for (const file of index.files.values()) {
    // Exclude barrels — barrels themselves are noise results
    if (file.isBarrel) continue;

    if (compiledGlob && !matchesGlob(file.relativePath, compiledGlob)) {
      excludedByPathCount++;
      continue;
    }

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
      if (compiledGlob && !matchesGlob(file.relativePath, compiledGlob)) continue;

      let matchedGroupCount = 0;
      const allMatchedTokens = new Set<string>();
      const displayTokens = new Set<string>();

      for (const group of conceptGroups) {
        let groupHit = false;
        for (const queryToken of group) {
          const lexForms = expandLexical(queryToken);
          const expanded = [...lexForms, ...expandSynonyms(queryToken)];
          for (const qt of expanded) {
            const isLiteral = lexForms.has(qt);
            for (const indexedToken of Object.keys(file.domainMap)) {
              if (indexedToken.length >= 4 && qt.includes(indexedToken)) {
                allMatchedTokens.add(indexedToken);
                if (isLiteral) displayTokens.add(indexedToken);
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
          displayTokens,
          compoundLength: 0,
        });
      }
    }

    fallbackMatched.sort((a, b) => b.matchedGroupCount - a.matchedGroupCount);
    const truncated = fallbackMatched.length > page * max_results;
    const results = fallbackMatched
      .slice((page - 1) * max_results, page * max_results)
      .map(m => buildResultEntry(m, index));
    annotateInPageImports(results, index);
    annotateInPageTokenLinks(results, index, allTokens);

    const response: Record<string, unknown> = { filter: query };

    if (fallbackMatched.length === 0) {
      response.results = [];
    } else {
      response.fallback = true;
      response.results = results;
      if (truncated) {
        response.truncated = true;
        response.message = `[+${fallbackMatched.length - page * max_results} more fallback matches]`;
      }
    }

    if (excludedTestCount > 0) {
      response.excluded_test_files = excludedTestCount;
    }

    attachPathExclusion(response, excludedByPathCount, pathSpec);

    response.__rawText = renderOverviewText({
      query,
      results: results,
      contentPresenceLines,
      fallback: fallbackMatched.length > 0,
      noMatches: fallbackMatched.length === 0,
      truncatedExtra: truncated ? fallbackMatched.length - page * max_results : 0,
      excludedTestCount,
      excludedByPathCount,
      pathSpec,
    });
    return response;
  }

  const truncated = afterB.length > page * max_results;
  const results = afterB
    .slice((page - 1) * max_results, page * max_results)
    .map(m => buildResultEntry(m, index));
  annotateInPageImports(results, index);
  annotateInPageTokenLinks(results, index, allTokens);

  const response: Record<string, unknown> = {
    filter: query,
    results,
  };

  if (truncated) {
    response.truncated = true;
    response.message = `[+${afterB.length - page * max_results} more results]`;
  }

  if (excludedTestCount > 0) {
    response.excluded_test_files = excludedTestCount;
  }

  attachPathExclusion(response, excludedByPathCount, pathSpec);

  response.__rawText = renderOverviewText({
    query,
    results,
    contentPresenceLines,
    fallback: false,
    noMatches: false,
    truncatedExtra: truncated ? afterB.length - page * max_results : 0,
    excludedTestCount,
    excludedByPathCount,
    pathSpec,
  });
  return response;
}

// Render the agent-facing text for a GO response. The agent reads this; the
// structured fields above are retained for downstream tests and tooling.
function renderOverviewText(opts: {
  query: string;
  results: Record<string, unknown>[];
  contentPresenceLines?: string[];
  fallback: boolean;
  noMatches: boolean;
  truncatedExtra: number;
  excludedTestCount: number;
  excludedByPathCount: number;
  pathSpec: string | undefined;
}): string {
  const lines: string[] = [];

  if (opts.fallback) {
    lines.push('[No exact-name matches. Substring fallbacks — soft signal; grep is more reliable for content in strings/templates/comments.]');
  }

  if (opts.noMatches) {
    lines.push('[No declared-name matches.]');
  } else {
    // Group results by match channel. Sections appear in order of their
    // best-ranked member and rank order is kept WITHIN a section — but the
    // flattened line order is NOT global rank: a later section's lead can
    // outrank an earlier section's tail. Anything consuming this text
    // (hooks, analysis scripts, agents) must not read line order as ranking.
    const SECTION_LABEL: Record<MatchChannel, string> = {
      symbol: 'Matched in code/symbol names:',
      name: 'Matched in file/dir names:',
      mixed: 'Matched in both name and code:',
    };
    const order: MatchChannel[] = [];
    const groups = new Map<MatchChannel, Record<string, unknown>[]>();
    for (const r of opts.results) {
      const ch = (r.channel as MatchChannel) ?? 'mixed';
      if (!groups.has(ch)) {
        groups.set(ch, []);
        order.push(ch);
      }
      groups.get(ch)!.push(r);
    }
    for (let i = 0; i < order.length; i++) {
      const ch = order[i];
      if (i > 0) lines.push('');
      lines.push(SECTION_LABEL[ch]);
      for (const r of groups.get(ch)!) {
        lines.push('  ' + formatResultLine(r));
        const tokenLinks = r.tokenLinks as string[] | undefined;
        if (tokenLinks) for (const tl of tokenLinks) lines.push('    ' + tl);
      }
    }
  }

  if (opts.contentPresenceLines && opts.contentPresenceLines.length > 0) {
    lines.push('');
    lines.push('Content presence (query tokens with NO declared-name match, located in file bodies):');
    for (const l of opts.contentPresenceLines) lines.push('  ' + l);
  }

  if (opts.truncatedExtra > 0) {
    lines.push(`[+${opts.truncatedExtra} more — narrow with a tighter \`query\` only if no shown result fits]`);
  }

  if (opts.excludedByPathCount > 0 && opts.pathSpec) {
    lines.push(`[excluded by path filter "${opts.pathSpec}": ${opts.excludedByPathCount}]`);
  }
  if (opts.excludedTestCount > 0) {
    lines.push(`[excluded ${opts.excludedTestCount} test files — pass include_tests: true to include]`);
  }

  lines.push('');
  if (opts.noMatches) {
    lines.push('Next: GO indexes declared names only. Check the Content presence lines above (file-body evidence) if present; otherwise grep, scoped by file extension.');
  } else {
    lines.push(GO_FOOTER);
  }

  return lines.join('\n');
}

function attachPathExclusion(
  response: Record<string, unknown>,
  excludedByPathCount: number,
  pathSpec: string | undefined,
): void {
  if (!pathSpec || excludedByPathCount === 0) return;
  response.excluded_by_path = excludedByPathCount;
  response.path_filter = pathSpec;
}

// ============================================================================
// get-structure (drill-down: symbols + imports + importers + per-symbol callers)
// ============================================================================
type GsView = 'full' | 'symbols' | 'imports' | 'importers' | 'callers';

const IMPORTERS_LIST_CAP = 20;
const BODY_REF_IMPORTERS_CAP = 8;
// For huge files, show top-K symbols sorted by caller count first; the rest
// collapse into a tail. Avoids the 60-class wall-of-text problem.
const SYMBOLS_TOP_K = 15;
const SYMBOLS_HUGE_FILE_THRESHOLD = 20;
// Inline single caller when symbol has only 1; switch to newline-per-caller
// once a symbol has 2+ callers (otherwise the line balloons past 500 chars).
const CALLER_INLINE_MAX = 1;

function isTestPath(p: string): boolean {
  return p.startsWith('tests/') || p.startsWith('test/')
    || p.includes('/tests/') || p.includes('/test/')
    || /_tests?\.[a-z]+$/.test(p)
    || /\.tests?\.[a-z]+$/.test(p);
}

export function handleGetStructure(
  index: CodebaseIndex,
  params: {
    file_path: string;
    match?: string;
    view?: GsView;
    symbol?: string;
  },
): object {
  if (!params.file_path) {
    return { error: 'file_path is required' };
  }
  const fileEntry = findFileByPath(index, params.file_path);
  if (!fileEntry) {
    return { error: `File not found: ${params.file_path}` };
  }
  const [fileId, file] = fileEntry;

  // Grade-2 symbol-body delivery: `--symbol name1,name2` slices the named
  // method bodies straight from the indexed [startLine,endLine] range so the
  // agent gets them in ONE call instead of windowing a god-file at guessed
  // offsets (q22 read graph.py 8× hunting serialize/restore_state). Each slice
  // is followed by 1-line caller/callee POINTERS (not bodies) so the next hop
  // is one directed call away. This is the lever; grade-1 (the matched-symbol
  // line ranges in `find`) only pointed the agent at the offsets.
  if (params.symbol && params.symbol.trim()) {
    return renderSymbolSlice(index, fileId, file, params.symbol);
  }

  // Validate `view`: an invalid value (stale client, typo, or a hallucinated
  // name like "outline") would otherwise silently disable EVERY section and
  // return a header-only response, pushing the agent to grep. Fail open —
  // coerce to 'full' and surface a loud warning so the agent self-corrects.
  const VALID_VIEWS: readonly GsView[] = ['full', 'symbols', 'imports', 'importers', 'callers'];
  const requestedView = params.view;
  const viewIsInvalid = requestedView !== undefined && !VALID_VIEWS.includes(requestedView);
  const view: GsView = viewIsInvalid ? 'full' : (requestedView ?? 'full');
  const matchPredicate = compileMatchPredicate(params.match);
  const wantSymbols = view === 'full' || view === 'symbols';
  const wantImports = view === 'full' || view === 'imports';
  const wantImporters = view === 'full' || view === 'importers';
  const wantInlineCallers = view === 'full';
  const wantExpandedCallers = view === 'callers';

  // Pre-compute callers once if any caller view is on
  let callersByName: Map<string, string[]> | null = null;
  if (wantInlineCallers || wantExpandedCallers) {
    const perSym = buildCallersForFile(fileId, file, index);
    callersByName = new Map();
    for (const entry of perSym) {
      callersByName.set(entry.exportedSymbol, entry.callers);
    }
  }

  // Build structured intermediate (single source of truth for both renderers).
  type SymOut = {
    name: string;
    displayName: string;
    indent: string;
    kind: string;
    startLine: number;
    endLine: number;
    extendsName?: string;
    implementsNames: string[];
    callers: string[];        // raw caller strings, may be empty
    callerFileCount: number;  // for sorting
  };

  let symbolsOut: SymOut[] = [];
  let totalSymbolCount = 0;
  let filteredSymbolCount = 0;
  let truncatedSymbolCount = 0;
  let matchMissedSymbols = false;

  if (wantSymbols) {
    const baseFiltered = file.symbols
      .filter(s => s.isExported || s.kind === 'class' || s.kind === 'function' || s.kind === 'method')
      .slice()
      .sort((a, b) => a.startLine - b.startLine);
    totalSymbolCount = baseFiltered.length;

    let filtered = matchPredicate
      ? baseFiltered.filter(s => matchPredicate(s.name))
      : baseFiltered;
    // Match-miss auto-fallback: a "0 symbols match" result's only possible
    // follow-up is re-calling without the filter (a measured wasted call).
    // Return the full view instead, flagged via matchMissedSymbols.
    if (matchPredicate && filtered.length === 0 && baseFiltered.length > 0) {
      filtered = baseFiltered;
      matchMissedSymbols = true;
    }
    filteredSymbolCount = filtered.length;

    // Compute display names + parent class indent (preserves source-order
    // tree structure before any reorder).
    let lastClassName: string | null = null;
    const annotated: SymOut[] = filtered.map(s => {
      let displayName = s.name;
      let indent = '';
      if (lastClassName && s.name.startsWith(lastClassName + '.')) {
        displayName = s.name.slice(lastClassName.length + 1);
        indent = '  ';
      } else if (s.kind === 'class') {
        lastClassName = s.name;
      }
      const callers = callersByName?.get(s.name) ?? [];
      return {
        name: s.name,
        displayName,
        indent,
        kind: s.kind,
        startLine: s.startLine,
        endLine: s.endLine,
        extendsName: s.extendsName,
        implementsNames: s.implementsNames,
        callers,
        callerFileCount: callers.length,
      };
    });

    // For full view of huge files (no match filter), reorder by caller count
    // desc so most-used symbols surface first; then truncate to top-K with a
    // summary tail. With a match filter we honour the filter exactly — agent
    // is steering, not browsing.
    if (
      view === 'full' &&
      (!matchPredicate || matchMissedSymbols) &&
      annotated.length > SYMBOLS_HUGE_FILE_THRESHOLD
    ) {
      const sorted = annotated.slice().sort((a, b) => {
        if (b.callerFileCount !== a.callerFileCount) {
          return b.callerFileCount - a.callerFileCount;
        }
        return a.startLine - b.startLine;
      });
      // After reorder, parent-class indent is no longer meaningful (siblings
      // are scattered), so show the full qualified name and drop indent.
      symbolsOut = sorted.slice(0, SYMBOLS_TOP_K).map(s => ({
        ...s,
        displayName: s.name,
        indent: '',
      }));
      truncatedSymbolCount = sorted.length - symbolsOut.length;
    } else {
      symbolsOut = annotated;
    }
  }

  // Build imports list
  let importsOut: string[] = [];
  let totalImportCount = 0;
  if (wantImports) {
    const internalImports = [...new Set(
      index.edges
        .filter(e => e.from === fileId)
        .map(e => index.files.get(e.to)?.relativePath)
        .filter((p): p is string => !!p)
    )];
    totalImportCount = internalImports.length;
    importsOut = matchPredicate
      ? internalImports.filter(p => matchPredicate(p))
      : internalImports;
  }

  // Build importers list
  let importersShown: string[] = [];
  let importersFiltered = 0;
  let importersExtra = 0;
  let totalImporterCount = 0;
  let bodyRefImporters: string[] = [];
  let bodyRefTotal = 0;
  if (wantImporters) {
    const allImporters = buildAllImporters(fileId, index);
    totalImporterCount = allImporters.length;
    const filteredImporters = matchPredicate
      ? allImporters.filter(p => matchPredicate(p))
      : allImporters;
    importersFiltered = filteredImporters.length;
    importersShown = filteredImporters.slice(0, IMPORTERS_LIST_CAP);
    importersExtra = filteredImporters.length - importersShown.length;

    // Body-reference filter: with `match`, the filename filter alone hides the
    // files an agent actually wants — files that *reference* the matched
    // symbol but don't carry it in their path (q16: admin.py registers
    // models.SpatialView via attribute access; not a call edge, filename
    // doesn't match → invisible, and the agent reconstructed this set with 25
    // greps). Scan is REPO-WIDE, not importer-scoped: the cross-language
    // use-sites this section exists for (a JS file referencing a Python
    // symbol) import nothing from the target file, so an importer-only scan
    // misses them — and only a repo-wide scan makes the rendered
    // exhaustiveness claim true (q16 run-3: the agent held "body-refs =
    // admin.py + graph.py" at call 11 and still spent 20 calls hunting a JS
    // frontend that doesn't exist, because nothing said the list was
    // complete). Shape-gated tokens only, so single-word terms find nothing —
    // the section is omitted, never rendered as a misleading "0".
    if (matchPredicate) {
      const alreadyShown = new Set(importersShown);
      for (const [p, f] of index.files) {
        if (p === fileId || alreadyShown.has(p)) continue;
        const toks = f.contentTokens;
        if (!toks) continue;
        for (const k of Object.keys(toks)) {
          if (matchPredicate(k)) { bodyRefImporters.push(p); break; }
        }
      }
      bodyRefTotal = bodyRefImporters.length;
      // Source files first — tests are verification, not mechanism.
      bodyRefImporters = [
        ...bodyRefImporters.filter(p => !isTestPath(p)),
        ...bodyRefImporters.filter(isTestPath),
      ].slice(0, BODY_REF_IMPORTERS_CAP);
    }
  }

  // Related files via the content-token channel (full view only). When the
  // agent passed `match`, scope the source tokens to the matched symbols'
  // line ranges — the match param is the agent's stated intent, and the echo
  // lands at the attend-moment (the call right before the region gets Read).
  // Dedupe is against what THIS payload renders (importsOut/importersShown),
  // not the raw edge set — a god-file's truncated importer list can hide a
  // file that the edge set technically contains.
  let relatedOut: RelatedFile[] = [];
  if (view === 'full') {
    const excludeIds = new Set<string>([fileId, ...importsOut, ...importersShown, ...bodyRefImporters]);
    let sourceTokens = file.contentTokens;
    if (matchPredicate && !matchMissedSymbols && symbolsOut.length > 0 && index.contentTokenPostings.size > 0) {
      try {
        const allLines = readFileSync(file.path, 'utf-8').split('\n');
        const parts: string[] = [];
        let taken = 0;
        for (const s of symbolsOut) {
          parts.push(allLines.slice(s.startLine - 1, s.endLine).join('\n'));
          taken += s.endLine - s.startLine + 1;
          if (taken > 3000) break;
        }
        sourceTokens = extractContentTokens(parts.join('\n'), fileId) ?? sourceTokens;
      } catch { /* unreadable — fall back to file-level tokens */ }
    }
    if (sourceTokens && index.contentTokenPostings.size > 0) {
      relatedOut = deriveRelatedFiles(fileId, sourceTokens, index, excludeIds);
    }
    // Name-echo: filenames matching the agent's match terms (df-gated,
    // separator-insensitive). Regex specs are skipped — terms only.
    if (params.match && relatedOut.length < RELATED_FILES_CAP) {
      const spec = params.match.trim();
      if (!(spec.length >= 2 && spec.startsWith('/') && spec.endsWith('/'))) {
        const terms = spec.split('|').map(s => s.trim()).filter(s => s.length > 0);
        const echoExclude = new Set([...excludeIds, ...relatedOut.map(r => r.fileId)]);
        relatedOut = [
          ...relatedOut,
          ...deriveNameEchoFiles(terms, index, echoExclude),
        ].slice(0, RELATED_FILES_CAP);
      }
    }
  }

  // Render text.
  const lines: string[] = [`${file.relativePath} (${file.lineCount} lines, importedBy: ${file.importedByCount})`];
  if (viewIsInvalid) {
    lines.push(`[note: view "${String(requestedView)}" is not valid — showing full view. Valid views: ${VALID_VIEWS.join(', ')}.]`);
  }

  if (wantSymbols) {
    if (symbolsOut.length > 0) {
      lines.push('');
      if (matchMissedSymbols) {
        lines.push(`[0 of ${totalSymbolCount} symbols match "${params.match}" — showing all symbols instead:]`);
      }
      lines.push('Symbols:');
      for (const s of symbolsOut) {
        const range = s.startLine === s.endLine ? `[L${s.startLine}]` : `[L${s.startLine}-${s.endLine}]`;
        let line = `${s.indent}${s.kind} ${s.displayName} ${range}`;
        if (s.extendsName) line += ` extends ${s.extendsName}`;
        if (s.implementsNames.length > 0) line += ` implements ${s.implementsNames.join(', ')}`;
        // Inline single caller; newline-per-caller block when ≥2.
        if (wantInlineCallers && s.callers.length > 0) {
          if (s.callers.length <= CALLER_INLINE_MAX) {
            line += `  ← ${s.callers[0]}`;
            lines.push(line);
          } else {
            lines.push(line);
            for (const c of s.callers) {
              lines.push(`${s.indent}    ← ${c}`);
            }
          }
        } else {
          lines.push(line);
        }
      }
      if (truncatedSymbolCount > 0) {
        lines.push(`[+${truncatedSymbolCount} more symbols — pass \`match\` to filter, or \`view: "symbols"\` for full list without callers]`);
      }
    } else if (matchPredicate && totalSymbolCount > 0) {
      lines.push('');
      lines.push(`Symbols: 0 of ${totalSymbolCount} match "${params.match}".`);
    }
  }

  // Expanded callers section (view: 'callers' only)
  if (wantExpandedCallers && callersByName) {
    let totalSyms = 0;
    let shownSyms = 0;
    lines.push('');
    lines.push('Callers (per exported symbol):');
    for (const [symName, callers] of callersByName) {
      totalSyms++;
      if (matchPredicate && !matchPredicate(symName)) continue;
      shownSyms++;
      lines.push(`  ${symName}:`);
      for (const c of callers) lines.push(`    ${c}`);
    }
    if (totalSyms === 0) {
      lines.push('  (no symbol-level callers indexed — no exported symbols, no member-expression call sites, or no callers exist)');
    } else if (matchPredicate && shownSyms === 0) {
      lines.push(`  (0 of ${totalSyms} symbols with callers match "${params.match}")`);
    }
  }

  // Imports
  if (wantImports) {
    const IMPORTS_LIST_THRESHOLD = 15;
    if (importsOut.length > 0) {
      lines.push('');
      if (importsOut.length <= IMPORTS_LIST_THRESHOLD || matchPredicate) {
        lines.push('Imports:');
        for (const p of importsOut) lines.push(p);
      } else {
        lines.push(`Imports: ${importsOut.length} internal files — pass \`match\` to scope this list (substring or /regex/).`);
      }
    } else if (matchPredicate && totalImportCount > 0) {
      lines.push('');
      lines.push(`Imports: 0 of ${totalImportCount} match "${params.match}".`);
    }
  }

  // Importers — section by test/source when both groups present so the agent
  // has a labeled attention slot for test files (they're verification, not
  // peer call sites; agent triages them differently if labeled).
  if (wantImporters) {
    if (importersFiltered > 0) {
      const testImporters = importersShown.filter(isTestPath);
      const sourceImporters = importersShown.filter(p => !isTestPath(p));
      lines.push('');
      lines.push(`Importers (${importersFiltered}${importersExtra > 0 ? `, showing ${importersShown.length}` : ''}):`);
      if (testImporters.length > 0 && sourceImporters.length > 0) {
        lines.push(`  Source (${sourceImporters.length}):`);
        for (const p of sourceImporters) lines.push(`    ${p}`);
        lines.push(`  Tests (${testImporters.length}):`);
        for (const p of testImporters) lines.push(`    ${p}`);
      } else {
        for (const p of importersShown) lines.push(p);
      }
      if (importersExtra > 0) lines.push(`[+${importersExtra} more — narrow with \`match\`]`);
    } else if (matchPredicate && totalImporterCount > 0) {
      lines.push('');
      lines.push(`Importers: 0 of ${totalImporterCount} match "${params.match}" by filename.`);
    }
    // Body references: the grep-replacement answer to "who uses <match>" —
    // files whose CONTENT references the matched term even though their
    // filename doesn't. Repo-wide scan, so the closing exhaustiveness line is
    // a true claim: absence here = no other indexed file names the term.
    if (bodyRefImporters.length > 0) {
      lines.push('');
      lines.push(`Files referencing "${params.match}" in content (${bodyRefTotal}${bodyRefTotal > bodyRefImporters.length ? `, showing ${bodyRefImporters.length}` : ''}) — use-sites the lists above miss:`);
      for (const p of bodyRefImporters) lines.push(`  ${p}`);
      if (bodyRefTotal > bodyRefImporters.length) {
        lines.push(`  The count (${bodyRefTotal}) is exhaustive over indexed file content — exactly that many files reference "${params.match}" as a named identifier; the list is truncated, narrow \`match\` to see the rest. Do not grep to re-verify.`);
      } else {
        lines.push(`  This list is exhaustive over indexed file content: no other file references "${params.match}" as a named identifier. Do not grep to re-verify, and do not hunt for use-sites in other subsystems.`);
      }
    }
  }

  // Related (content-token channel)
  if (relatedOut.length > 0) {
    lines.push('');
    lines.push('Related (shares rare tokens, no import edge — name-reference relations the import graph cannot see):');
    for (const r of relatedOut) {
      if (r.viaName) {
        lines.push(`  ${r.fileId} — filename matches "${r.viaName}"`);
      } else {
        const ids = [r.fileId, ...(r.alsoFileIds ?? [])];
        const names = ids.slice(0, 2).join(', ') + (ids.length > 2 ? ` +${ids.length - 2}` : '');
        const shown = r.tokens.slice(0, 3).map(t => `\`${t}\``).join(', ');
        const extra = r.tokens.length - 3;
        lines.push(`  ${names} — shares ${shown}${extra > 0 ? ` +${extra}` : ''}`);
      }
    }
  }

  // Next-step pointer (only when there's something useful to say)
  const nextHint = computeNextHint({
    hasMatch: !!matchPredicate,
    wantSymbols,
    filteredSymbolCount,
    totalSymbolCount,
  });
  if (nextHint) {
    lines.push('');
    lines.push(nextHint);
  }

  return { __rawText: lines.join('\n') };
}

// Grade-2 caps. Bodies are the expensive payload, so bound them; pointers are
// cheap so they stay generous.
const SLICE_SYMBOL_CAP = 4;      // distinct symbols sliced in one call
const SLICE_LINE_BUDGET = 450;   // total body lines across all slices
const SLICE_CALLEE_CAP = 10;     // callee pointers per symbol

// Resolve requested symbol name(s) → SymbolNodes in `file`, tiered so a bare
// last-segment like `serialize` lands on `Graph.serialize` and never on the
// substring lookalike `serialized_graph`. Tiers, first non-empty wins per name:
//   1. exact full name (`Graph.serialize`)        2. exact last segment (`serialize`)
//   3. case-insensitive substring (last resort, e.g. a typo or partial recall)
function resolveSliceSymbols(file: IndexedFile, spec: string): SymbolNode[] {
  const names = spec.split(/[,|]/).map(s => s.trim()).filter(Boolean);
  const picked = new Map<string, SymbolNode>(); // by symbol id, dedupe
  for (const q of names) {
    const ql = q.toLowerCase();
    const exact = file.symbols.filter(s => s.name.toLowerCase() === ql);
    const lastSeg = exact.length ? exact
      : file.symbols.filter(s => s.name.toLowerCase().split('.').pop() === ql);
    const tier = lastSeg.length ? lastSeg
      : file.symbols.filter(s => s.name.toLowerCase().includes(ql));
    for (const s of tier) picked.set(s.id, s);
  }
  return [...picked.values()].sort((a, b) => a.startLine - b.startLine);
}

// In-tool grep fallback for `--symbol` when no declared symbol matches: locate
// the token(s) in the file body and return the matching line regions with
// context, so the agent never shells out to grep. Caps keep it byte-light.
const CONTENT_CONTEXT = 2;     // context lines each side of a match
const CONTENT_REGION_CAP = 8;  // distinct regions returned
const CONTENT_LINE_CAP = 70;   // total lines returned
function renderContentMatch(file: IndexedFile, spec: string, allLines: string[]): object {
  const terms = spec.split(/[,|]/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const hitLines: number[] = []; // 0-based
  for (let i = 0; i < allLines.length; i++) {
    const low = allLines[i].toLowerCase();
    if (terms.some(t => low.includes(t))) hitLines.push(i);
  }
  if (hitLines.length === 0) {
    const avail = file.symbols
      .filter(s => s.isExported || s.kind === 'class' || s.kind === 'function' || s.kind === 'method')
      .slice(0, 25).map(s => s.name).join(', ');
    return {
      __rawText: `${file.relativePath}: no symbol named "${spec}", and the token does not appear in this file's content either.\n` +
        (avail ? `Declared symbols here: ${avail}${file.symbols.length > 25 ? ', …' : ''}` : 'No top-level symbols indexed in this file.') +
        '\nThe identifier is not in this file — check the file path, or the value may be injected at runtime from elsewhere.',
      error: `no symbol or content match for "${spec}"`,
    };
  }
  // Merge nearby hits into regions.
  const regions: Array<[number, number]> = [];
  for (const ln of hitLines) {
    const start = Math.max(0, ln - CONTENT_CONTEXT);
    const end = Math.min(allLines.length - 1, ln + CONTENT_CONTEXT);
    const last = regions[regions.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else regions.push([start, end]);
  }
  const lines: string[] = [
    `${file.relativePath} (${file.lineCount} lines) — no declared symbol matches "${spec}"; showing ${hitLines.length} content match${hitLines.length === 1 ? '' : 'es'} (in-tool grep, so you don't have to):`,
  ];
  let shown = 0;
  let r = 0;
  for (const [start, end] of regions) {
    if (r >= CONTENT_REGION_CAP || shown >= CONTENT_LINE_CAP) {
      lines.push(`   … [+${regions.length - r} more match regions — narrow \`--symbol\` or read the file]`);
      break;
    }
    r++;
    lines.push('');
    for (let i = start; i <= end && shown < CONTENT_LINE_CAP; i++) {
      lines.push(`${String(i + 1).padStart(5)}  ${allLines[i]}`);
      shown++;
    }
  }
  lines.push('');
  lines.push('These are content matches, not a declared symbol — the token has no static definition here (often runtime/template-injected). Do not grep this file to re-confirm.');
  return { __rawText: lines.join('\n') };
}

function renderSymbolSlice(
  index: CodebaseIndex,
  fileId: string,
  file: IndexedFile,
  spec: string,
): object {
  const wanted = resolveSliceSymbols(file, spec);

  let allLines: string[];
  try {
    allLines = readFileSync(file.path, 'utf-8').split('\n');
  } catch (e) {
    return { error: `could not read ${file.relativePath}: ${e}` };
  }

  // No declared symbol matched — fall back to a CONTENT match (in-tool grep):
  // return the body lines where the requested token(s) live, with context. This
  // is the answer for tokens that have no static symbol (runtime/template-
  // injected data like `arches.termSearchTypes`, string keys, config values) —
  // so the agent gets the body text from the SAME call instead of shelling out
  // to grep and guessing spellings (q19's 5 empty greps).
  if (wanted.length === 0) {
    return renderContentMatch(file, spec, allLines);
  }

  // Caller pointers: reuse the file-level builder (exported symbols only).
  const callersByName = new Map<string, string[]>();
  for (const entry of buildCallersForFile(fileId, file, index)) {
    callersByName.set(entry.exportedSymbol, entry.callers);
  }
  // Callee pointers: resolve this symbol's outgoing calls edges → target location.
  const symInfo = buildSymbolInfoMap(index);
  const locById = new Map<string, { rel: string; start: number; end: number }>();
  for (const f of index.files.values()) {
    for (const s of f.symbols) locById.set(s.id, { rel: f.relativePath, start: s.startLine, end: s.endLine });
  }
  const calleesOf = (symId: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const edge of index.symbolEdges) {
      if (edge.type !== 'calls' || edge.from !== symId) continue;
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      const meta = symInfo.get(edge.to);
      if (!meta) continue;
      const loc = locById.get(edge.to);
      out.push(loc
        ? `${meta.name} → ${loc.rel} [L${loc.start}-${loc.end}]`
        : `${meta.name} → ${meta.file}`);
      if (out.length >= SLICE_CALLEE_CAP) break;
    }
    return out;
  };

  const lines: string[] = [`${file.relativePath} (${file.lineCount} lines) — bodies for: ${wanted.map(s => s.name).join(', ')}`];
  const sliced = wanted.slice(0, SLICE_SYMBOL_CAP);
  if (wanted.length > sliced.length) {
    lines.push(`[${wanted.length} symbols matched; slicing the first ${sliced.length} — narrow \`--symbol\` for the rest: ${wanted.slice(sliced.length).map(s => s.name).join(', ')}]`);
  }

  let spent = 0;
  for (const s of sliced) {
    lines.push('');
    lines.push(`━━ ${s.kind} ${s.name} [L${s.startLine}-${s.endLine}]${s.extendsName ? ` extends ${s.extendsName}` : ''} ━━`);
    const want = s.endLine - s.startLine + 1;
    const room = Math.max(0, SLICE_LINE_BUDGET - spent);
    if (room === 0) {
      lines.push(`   [line budget reached — re-call \`--symbol ${s.name}\` alone to read this body]`);
    } else {
      const take = Math.min(want, room);
      for (let i = s.startLine; i < s.startLine + take && i <= allLines.length; i++) {
        lines.push(`${String(i).padStart(5)}  ${allLines[i - 1]}`);
      }
      if (take < want) lines.push(`   … [+${want - take} more lines truncated by budget — re-call \`--symbol ${s.name}\` alone for the full body]`);
      spent += take;
    }
    // Pointers (not bodies): who calls this, what this calls — each is one directed `--symbol` hop away.
    const callers = callersByName.get(s.name) ?? [];
    if (callers.length) lines.push(`   callers: ${callers.slice(0, 6).join(' · ')}`);
    const callees = calleesOf(s.id);
    if (callees.length) lines.push(`   calls: ${callees.join(' · ')}`);
    if (!callers.length && !callees.length) lines.push('   (no indexed callers/callees)');
  }

  lines.push('');
  lines.push('Bodies delivered inline — no Read needed. Follow `calls:`/`callers:` pointers with another `gs <file> --symbol <name>` to hop without windowing.');
  return { __rawText: lines.join('\n') };
}

function computeNextHint(opts: {
  hasMatch: boolean;
  wantSymbols: boolean;
  filteredSymbolCount: number;
  totalSymbolCount: number;
}): string {
  if (opts.hasMatch && opts.wantSymbols && opts.filteredSymbolCount === 0 && opts.totalSymbolCount > 0) {
    return 'Next: relax or drop `match`; or call again with a narrower `view` (e.g. "imports", "importers").';
  }
  return '';
}

// Full importer list (inbound edges) — capped at IMPORTERS_LIST_CAP at display
// time, not here.
function buildAllImporters(fileId: string, index: CodebaseIndex): string[] {
  const ids = index.inEdges.get(fileId) ?? [];
  return ids
    .map(id => index.files.get(id)?.relativePath)
    .filter((p): p is string => !!p)
    .sort();
}

// Compile a `match` filter for GS. Wrapped in `/.../` → regex; `a|b` →
// OR of case-insensitive substrings; otherwise case-insensitive substring.
// Returns null when no filter is requested or the spec is empty.
function compileMatchPredicate(spec: string | undefined): ((s: string) => boolean) | null {
  if (!spec) return null;
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (trimmed.length >= 2 && trimmed.startsWith('/') && trimmed.endsWith('/')) {
    const body = trimmed.slice(1, -1);
    try {
      const re = new RegExp(body, 'i');
      return (s) => re.test(s);
    } catch {
      // Fall through to substring on malformed regex
    }
  }
  if (trimmed.includes('|')) {
    const alternatives = trimmed
      .split('|')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0);
    if (alternatives.length > 1) {
      return (s) => {
        const lower = s.toLowerCase();
        return alternatives.some(a => lower.includes(a));
      };
    }
  }
  const lower = trimmed.toLowerCase();
  return (s) => s.toLowerCase().includes(lower);
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
