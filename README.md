# coldstart

Eliminate the AI agent cold start problem. A local MCP server any AI agent
(Claude Code, Cursor, Copilot) can query directly for codebase navigation.
Answers questions instead of dumping a JSON blob.

---

## What it does

`coldstart-mcp` walks your codebase, extracts imports and exports using regex
patterns across 12 languages, builds a dependency graph, and serves four MCP
tools over stdio. AI agents query those tools to find files, trace dependencies,
and understand codebase structure — without reading any source file first.

The tool is a **routing layer**. It returns file pointers, not behavioral
summaries. The agent uses the pointers to decide which files are worth opening.

---

## Install

```bash
# Run directly against any project
npx coldstart-mcp --root /path/to/your/project

# Or install globally
npm install -g coldstart-mcp
coldstart-mcp --root .
```

**Requirements**: Node.js 18+. No other dependencies.

---

## Configure in Claude Code

Add to your MCP settings (`~/.claude/mcp_settings.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "coldstart": {
      "command": "npx",
      "args": ["coldstart-mcp", "--root", "/path/to/your/project"]
    }
  }
}
```

## Configure in Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "coldstart": {
      "command": "npx",
      "args": ["coldstart-mcp", "--root", "."]
    }
  }
}
```

---

## The four MCP tools

### `get-overview`

No required params. Returns total files, language breakdown, domains with file
counts, inter-domain dependency edges, entry points, and top 5 most-imported files.

Optional: `domain_filter` (string) — restrict to a specific domain.

```json
// Request
{ "tool": "get-overview" }

// Response (abbreviated)
{
  "totalFiles": 312,
  "languages": { "typescript": 280, "javascript": 32 },
  "domains": { "auth": 18, "payments": 14, "db": 22, "api": 41 },
  "entryPoints": [{ "path": "src/index.ts", "language": "typescript", "domain": "api" }],
  "hotNodes": [{ "path": "src/db/client.ts", "centrality": 0.0412, "importedBy": 47 }]
}
```

---

### `find-files`

Required: `query` (string). Returns ranked files with path, domain, exports,
centrality score, and reasons for inclusion.

Optional:
- `domain` — filter to one domain
- `limit` — 1–10, default 5
- `prefer_source` — apply stronger penalty to test files

Ranking: TF-IDF (35%) + PageRank (15%) + per-token path/export matches +
exact phrase bonus + domain match + git co-change boost.

```json
// Request
{ "tool": "find-files", "query": "user authentication JWT" }

// Response (abbreviated)
{
  "results": [
    {
      "path": "src/auth/service.ts",
      "domain": "auth",
      "exports": ["AuthService", "login", "validateToken"],
      "centrality": 0.0089,
      "score": 72.4,
      "reasons": ["exact path match: auth", "tfidf: 24.3", "export match (1 tokens): +4"]
    }
  ]
}
```

---

### `trace-deps`

Required: `file_path` (relative path string).

Optional:
- `direction` — `"imports"` | `"importers"` | `"both"` (default: `"both"`)
- `depth` — 1–3 (default: 1)

Returns direct imports and importers for the file, with optional transitive
depth expansion.

```json
// Request
{ "tool": "trace-deps", "file_path": "src/auth/service.ts", "direction": "both" }

// Response (abbreviated)
{
  "file": { "path": "src/auth/service.ts", "domain": "auth" },
  "imports": [
    { "path": "src/db/userRepository.ts", "domain": "db", "depth": 1 }
  ],
  "importers": [
    { "path": "src/api/routes/auth.ts", "domain": "api", "depth": 1 }
  ]
}
```

---

### `get-structure`

Required: `file_path` (relative path string).

Returns full metadata: language, domain, named exports, default export,
internal imports (with resolved paths), external imports, line count, token
estimate, hash, architectural role, and centrality score.

```json
// Request
{ "tool": "get-structure", "file_path": "src/auth/service.ts" }

// Response (abbreviated)
{
  "path": "src/auth/service.ts",
  "language": "typescript",
  "domain": "auth",
  "archRole": "service",
  "exports": { "named": ["AuthService", "hashPassword"], "hasDefault": false },
  "imports": {
    "internal": [{ "specifier": "./userRepository", "resolvedPath": "src/db/userRepository.ts" }],
    "external": ["bcrypt", "jsonwebtoken"]
  },
  "lineCount": 85,
  "tokenEstimate": 420,
  "centrality": 0.0089,
  "importedBy": 6
}
```

---

## Supported languages

TypeScript, JavaScript, Python, Go, Rust, Java, C#, C/C++, Ruby, PHP, Swift,
Kotlin, Dart — 12 languages, ~30 regex patterns total.

---

## How ranking works

1. Tokenize the query (split camelCase, remove stop words, lowercase)
2. Score each file:
   - TF-IDF against a weighted document (basename ×5, dir ×3, exports ×4, domain ×1) — 35% weight
   - PageRank centrality score — 15% weight
   - Per-token path and export match bonuses
   - Exact phrase match in path — large bonus
   - Domain match bonus
3. Apply co-change boost: if file frequently changes alongside the top result, boost it 15%
4. Apply penalties: test files ×0.6, type definition files ×0.7, generated files ×0.5

No ML, no embeddings, no external API calls. Works entirely offline.

---

## CLI flags

```
--root        Project root directory (default: .)
--exclude     Additional directory names to skip (repeatable)
--include     Restrict walk to subdirectory (repeatable)
--cache-dir   Override cache directory (default: ~/.coldstart/indexes/)
--quiet       Suppress stderr logging
--no-cache    Skip cache, always re-index
```

---

## Caching

The index is persisted to `~/.coldstart/indexes/<hash-of-root>/`. On startup,
coldstart checks if the cached index is still valid:

1. Compare current git HEAD to cached HEAD — if changed, re-index
2. Check cache age — re-index if older than 1 hour

Pass `--no-cache` to always build a fresh index.

---

## Limitations

**1. Regex accuracy is ~80–90%.** Dynamic imports, dependency injection
containers, and complex barrel re-exports are sometimes missed. Good enough
for routing decisions; not a substitute for reading the code.

**2. Cross-package imports in monorepos are partially resolved.** tsconfig
path aliases are loaded and applied, but workspace-level cross-package edges
require each package to be indexed separately.

**3. No behavioral summaries.** The tool returns file pointers, exports, and
structural metadata. It does not tell you what a function does or why. The
agent must read the file for implementation detail.

**4. Index becomes stale after large refactors.** The 1-hour TTL and git HEAD
check catch most cases. For immediate accuracy after a large structural change,
run with `--no-cache`.

**5. Files larger than 1MB are skipped.** Generated files and large fixtures
are excluded automatically.

**6. Go module imports are resolved to the module root, not individual packages.**
Full Go workspace resolution requires reading go.mod, which is partially
implemented (module path) but not complete.

---

## What this tool is not

Not a semantic search engine. Not a vector database. Not a RAG pipeline.
Not a replacement for your IDE's built-in index.

It is a routing layer: given a query, it tells the agent which files are
worth reading. That is the complete scope.
