#!/usr/bin/env node
/**
 * coldstart-mcp — Local MCP server for AI agent codebase navigation.
 *
 * Usage:
 *   coldstart-mcp --root /path/to/project
 *   coldstart-mcp --root . --exclude vendor --quiet
 *   coldstart-mcp --root . --no-cache
 */
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { walkDirectory } from './indexer/walker.js';
import { parseFile, buildFileId } from './indexer/parser.js';
import { resolveImports } from './indexer/resolver.js';
import { buildGraph, computePageRank, computeDepth } from './indexer/graph.js';
import { analyzeGitCoChange, getGitHead } from './indexer/git.js';
import { buildTFIDFIndex } from './search/tfidf.js';
import { loadCachedIndex, saveCachedIndex } from './cache/disk-cache.js';
import { startMCPServer } from './server/mcp.js';
// ---------------------------------------------------------------------------
// Argument parsing (no external deps)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const args = argv.slice(2);
    let root = '.';
    const excludes = [];
    const includes = [];
    let cacheDir;
    let quiet = false;
    let noCache = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--root':
                root = args[++i] ?? root;
                break;
            case '--exclude':
                excludes.push(args[++i] ?? '');
                break;
            case '--include':
                includes.push(args[++i] ?? '');
                break;
            case '--cache-dir':
                cacheDir = args[++i];
                break;
            case '--quiet':
                quiet = true;
                break;
            case '--no-cache':
                noCache = true;
                break;
        }
    }
    return { root, excludes, includes, cacheDir, quiet, noCache };
}
// ---------------------------------------------------------------------------
// Logging (to stderr so stdout stays clean for MCP)
// ---------------------------------------------------------------------------
function log(quiet, ...args) {
    if (!quiet)
        process.stderr.write(args.join(' ') + '\n');
}
// ---------------------------------------------------------------------------
// Full indexing pipeline
// ---------------------------------------------------------------------------
async function buildIndex(rootDir, excludes, includes, quiet) {
    const start = Date.now();
    // 1. Walk
    log(quiet, '[coldstart] Walking filesystem...');
    const walkedFiles = await walkDirectory({ rootDir, excludes, includes });
    log(quiet, `[coldstart] Found ${walkedFiles.length} source files`);
    // 2. Parse
    log(quiet, '[coldstart] Parsing files...');
    const indexedFiles = [];
    const contentTokensByFile = new Map();
    const langCount = {};
    await Promise.all(walkedFiles.map(async (wf) => {
        const parsed = await parseFile(wf.absolutePath, wf.language);
        if (!parsed)
            return;
        const id = buildFileId(wf.relativePath);
        contentTokensByFile.set(id, parsed.contentTokens);
        const file = {
            id,
            path: wf.absolutePath,
            relativePath: wf.relativePath,
            language: wf.language,
            domain: parsed.domain,
            exports: parsed.exports,
            hasDefaultExport: parsed.hasDefaultExport,
            imports: parsed.imports,
            hash: parsed.hash,
            lineCount: parsed.lineCount,
            tokenEstimate: parsed.tokenEstimate,
            isEntryPoint: parsed.isEntryPoint,
            archRole: parsed.archRole,
            centrality: 0,
            depth: Infinity,
        };
        indexedFiles.push(file);
        langCount[wf.language] = (langCount[wf.language] ?? 0) + 1;
    }));
    // 3. Resolve imports → edges
    log(quiet, '[coldstart] Resolving imports...');
    const { edges, unresolved } = await resolveImports(indexedFiles, rootDir);
    log(quiet, `[coldstart] Resolved ${edges.length} edges (${unresolved.length} unresolved)`);
    // 4. Build graph
    const nodeIds = indexedFiles.map(f => f.id);
    const { outEdges, inEdges } = buildGraph(nodeIds, edges);
    // 5. PageRank
    log(quiet, '[coldstart] Computing PageRank...');
    const pagerank = computePageRank(nodeIds, outEdges);
    // 6. Depth from entry points
    const entryPointIds = indexedFiles.filter(f => f.isEntryPoint).map(f => f.id);
    const depthMap = computeDepth(entryPointIds, outEdges);
    // Attach pagerank and depth back to files
    for (const file of indexedFiles) {
        file.centrality = pagerank.get(file.id) ?? 0;
        file.depth = depthMap.get(file.id) ?? Infinity;
    }
    // 7. Git co-change
    log(quiet, '[coldstart] Analyzing git co-change...');
    const [cochange, gitHead] = await Promise.all([
        analyzeGitCoChange(rootDir),
        getGitHead(rootDir),
    ]);
    // 8. TF-IDF
    log(quiet, '[coldstart] Building TF-IDF index...');
    const { vectors: tfidf, idf } = buildTFIDFIndex(indexedFiles, contentTokensByFile);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(quiet, `[coldstart] Indexed ${indexedFiles.length} files in ${elapsed}s`);
    log(quiet, `[coldstart] Languages: ${Object.entries(langCount).map(([l, c]) => `${l}(${c})`).join(', ')}`);
    const filesMap = new Map(indexedFiles.map(f => [f.id, f]));
    return {
        rootDir,
        files: filesMap,
        edges,
        outEdges,
        inEdges,
        pagerank,
        cochange,
        tfidf,
        idf,
        indexedAt: Date.now(),
        gitHead,
    };
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const { root, excludes, includes, cacheDir, quiet, noCache } = parseArgs(process.argv);
    const rootDir = resolve(root);
    log(quiet, `[coldstart] Starting — root: ${rootDir}`);
    let index = null;
    // Try cache first
    if (!noCache) {
        index = await loadCachedIndex(rootDir, cacheDir);
        if (index) {
            log(quiet, '[coldstart] Loaded from cache');
        }
    }
    // Build fresh index if needed
    if (!index) {
        index = await buildIndex(rootDir, excludes, includes, quiet);
        if (!noCache) {
            try {
                await saveCachedIndex(index, cacheDir);
                log(quiet, '[coldstart] Index saved to cache');
            }
            catch (err) {
                log(quiet, `[coldstart] Warning: could not save cache: ${err}`);
            }
        }
    }
    // Write CLAUDE.md to target codebase root to enforce coldstart workflow
    const claudeMdPath = join(rootDir, 'CLAUDE.md');
    const claudeMdContent = `# coldstart navigation rules

This codebase has been indexed by coldstart-mcp. When exploring it, follow these rules:

1. Call \`get-overview\` before any file search, Glob, or Grep — it returns domain structure and hot nodes at zero file-read cost.
2. Call \`find-files\` before Glob or Grep when looking for files by topic — it ranks candidates so you read 1-3 targeted files instead of scanning dozens.
3. Call \`get-structure\` before reading a file when you only need to know its exports, imports, or size — it costs zero tokens.
4. Only use Glob or Grep when \`find-files\` confidence is "low" and targeted verification is needed.
`;
    try {
        await writeFile(claudeMdPath, claudeMdContent, { flag: 'wx' }); // wx = fail if exists
        log(quiet, '[coldstart] Wrote CLAUDE.md to codebase root');
    }
    catch (err) {
        if (err.code !== 'EEXIST') {
            log(quiet, `[coldstart] Warning: could not write CLAUDE.md: ${err}`);
        }
    }
    // Start MCP server
    log(quiet, '[coldstart] MCP server ready');
    await startMCPServer(index);
}
main().catch(err => {
    process.stderr.write(`[coldstart] Fatal error: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map