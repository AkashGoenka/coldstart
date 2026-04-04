import type { CodebaseIndex, ArchRole } from '../types.js';

// ============================================================================
// get-overview
// ============================================================================
export function handleGetOverview(
  index: CodebaseIndex,
  params: { domain_filter?: string },
): object {
  const { domain_filter } = params;

  // Language breakdown
  const langCount = new Map<string, number>();
  for (const file of index.files.values()) {
    langCount.set(file.language, (langCount.get(file.language) ?? 0) + 1);
  }

  // Domain breakdown: { domainName: { count, files: { archRole: [path, ...] } } }
  const domainMap = new Map<string, { count: number; files: Map<ArchRole, string[]> }>();
  for (const file of index.files.values()) {
    if (domain_filter && file.domain !== domain_filter) continue;
    if (!domainMap.has(file.domain)) {
      domainMap.set(file.domain, { count: 0, files: new Map() });
    }
    const entry = domainMap.get(file.domain)!;
    entry.count++;
    if (!entry.files.has(file.archRole)) {
      entry.files.set(file.archRole, []);
    }
    const roleFiles = entry.files.get(file.archRole)!;
    if (roleFiles.length < 15) {
      roleFiles.push(file.relativePath);
    }
  }

  // Serialize domains
  const domains: Record<string, { count: number; files: Record<string, string[]> }> = {};
  for (const [dom, entry] of [...domainMap.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const files: Record<string, string[]> = {};
    for (const [role, paths] of entry.files) {
      files[role] = paths;
    }
    domains[dom] = { count: entry.count, files };
  }

  // Inter-domain edges
  const domainEdges = new Map<string, number>();
  for (const edge of index.edges) {
    const fromFile = index.files.get(edge.from);
    const toFile = index.files.get(edge.to);
    if (!fromFile || !toFile) continue;
    if (fromFile.domain === toFile.domain) continue;
    const key = `${fromFile.domain} → ${toFile.domain}`;
    domainEdges.set(key, (domainEdges.get(key) ?? 0) + 1);
  }

  const filteredFiles = domain_filter
    ? [...index.files.values()].filter(f => f.domain === domain_filter)
    : [...index.files.values()];

  return {
    totalFiles: filteredFiles.length,
    totalEdges: index.edges.length,
    languages: Object.fromEntries(
      [...langCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => [lang, count]),
    ),
    domains,
    interDomainEdges: Object.fromEntries(
      [...domainEdges.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([key, count]) => [key, count]),
    ),
    entryPointCount: [...index.files.values()].filter(f => f.isEntryPoint).length,
    indexedAt: new Date(index.indexedAt).toISOString(),
    gitHead: index.gitHead || '(not a git repo)',
    nextStep: 'Use trace-deps to follow dependency chains from an entry point, or get-structure to inspect a specific file\'s exports and imports without reading it.',
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
          domain: neighbor.domain,
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
      domain: file.domain,
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

  return {
    path: file.relativePath,
    language: file.language,
    domain: file.domain,
    archRole: file.archRole,
    isEntryPoint: file.isEntryPoint,
    exports: {
      named: file.exports,
      hasDefault: file.hasDefaultExport,
    },
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
// Helper: find file by path (exact relative, or suffix)
// ============================================================================
function findFileByPath(
  index: CodebaseIndex,
  pathQuery: string,
): [string, (typeof index.files extends Map<string, infer V> ? V : never)] | null {
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
