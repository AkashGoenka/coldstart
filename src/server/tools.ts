import type { CodebaseIndex, IndexedFile } from '../types.js';
import { IDF_RARITY_THRESHOLD } from '../constants.js';
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
  return `${path} matched: [${matched.join(', ')}]`;
}

const GO_FOOTER =
  'Next: `get-structure` the best `[matched]` fit; reformulate only if no result fits.';

// ============================================================================
// get-overview
// ============================================================================

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
    // Group results by match channel. Section order = first appearance, which
    // preserves global rank: the top-ranked result leads its section and sections
    // are ordered by their best-ranked member; rank order WITHIN a section is kept.
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
      for (const r of groups.get(ch)!) lines.push('  ' + formatResultLine(r));
    }
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
    lines.push('Next: GO indexes declared names only. For content in templates, SQL, comments, docstrings, config — use grep (scope by file extension).');
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

  if (wantSymbols) {
    const baseFiltered = file.symbols
      .filter(s => s.isExported || s.kind === 'class' || s.kind === 'function' || s.kind === 'method')
      .slice()
      .sort((a, b) => a.startLine - b.startLine);
    totalSymbolCount = baseFiltered.length;

    const filtered = matchPredicate
      ? baseFiltered.filter(s => matchPredicate(s.name))
      : baseFiltered;
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
      !matchPredicate &&
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
  if (wantImporters) {
    const allImporters = buildAllImporters(fileId, index);
    totalImporterCount = allImporters.length;
    const filteredImporters = matchPredicate
      ? allImporters.filter(p => matchPredicate(p))
      : allImporters;
    importersFiltered = filteredImporters.length;
    importersShown = filteredImporters.slice(0, IMPORTERS_LIST_CAP);
    importersExtra = filteredImporters.length - importersShown.length;
  }

  // Render text.
  const lines: string[] = [`${file.relativePath} (${file.lineCount} lines, importedBy: ${file.importedByCount})`];
  if (viewIsInvalid) {
    lines.push(`[note: view "${String(requestedView)}" is not valid — showing full view. Valid views: ${VALID_VIEWS.join(', ')}.]`);
  }

  if (wantSymbols) {
    if (symbolsOut.length > 0) {
      lines.push('');
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
      lines.push(`Importers: 0 of ${totalImporterCount} match "${params.match}".`);
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
