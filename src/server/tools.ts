import type { CodebaseIndex, IndexedFile } from '../types.js';
import { IDF_RARITY_THRESHOLD } from '../constants.js';
import {
  TEST_QUERY_KEYWORDS,
  parseConceptGroups,
  expandQueryToken,
  matchFile,
  compareMatches,
  type MatchResult,
} from './scoring.js';
import { compileGlob, matchesGlob } from './glob.js';

export { parseConceptGroups, matchFile, type MatchResult };

// Per-result importer cap. Evidence, not exhaustive.
const IMPORTERS_PER_RESULT = 8;
function buildImportersFor(fileId: string, index: CodebaseIndex): string[] {
  const ids = index.inEdges.get(fileId) ?? [];
  return ids
    .map(id => index.files.get(id)?.relativePath)
    .filter((p): p is string => !!p)
    .sort()
    .slice(0, IMPORTERS_PER_RESULT);
}

// Find a file by exact relative path, then suffix, then substring.
function findFileForCallers(
  index: CodebaseIndex,
  query: string,
): { fileId: string; file: IndexedFile } | null {
  const normalized = query.replace(/\\/g, '/');
  const direct = index.files.get(normalized);
  if (direct) return { fileId: normalized, file: direct };
  for (const [id, file] of index.files) {
    if (id === normalized) return { fileId: id, file };
  }
  for (const [id, file] of index.files) {
    if (id.endsWith(normalized)) return { fileId: id, file };
  }
  for (const [id, file] of index.files) {
    if (id.includes(normalized)) return { fileId: id, file };
  }
  return null;
}

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

// Build a single result entry. Includes `importers` evidence when requested.
function buildResultEntry(
  m: MatchResult,
  index: CodebaseIndex,
  withImporters: boolean,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    path: m.path,
    matched: formatMatchedTokens(m, index),
  };
  if (withImporters) {
    entry.importers = buildImportersFor(m.path, index);
  }
  return entry;
}

// Format matched tokens for a result: rarest first (lowest docFreq). The agent's
// navigation loop runs on identifiers — emitting the names GO matched on lets
// the agent lift them directly into its next grep. docFreq drives the sort but
// isn't emitted; the parenthetical noise (`dropdown(2)`) confused readers more
// than it helped, and rarity is implicit in the rank order.
const MATCHED_TOKENS_PER_RESULT = 6;
function formatMatchedTokens(m: MatchResult, index: CodebaseIndex): string[] {
  const tokens = [...m.allMatchedTokens];
  tokens.sort(
    (a, b) =>
      (index.tokenDocFreq.get(a) ?? 1) - (index.tokenDocFreq.get(b) ?? 1),
  );
  return tokens.slice(0, MATCHED_TOKENS_PER_RESULT);
}

// ============================================================================
// get-overview
// ============================================================================

export function handleGetOverview(
  index: CodebaseIndex,
  params: {
    domain_filter?: string;
    max_results?: number;
    include_tests?: boolean;
    path?: string;
    with_importers?: boolean;
    callers_for?: string | string[];
  },
): object {
  const {
    domain_filter,
    max_results = 10,
    include_tests = false,
    path: pathSpec,
    with_importers = false,
    callers_for,
  } = params;

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
    const results = fallbackMatched
      .slice(0, max_results)
      .map(m => buildResultEntry(m, index, with_importers));

    const response: Record<string, unknown> = { filter: domain_filter };

    if (fallbackMatched.length === 0) {
      response.results = [];
      response.note = 'No declared names match this query. Likely places this concept lives: string literals, comments, docstrings, templates, SQL, or config files — GO does not index those. Grep is the right next tool (consider scoping by file extension).';
    } else {
      response.fallback = true;
      response.note = 'No exact-name matches; these are broad substring fallbacks (treat as soft signal). If your query is about content (strings/comments/templates), grep is more reliable — GO indexes only declared names.';
      response.results = results;
      if (truncated) {
        response.truncated = true;
        response.message = `[TRUNCATED: ${fallbackMatched.length - max_results} additional fallback matches omitted.]`;
      }
    }

    if (excludedTestCount > 0) {
      response.excluded_test_files = excludedTestCount;
      response.hint = 'Test files were excluded. Pass include_tests: true to include them.';
    }

    attachPathExclusion(response, excludedByPathCount, pathSpec);
    attachCallersFor(response, index, callers_for);

    return response;
  }

  // Truncation
  const truncated = afterB.length > max_results;
  const results = afterB
    .slice(0, max_results)
    .map(m => buildResultEntry(m, index, with_importers));

  const response: Record<string, unknown> = {
    filter: domain_filter,
    results,
  };

  if (truncated) {
    response.truncated = true;
    response.message = `[TRUNCATED: ${afterB.length - max_results} additional matches omitted.] Next move: if a path above is the file you want, call get-structure on it; if a rare matched token (low docFreq) names what you are looking for, grep that token across the repo to find usages. Do not reformulate GO — the top results above are the best declared-name matches.`;
  }

  if (excludedTestCount > 0) {
    response.excluded_test_files = excludedTestCount;
    response.hint = 'Test files were excluded. Pass include_tests: true to include them.';
  }

  attachPathExclusion(response, excludedByPathCount, pathSpec);
  attachCallersFor(response, index, callers_for);

  return response;
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

