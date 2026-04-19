import type { CodebaseIndex } from '../types.js';
import { tokenizeName } from '../indexer/tokenize.js';

const TEST_KEYWORDS = new Set(['test', 'spec', 'mock', 'fixture', 'stub']);
const TEST_PATH_RE = /\.(test|spec)\.[^.]+$|__tests__\/|\/tests?\/|\/e2e[-_]?tests?\/|\/test-framework\//i;

/**
 * Parse a domain_filter string into concept groups.
 * - [auth|login|jwt] → one group with synonyms (OR logic)
 * - bare words → one group per word (AND logic across groups)
 * - Each group is satisfied if ANY of its tokens match the file's domains.
 */
function parseConceptGroups(input: string): string[][] {
  const groups: string[][] = [];
  const segmentRe = /\[([^\]]+)\]|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = segmentRe.exec(input)) !== null) {
    if (match[1] !== undefined) {
      // Bracket group: split by | and tokenize each synonym
      const synonyms = match[1].split('|').flatMap(s => tokenizeName(s.trim())).filter(Boolean);
      if (synonyms.length > 0) groups.push(synonyms);
    } else if (match[2] !== undefined) {
      // Bare segment: tokenize as a single concept group
      const tokens = tokenizeName(match[2]);
      if (tokens.length > 0) groups.push(tokens);
    }
  }
  return groups;
}

// ============================================================================
// get-overview
// ============================================================================
export function handleGetOverview(
  index: CodebaseIndex,
  params: {
    domain_filter?: string;
    threshold_pct?: number;
    max_results?: number;
  },
): object {
  const { domain_filter, threshold_pct = 0.30, max_results = 20 } = params;

  if (!domain_filter) {
    return {
      error: 'domain_filter is required',
      hint: 'Provide one or more keywords relevant to your task (e.g. "auth", "payment user"). Use your knowledge of the task to supply keywords. Synonym groups: "[auth|login|jwt] payment".',
      totalFiles: index.files.size,
    };
  }

  const conceptGroups = parseConceptGroups(domain_filter);
  if (conceptGroups.length === 0) {
    return { error: 'domain_filter produced no usable tokens after filtering stop words.' };
  }

  const allTokens = conceptGroups.flat();
  const isTestQuery = allTokens.some(t => TEST_KEYWORDS.has(t));
  const totalFiles = index.files.size;

  type ScoredFile = {
    path: string;
    score: number;
    matched_tokens: string[];
    matched_concepts: number;
    total_concepts: number;
    coverage: number;
    allExact: boolean;
  };

  const scored: ScoredFile[] = [];

  for (const file of index.files.values()) {
    // Exclude barrels — they re-export children and pollute results
    if (file.isBarrel) continue;
    // Exclude test files for non-test queries
    if (!isTestQuery && (file.archRole === 'test' || TEST_PATH_RE.test(file.relativePath))) {
      continue;
    }

    let idfSum = 0;
    let matchedGroupCount = 0;
    const matchedTokens: string[] = [];
    let allExact = true;

    for (const group of conceptGroups) {
      // Find best-IDF matching token in this group
      let bestToken: string | null = null;
      let bestIdf = -1;
      let bestIsExact = false;
      for (const token of group) {
        // Exact match, or substring match in either direction:
        // - query contains domain: e.g. query "authentication" contains indexed token "auth"
        // - domain contains query: only for long domain tokens (>6 chars) to avoid
        //   short generic tokens matching everything
        const matchingDomain = file.domains.find(
          d => d === token
            || (d.length >= 4 && token.length > d.length && token.includes(d))
            || (d.length > 6 && d.length > token.length && d.includes(token))
        );
        if (matchingDomain) {
          const isExact = matchingDomain === token;
          const docFreq = index.tokenDocFreq.get(matchingDomain) ?? 1;
          const idf = Math.log(totalFiles / docFreq);
          if (idf > bestIdf) { bestIdf = idf; bestToken = matchingDomain; bestIsExact = isExact; }
        }
      }
      if (bestToken !== null) {
        matchedGroupCount++;
        matchedTokens.push(bestToken);
        idfSum += bestIdf;
        if (!bestIsExact) allExact = false;
      }
    }

    if (matchedGroupCount === 0) continue;

    const coverage = matchedGroupCount / conceptGroups.length;
    const score = idfSum * coverage * coverage;

    scored.push({
      path: file.relativePath,
      score,
      matched_tokens: matchedTokens,
      matched_concepts: matchedGroupCount,
      total_concepts: conceptGroups.length,
      coverage,
      allExact,
    });
  }

  const totalBeforeFiltering = scored.length;

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Apply relative threshold
  const topScore = scored[0]?.score ?? 0;
  const threshold = topScore * threshold_pct;
  const afterThreshold = scored.filter(f => f.score >= threshold);

  // If any result matched all concepts exactly, drop substring-only results.
  // This eliminates noise from generic tokens (e.g. "group" matching for "grouphub" query)
  // while preserving substring matches as a fallback when no exact matches exist.
  const hasAnyAllExact = afterThreshold.some(f => f.allExact);
  const filtered = hasAnyAllExact ? afterThreshold.filter(f => f.allExact) : afterThreshold;

  // Hard cap
  const results = filtered.slice(0, max_results);

  // Score distribution
  const scores = results.map(f => f.score);
  const median = scores.length > 0 ? scores[Math.floor(scores.length / 2)] : 0;

  return {
    totalFiles,
    filter: domain_filter,
    conceptGroups,
    total_matches_before_filtering: totalBeforeFiltering,
    results: results.map(({ allExact: _, ...r }) => r),
    score_distribution: {
      top: topScore,
      median,
      threshold,
    },
    indexedAt: new Date(index.indexedAt).toISOString(),
    gitHead: index.gitHead || '(not a git repo)',
  };
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
          domains: neighbor.domains,
          archRole: neighbor.archRole,
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
      domains: file.domains,
      archRole: file.archRole,
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
      return target ? { specifier: e.specifier, resolvedPath: target.relativePath, type: e.type } : null;
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
    language: file.language,
    domains: file.domains,
    archRole: file.archRole,
    isEntryPoint: file.isEntryPoint,
    exports: {
      named: file.exports,
      hasDefault: file.hasDefaultExport,
    },
    ...(symbolSummary ? { symbols: symbolSummary } : {}),
    imports: {
      internal: internalImports,
      external: externalImports,
    },
    lineCount: file.lineCount,
    tokenEstimate: file.tokenEstimate,
    hash: file.hash,
    importedByCount: file.importedByCount,
    imports_count: index.outEdges.get(fileId)?.length ?? 0,
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
