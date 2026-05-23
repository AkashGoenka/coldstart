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

// Per-result importer cap. Evidence, not exhaustive — agent uses trace-deps
// (until Phase 3 removes it; same semantics will move to a dedicated tool).
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
// caller-symbol/line pairs. Evidence shape, not exhaustive — Phase 3 will fold
// trace-impact's full output into a future scoped form.
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

  // Imports — internal only, bare paths, deduped.
  // Above IMPORTS_LIST_THRESHOLD we show only the count + pointer to trace-deps,
  // since agents skim long lists and `trace-deps` is the right tool for a full list.
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
        lines.push(`Imports: ${filteredImports.length} internal files — use trace-deps for the list.`);
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
    lines.push('Next: trace-deps on this file (direction: "importers") to see who imports it; trace-impact <symbol> on any symbol above to see callers/implementors. Open the file with Read only when you need actual implementation.');
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

  // Drop high-fanout neighbors (shared utils, contexts, enums) — they're
  // almost never on the path to the answer and they bloat the result.
  const FANOUT_CAP = 30;
  let skippedHighFanout = 0;

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
        if (neighbor.importedByCount > FANOUT_CAP) {
          skippedHighFanout++;
          continue;
        }
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

  if (skippedHighFanout > 0) {
    response.skippedHighFanout = skippedHighFanout;
    response.note = `Omitted ${skippedHighFanout} neighbor(s) with importedByCount > ${FANOUT_CAP} (shared utils/contexts/enums — rarely on the path to a feature).`;
  }

  return response;
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
    // Phase B: annotation-name fallback. If no symbol is named `symbol`,
    // check whether any symbol bears it as an annotation (e.g. `@Transactional`).
    const annotated = findSymbolsByAnnotation(index, symbol);
    if (annotated.length > 0) {
      const affected = [...new Set(annotated.map(a => a.fileEntry.relativePath))].sort();
      return {
        target: { symbol: `@${symbol}`, type: 'annotation', matchedVia: 'annotation' },
        annotatedSymbols: annotated.map(a => ({
          symbol: a.name,
          file: a.fileEntry.relativePath,
          line: a.startLine,
          type: a.kind,
        })),
        summary: {
          totalAnnotated: annotated.length,
          affectedFiles: affected,
          note: `No symbol named "${symbol}". ${annotated.length} symbol(s) annotated with @${symbol} below.`,
        },
      };
    }

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
  const symInEdges = new Map<string, Array<{ from: string; type: string; line?: number }>>();

  for (const edge of index.symbolEdges) {
    if (edge.type === 'exports') continue;
    if (!symInEdges.has(edge.to)) symInEdges.set(edge.to, []);
    symInEdges.get(edge.to)!.push({ from: edge.from, type: edge.type, line: edge.line });
  }

  // -------------------------------------------------------------------------
  // Step 3: BFS traversal from target
  // -------------------------------------------------------------------------
  type ImpactEntry = {
    symbolId: string;
    depth: number;
    path: string[];     // symbolIds from target → this node
    relationship: string;
    callLine?: number;  // line in the caller's file where the call to its callee occurs (calls edges)
  };

  const visited = new Set<string>([target.id]);
  const impacted: ImpactEntry[] = [];

  // Queue items
  const queue: Array<{ id: string; depth: number; path: string[]; rel: string; line?: number }> = [];

  for (const inc of symInEdges.get(target.id) ?? []) {
    if (!visited.has(inc.from)) {
      queue.push({ id: inc.from, depth: 1, path: [target.id, inc.from], rel: inc.type, line: inc.line });
    }
  }

  while (queue.length > 0) {
    const { id, depth, path, rel, line } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    impacted.push({ symbolId: id, depth, path, relationship: rel, callLine: line });

    if (depth >= maxDepth) continue;

    for (const inc of symInEdges.get(id) ?? []) {
      if (!visited.has(inc.from)) {
        queue.push({ id: inc.from, depth: depth + 1, path: [...path, inc.from], rel: inc.type, line: inc.line });
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

  // -------------------------------------------------------------------------
  // Step 6: If no symbol-level impact, fall back to file-level importers
  // This covers languages where calls are member expressions (obj.method())
  // that don't produce symbol edges.
  // -------------------------------------------------------------------------
  let fileImporters: string[] | undefined;
  if (impacted.length === 0) {
    // Find the fileId for the target symbol's file
    const targetFileId = findFileIdByRelativePath(index, target.fileEntry.relativePath);
    if (targetFileId) {
      const importerIds = index.inEdges.get(targetFileId) ?? [];
      fileImporters = importerIds
        .map(id => index.files.get(id)?.relativePath)
        .filter((p): p is string => p !== undefined)
        .sort();
    }
  }

  const targetLocation = `${target.fileEntry.relativePath}:${target.startLine}`;

  return {
    target: {
      symbol: target.name,
      file: target.fileEntry.relativePath,
      line: target.startLine,
      type: target.kind,
    },
    impacted: displayImpacted.map(entry => {
      const info = resolveId(entry.symbolId);
      // Format: "file:line (in callerSymbol)" when line is known, else "file (in callerSymbol)".
      // Graceful fallback for older indexes / extractors that have not been backfilled.
      const hasLine = typeof entry.callLine === 'number' && entry.callLine > 0;
      const location = hasLine
        ? `${info.file}:${entry.callLine} (in ${info.name})`
        : `${info.file} (in ${info.name})`;
      return {
        symbol: info.name,
        file: info.file,
        ...(hasLine ? { line: entry.callLine } : {}),
        location,
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
    ...(impacted.length === 0 ? {
      fallback: 'file-level',
      ...(fileImporters && fileImporters.length > 0
        ? {
            fileImporters,
            note: `Defined at ${targetLocation}. No symbol-level callers indexed (common causes: member-expression calls like obj.method() that did not resolve, or no callers exist). fileImporters below shows files importing this file — start there.`,
          }
        : {
            note: `Defined at ${targetLocation}. No callers indexed and no files import this file — symbol is an entry point, unused, or invoked dynamically. If you only needed to locate the definition, you have it.`,
          }),
    } : {}),
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
): Array<{ id: string; name: string; kind: string; startLine: number; fileEntry: IndexedFileLike }> {
  const results: Array<{ id: string; name: string; kind: string; startLine: number; fileEntry: IndexedFileLike }> = [];

  // Suffixes for qualified names: Ruby uses ::, Java/TS use .
  const qualifiedSuffixes = ['::' + symbolName, '.' + symbolName];

  const searchIn = (file: IndexedFileLike) => {
    for (const sym of file.symbols) {
      if (sym.name === symbolName) {
        results.push({ id: sym.id, name: sym.name, kind: sym.kind, startLine: sym.startLine, fileEntry: file });
      }
    }
  };

  // Suffix match: find symbols ending with ::SymbolName or .SymbolName
  const searchInSuffix = (file: IndexedFileLike) => {
    for (const sym of file.symbols) {
      if (qualifiedSuffixes.some(suffix => sym.name.endsWith(suffix))) {
        results.push({ id: sym.id, name: sym.name, kind: sym.kind, startLine: sym.startLine, fileEntry: file });
      }
    }
  };

  if (filePath) {
    const fileEntry = findFileByPath(index, filePath);
    if (fileEntry) {
      searchIn(fileEntry[1]);
      // Fall back to suffix match in that file — handles the case where the
      // ambiguity error returned a qualified name (e.g. "Class.method") but
      // the user retries with the bare name ("method").
      if (results.length === 0) searchInSuffix(fileEntry[1]);
    }
  } else {
    // Try exact match first
    for (const file of index.files.values()) {
      searchIn(file);
    }
    // Fall back to suffix match if no exact hits
    if (results.length === 0) {
      for (const file of index.files.values()) {
        searchInSuffix(file);
      }
    }
  }

  return results;
}

// ============================================================================
// Helper: find symbols bearing a given annotation (Java/Kotlin)
// ============================================================================
function findSymbolsByAnnotation(
  index: CodebaseIndex,
  annotationName: string,
): Array<{ id: string; name: string; kind: string; startLine: number; fileEntry: IndexedFileLike }> {
  const results: Array<{ id: string; name: string; kind: string; startLine: number; fileEntry: IndexedFileLike }> = [];
  for (const file of index.files.values()) {
    for (const sym of file.symbols) {
      if (sym.annotations?.includes(annotationName)) {
        results.push({ id: sym.id, name: sym.name, kind: sym.kind, startLine: sym.startLine, fileEntry: file });
      }
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
// Helper: find fileId by relative path (for file-level graph lookups)
// ============================================================================
function findFileIdByRelativePath(index: CodebaseIndex, relativePath: string): string | null {
  for (const [id, file] of index.files) {
    if (file.relativePath === relativePath) return id;
  }
  return null;
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
