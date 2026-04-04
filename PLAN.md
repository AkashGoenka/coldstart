# Coldstart-MCP Simplification Plan

## Context

After testing against a real 5800-file codebase, `find-files` (TF-IDF + PageRank + co-change search) doesn't outperform agent-native grep/rg. The real value is structural: domain/sector mapping, dependency tracing, and file structure lookup. Strip coldstart down to 3 focused tools.

**Current:** 14 files, ~2,600 lines, 4 tools
**Target:** 11 files, ~1,700 lines, 3 tools

---

## Files to DELETE

1. `src/search/ranker.ts` (188 lines) — find-files scoring logic
2. `src/search/tfidf.ts` (126 lines) — TF-IDF index
3. `src/search/tokenizer.ts` (62 lines) — tokenization (only used by TF-IDF/ranker)

---

## Files to MODIFY (in order)

### 1. `src/types.ts`

- Remove `TFIDFVector` interface
- Remove `QueryResult` interface
- Remove from `CodebaseIndex`: `pagerank`, `cochange`, `tfidf`, `idf`
- Remove from `IndexedFile`: `centrality` field
- Remove from `ParsedFile`: `contentTokens` field
- Add to `IndexedFile`: `importedByCount: number` (replaces PageRank centrality — honest, actionable metric)

### 2. `src/constants.ts`

- Remove `STOP_WORDS` export (~60 lines) — only used by deleted tokenizer

### 3. `src/indexer/parser.ts`

- Remove `extractContentTokens()` function (~65 lines)
- Remove `MAX_CONTENT_TOKENS` constant
- Remove `contentTokens` from `parseFile()` return value
- Remove `import { tokenize }` from search/tokenizer
- Keep: imports, exports, domain, archRole, entryPoint, hash, lineCount, tokenEstimate

### 4. `src/indexer/graph.ts`

- Remove `computePageRank()` function (~50 lines)
- Remove `findHotNodes()` function (~10 lines)
- Remove `detectCycles()` function (~23 lines)
- Keep: `buildGraph()` (needed by trace-deps), `computeDepth()` (useful metadata)

### 5. `src/indexer/git.ts`

- Remove `analyzeGitCoChange()` function (~78 lines)
- Keep: `getGitHead()` (used by cache validation)

### 6. `src/index.ts`

- Remove imports: `buildTFIDFIndex`, `computePageRank`, `analyzeGitCoChange`
- Remove `contentTokensByFile` map collection in parse loop
- Remove pipeline step: PageRank computation
- Remove pipeline step: git co-change analysis (keep `getGitHead()` as standalone call)
- Remove pipeline step: TF-IDF index building
- Remove: centrality assignment loop (`file.centrality = pagerank.get(...)`)
- Add: `file.importedByCount = inEdges.get(file.id)?.length ?? 0` (after graph is built)
- Remove: CLAUDE.md auto-writing block (~17 lines) — presumptuous
- Simplify return: `{ rootDir, files, edges, outEdges, inEdges, indexedAt, gitHead }`

### 7. `src/cache/disk-cache.ts`

- Update serialization/deserialization to exclude removed fields (pagerank, cochange, tfidf, idf)
- Handle loading old cache format gracefully (treat missing fields as empty/rebuild)

### 8. `src/server/tools.ts`

- **Remove** `handleFindFiles()` function entirely (~85 lines)
- **Improve** `handleGetOverview()`:
  - Remove `hotNodes` (PageRank is gone)
  - Add per-domain file listings grouped by archRole:
    ```json
    "domains": {
      "auth": {
        "count": 20,
        "files": {
          "router": ["src/auth/routes.ts"],
          "service": ["src/auth/service.ts"],
          "middleware": ["src/auth/guard.ts"]
        }
      }
    }
    ```
  - Cap at 15 files per archRole per domain (avoid flooding output for huge domains)
  - Keep: languages, interDomainEdges, entryPointCount
  - Update `nextStep` guidance: point to `trace-deps` and `get-structure`, not find-files
- **Update** `handleTraceDeps()`: replace `centrality` with `importedByCount` in output
- **Update** `handleGetStructure()`: replace `centrality` with `importedByCount` in output

### 9. `src/server/mcp.ts`

- Remove `find-files` tool definition and its case handler
- Update tool descriptions if they reference find-files

---

## Verification

1. **Build:** `cd coldstart-mcp && npm run build` — no errors
2. **Grep for dead refs:** `rg "ranker|tfidf|tokenizer|pagerank|cochange|contentTokens|find-files|findFiles|QueryResult|TFIDFVector|STOP_WORDS" src/` — should return nothing
3. **Runtime test:** `node dist/index.js --root <any-project>` — server starts, index builds, logs show only: walking, parsing, resolving, graph building, depth computation
4. **Tool test via MCP client:**
   - `get-overview` returns domain breakdown with file lists per role
   - `trace-deps` works with importedByCount instead of centrality
   - `get-structure` works with importedByCount instead of centrality
   - No `find-files` in tool list
5. **Cache:** Delete old cache, reindex, verify cache saves/loads cleanly

---

## Notes for implementer

- This is a breaking change — bump version in package.json
- Old caches will be incompatible — the cache loader should detect and trigger a rebuild
- After implementation, the `src/search/` directory may be empty — delete it if so
- README update should be done by switching to the model Haiku
- Haiku can then look at the codebase and then modify the necessary md files
