import { findFiles } from '../search/ranker.js';
import { tokenizeQuery } from '../search/tokenizer.js';
// ============================================================================
// get-overview
// ============================================================================
export function handleGetOverview(index, params) {
    const { domain_filter } = params;
    // Language breakdown
    const langCount = new Map();
    for (const file of index.files.values()) {
        langCount.set(file.language, (langCount.get(file.language) ?? 0) + 1);
    }
    // Domain breakdown with file counts
    const domainCount = new Map();
    for (const file of index.files.values()) {
        if (domain_filter && file.domain !== domain_filter)
            continue;
        domainCount.set(file.domain, (domainCount.get(file.domain) ?? 0) + 1);
    }
    // Inter-domain edges
    const domainEdges = new Map();
    for (const edge of index.edges) {
        const fromFile = index.files.get(edge.from);
        const toFile = index.files.get(edge.to);
        if (!fromFile || !toFile)
            continue;
        if (fromFile.domain === toFile.domain)
            continue;
        const key = `${fromFile.domain} → ${toFile.domain}`;
        domainEdges.set(key, (domainEdges.get(key) ?? 0) + 1);
    }
    // Top 5 hot nodes by PageRank
    const sorted = [...index.pagerank.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    const hotNodes = sorted.map(([id, score]) => {
        const f = index.files.get(id);
        return {
            path: f?.relativePath ?? id,
            centrality: Math.round(score * 10000) / 10000,
            importedBy: index.inEdges.get(id)?.length ?? 0,
        };
    });
    // Summary
    const filteredFiles = domain_filter
        ? [...index.files.values()].filter(f => f.domain === domain_filter)
        : [...index.files.values()];
    return {
        totalFiles: filteredFiles.length,
        totalEdges: index.edges.length,
        languages: Object.fromEntries([...langCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([lang, count]) => [lang, count])),
        domains: Object.fromEntries([...domainCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([dom, count]) => [dom, count])),
        interDomainEdges: Object.fromEntries([...domainEdges.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([key, count]) => [key, count])),
        entryPointCount: [...index.files.values()].filter(f => f.isEntryPoint).length,
        hotNodes,
        indexedAt: new Date(index.indexedAt).toISOString(),
        gitHead: index.gitHead || '(not a git repo)',
        nextStep: 'Now call find-files with a domain filter (e.g. domain: "memberships") — do NOT use Glob or Grep yet. find-files ranks candidates by relevance so you read 1-3 targeted files instead of scanning dozens.',
    };
}
// ============================================================================
// find-files
// ============================================================================
export function handleFindFiles(index, params) {
    const results = findFiles(params.query, index, {
        domain: params.domain,
        limit: params.limit,
        preferSource: params.prefer_source,
    });
    const queryTokens = tokenizeQuery(params.query);
    // Check if a result's domain matches any query token
    function domainMatchesQuery(domain) {
        const domainLower = domain.toLowerCase();
        return queryTokens.some(tok => domainLower.includes(tok) || tok.includes(domainLower));
    }
    // Per-result confidence, capped at "medium" if domain doesn't match query
    function getConfidence(score, domain) {
        const raw = score >= 30 ? 'high' : score >= 10 ? 'medium' : 'low';
        // If domain doesn't match any query token, cap at medium
        if (raw === 'high' && !domainMatchesQuery(domain)) {
            return 'medium';
        }
        return raw;
    }
    // Domain spread warning
    const uniqueDomains = new Set(results.map(r => r.domain));
    const domainSpreadWarning = uniqueDomains.size >= 3
        ? `Results span ${uniqueDomains.size} domains (${[...uniqueDomains].join(', ')}). Call get-overview first, then retry find-files with a domain filter for more accurate results.`
        : undefined;
    const topScore = results[0]?.score ?? 0;
    const topConfidence = results.length > 0
        ? getConfidence(topScore, results[0].domain)
        : 'low';
    const overallConfidence = domainSpreadWarning ? (topConfidence === 'high' ? 'medium' : topConfidence) : topConfidence;
    const overallRecommendation = domainSpreadWarning
        ? domainSpreadWarning
        : overallConfidence === 'high'
            ? 'Read top result(s) directly — strong match.'
            : overallConfidence === 'medium'
                ? 'Read top results, then verify with a targeted Grep if needed.'
                : 'Weak match — use these as hints and supplement with Grep.';
    return {
        query: params.query,
        confidence: overallConfidence,
        recommendation: overallRecommendation,
        ...(domainSpreadWarning ? { warning: domainSpreadWarning } : {}),
        results: results.map(r => {
            const confidence = getConfidence(r.score, r.domain);
            const recommendation = confidence === 'high'
                ? 'Read directly.'
                : confidence === 'medium'
                    ? 'Read and verify with targeted Grep.'
                    : 'Low confidence — treat as a hint only.';
            return {
                path: r.relativePath,
                language: r.language,
                domain: r.domain,
                archRole: r.archRole,
                isEntryPoint: r.isEntryPoint,
                exports: r.exports,
                centrality: r.centrality,
                score: r.score,
                confidence,
                recommendation,
                reasons: r.reasons,
            };
        }),
        totalResults: results.length,
    };
}
// ============================================================================
// trace-deps
// ============================================================================
export function handleTraceDeps(index, params) {
    const direction = params.direction ?? 'both';
    const maxDepth = Math.min(params.depth ?? 1, 3);
    // Find file by relative path (or suffix match)
    const fileEntry = findFileByPath(index, params.file_path);
    if (!fileEntry) {
        return { error: `File not found: ${params.file_path}` };
    }
    const [fileId, file] = fileEntry;
    function collectDeps(startId, getNeighbors, depth) {
        const visited = new Set();
        const result = [];
        function traverse(id, currentDepth) {
            if (currentDepth > depth || visited.has(id))
                return;
            visited.add(id);
            for (const neighborId of getNeighbors(id)) {
                if (visited.has(neighborId))
                    continue;
                const neighbor = index.files.get(neighborId);
                if (!neighbor)
                    continue;
                result.push({
                    path: neighbor.relativePath,
                    language: neighbor.language,
                    domain: neighbor.domain,
                    archRole: neighbor.archRole,
                    exports: neighbor.exports.slice(0, 10),
                    centrality: Math.round((index.pagerank.get(neighborId) ?? 0) * 10000) / 10000,
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
    const response = {
        file: {
            path: file.relativePath,
            language: file.language,
            domain: file.domain,
            archRole: file.archRole,
        },
    };
    if (direction === 'imports' || direction === 'both') {
        response.imports = collectDeps(fileId, id => index.outEdges.get(id) ?? [], maxDepth);
    }
    if (direction === 'importers' || direction === 'both') {
        response.importers = collectDeps(fileId, id => index.inEdges.get(id) ?? [], maxDepth);
    }
    return response;
}
// ============================================================================
// get-structure
// ============================================================================
export function handleGetStructure(index, params) {
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
        centrality: Math.round((index.pagerank.get(fileId) ?? 0) * 10000) / 10000,
        importedBy: index.inEdges.get(fileId)?.length ?? 0,
        imports_count: index.outEdges.get(fileId)?.length ?? 0,
    };
}
// ============================================================================
// Helper: find file by path (exact relative, or suffix)
// ============================================================================
function findFileByPath(index, pathQuery) {
    // Normalize
    const normalized = pathQuery.replace(/\\/g, '/');
    // Exact match first
    if (index.files.has(normalized)) {
        return [normalized, index.files.get(normalized)];
    }
    // Suffix match
    for (const [id, file] of index.files) {
        if (id.endsWith(normalized) || id.includes(normalized)) {
            return [id, file];
        }
    }
    return null;
}
//# sourceMappingURL=tools.js.map