function attachCallersFor(
  response: Record<string, unknown>,
  index: CodebaseIndex,
  callers_for: string | string[] | undefined,
): void {
  if (!callers_for) return;
  const targets = Array.isArray(callers_for) ? callers_for : [callers_for];
  const callers: Record<string, unknown> = {};
  for (const t of targets) {
    const found = findFileForCallers(index, t);
    if (!found) {
      callers[t] = { error: 'File not found.' };
      continue;
    }
    const perSymbol = buildCallersForFile(found.fileId, found.file, index);
    if (perSymbol.length === 0) {
      callers[found.file.relativePath] = {
        note: 'No symbol-level callers indexed (no exported symbols, member-expression call sites, or no callers exist).',
      };
    } else {
      callers[found.file.relativePath] = perSymbol;
    }
  }
  response.callers = callers;
}

// ============================================================================
// get-structure (merged drill-down: symbols + 1-hop internal imports)
// ============================================================================
export function handleGetStructure(
  index: CodebaseIndex,
  params: {
    file_path: string;
    match?: string;
    view?: 'symbols' | 'imports' | 'both';
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

  const view = params.view ?? 'both';
  const matchPredicate = compileMatchPredicate(params.match);

  const lines: string[] = [`${file.relativePath} (${file.lineCount} lines, importedBy: ${file.importedByCount})`];

  // Symbols section
  let filteredSymbolCount = 0;
  let totalSymbolCount = 0;
  if (view === 'symbols' || view === 'both') {
    // One per line, indented under parent class when applicable
    const baseFiltered = file.symbols
      .filter(s => s.isExported || s.kind === 'class' || s.kind === 'function')
      .slice()
      .sort((a, b) => a.startLine - b.startLine);
    totalSymbolCount = baseFiltered.length;

    const filtered = matchPredicate
      ? baseFiltered.filter(s => matchPredicate(s.name))
      : baseFiltered;
    filteredSymbolCount = filtered.length;

    if (filtered.length > 0) {
      lines.push('');
      lines.push('Symbols:');
      let lastClassName: string | null = null;
      for (const s of filtered) {
        let displayName = s.name;
        let indent = '';
        if (lastClassName && s.name.startsWith(lastClassName + '.')) {
          displayName = s.name.slice(lastClassName.length + 1);
          indent = '  ';
        } else if (s.kind === 'class') {
          lastClassName = s.name;
        }
        const range = s.startLine === s.endLine ? `[${s.startLine}]` : `[${s.startLine}-${s.endLine}]`;
        let line = `${indent}${s.kind} ${displayName} ${range}`;
        if (s.extendsName) line += ` extends ${s.extendsName}`;
        if (s.implementsNames.length > 0) line += ` implements ${s.implementsNames.join(', ')}`;
        lines.push(line);
      }
    } else if (matchPredicate && totalSymbolCount > 0) {
      lines.push('');
      lines.push(`Symbols: 0 of ${totalSymbolCount} match "${params.match}".`);
    }
  }

  // Imports — internal only, bare paths, deduped. Above IMPORTS_LIST_THRESHOLD
  // we suggest narrowing with `match` instead of dumping the whole list.
  if (view === 'imports' || view === 'both') {
    const IMPORTS_LIST_THRESHOLD = 15;
    const internalImports = [...new Set(
      index.edges
        .filter(e => e.from === fileId)
        .map(e => index.files.get(e.to)?.relativePath)
        .filter((p): p is string => !!p)
    )];

    const totalImportCount = internalImports.length;
    const filteredImports = matchPredicate
      ? internalImports.filter(p => matchPredicate(p))
      : internalImports;

    if (filteredImports.length > 0) {
      lines.push('');
      if (filteredImports.length <= IMPORTS_LIST_THRESHOLD || matchPredicate) {
        // When the user has scoped with `match`, show the full filtered list
        // regardless of count — they asked for it.
        lines.push('Imports:');
        for (const p of filteredImports) lines.push(p);
      } else {
        lines.push(`Imports: ${filteredImports.length} internal files — pass \`match\` to scope this list (substring or /regex/).`);
      }
    } else if (matchPredicate && totalImportCount > 0) {
      lines.push('');
      lines.push(`Imports: 0 of ${totalImportCount} match "${params.match}".`);
    }
  }

  // Next-step pointer — bake into output so the agent sees the chain options
  // without relying on CLAUDE.md / SKILL.md (which it routinely ignores).
  lines.push('');
  if (matchPredicate && filteredSymbolCount === 0 && totalSymbolCount > 0) {
    lines.push('Next: relax or drop `match`; or call this file with `view: "imports"` to see imports only.');
  } else {
    lines.push('Next: to see who imports this file, call `get-overview` with `with_importers: true` (or `callers_for: "<this file>"` for symbol-level callers). Open the file with Read only when you need actual implementation.');
  }

  return { __rawText: lines.join('\n') };
}

// Compile a `match` filter for GS. Wrapped in `/.../` → regex; otherwise
// case-insensitive substring. Returns null when no filter is requested or
// the spec is empty.
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
