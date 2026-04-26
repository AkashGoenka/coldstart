import type { CodebaseIndex, DomainToken } from '../types.js';
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
function parseConceptGroups(input: string): string[][] {
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
function expandQueryToken(token: string): string[] {
  const forms = [token];
  if (token.length >= 5) {
    if (token.endsWith('es') && token.length > 4) {
      const singular = token.slice(0, -2);
      if (singular.length >= 4) forms.push(singular);
    } else if (token.endsWith('s')) {
      const singular = token.slice(0, -1);
      if (singular.length >= 4) forms.push(singular);
    } else {
      // Also try adding 's' and 'es' to match plural indexed forms
      forms.push(token + 's');
      forms.push(token + 'es');
    }
  }
  return forms;
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
  },
): object {
  const { domain_filter, max_results = 15, include_tests = false } = params;

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

  type MatchResult = {
    path: string;
    matchedDomainTokens: DomainToken[];   // one per matched concept group
    matchedGroupCount: number;
  };

  const matched: MatchResult[] = [];

  for (const file of index.files.values()) {
    // Exclude barrels — keep path/filename tokens but barrels themselves are noise results
    if (file.isBarrel) continue;
    // Exclude test/automation files for non-test queries
    if (!isTestQuery && file.isTestFile) {
      continue;
    }

    const domains = file.domains as DomainToken[];
    let matchedGroupCount = 0;
    const matchedDomainTokens: DomainToken[] = [];

    for (const group of conceptGroups) {
      let bestMatch: DomainToken | null = null;
      outer: for (const queryToken of group) {
        const expanded = expandQueryToken(queryToken);
        for (const qt of expanded) {
          for (const dt of domains) {
            const isMatch =
              dt.token === qt
              || (dt.token.length > 6 && dt.token.length > qt.length && dt.token.includes(qt));
            if (isMatch) {
              bestMatch = dt;
              break outer;
            }
          }
        }
      }
      if (bestMatch !== null) {
        matchedGroupCount++;
        matchedDomainTokens.push(bestMatch);
      }
    }

    if (matchedGroupCount === 0) continue;

    matched.push({ path: file.relativePath, matchedDomainTokens, matchedGroupCount });
  }

  // Predicate B: rarity OR multi-concept coverage
  const afterB = matched.filter(m => {
    const hasRareToken = m.matchedDomainTokens.some(dt => {
      const docFreq = index.tokenDocFreq.get(dt.token) ?? 1;
      const idf = Math.log(totalFiles / docFreq);
      return idf > IDF_RARITY_THRESHOLD;
    });
    const hasMultipleConcepts = m.matchedGroupCount > 1;
    return hasRareToken || hasMultipleConcepts;
  });

  // Sort by how many concept groups the file matched (descending), alphabetical tiebreaker
  afterB.sort((a, b) =>
    b.matchedGroupCount - a.matchedGroupCount || a.path.localeCompare(b.path),
  );

  // Truncation
  const truncated = afterB.length > max_results;
  const results = afterB.slice(0, max_results);

  const resultItems = results.map(m => m.path);

  const response: Record<string, unknown> = {
    filter: domain_filter,
    results: resultItems,
  };

  if (truncated) {
    response.truncated = true;
    response.message = `[TRUNCATED: ${afterB.length - max_results} additional matches omitted. If a filename above looks right, call get-structure on it. Otherwise narrow your query by adding a more specific token.]`;
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
