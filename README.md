# coldstart

`coldstart-mcp` is a local MCP server that helps AI agents navigate unfamiliar codebases without reading hundreds of files first.

It focuses on 3 structural jobs:
- Domain mapping (`get-overview`)
- Dependency tracing (`trace-deps`)
- File shape inspection (`get-structure`)

No embeddings, no external API calls, no cloud dependency.

---

## Why this exists

The original approach (`coldstart_map.json`) was a static data dump. In practice, agents work better with small, direct answers from tool calls than with one large JSON blob.

This repo has been intentionally downscoped to be a fast routing layer, not a ranking engine.

---

## Current scope

The MCP server exposes exactly 3 tools:

1. `get-overview`
2. `trace-deps`
3. `get-structure`

`find-files` and all TF-IDF/PageRank/co-change code were removed after real-world testing showed limited benefit versus agent-native grep/rg.

---

## Install

```bash
# Run without installing
npx coldstart-mcp --root /path/to/project

# Or install globally
npm install -g coldstart-mcp
coldstart-mcp --root .
```

Requirements:
- Node.js 18+

---

## Configure MCP

Claude Code / Claude Desktop:

```json
{
  "mcpServers": {
    "coldstart": {
      "command": "npx",
      "args": ["coldstart-mcp", "--root", "/path/to/project"]
    }
  }
}
```

Cursor (`.cursor/mcp.json`):

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

## Tool reference

### `get-overview`

Optional params:
- `domain_filter` (string)

Returns:
- Total files and edges
- Language breakdown
- Domains with files grouped by architectural role
- Inter-domain dependency edges
- Entry point count
- Index timestamp and git head

Use this first to decide where to look before searching or opening files.

### `trace-deps`

Required params:
- `file_path` (string)

Optional params:
- `direction`: `imports` | `importers` | `both` (default `both`)
- `depth`: `1-3` (default `1`)

Returns transitive dependency relationships and lightweight metadata (domain, role, exports, `importedByCount`).

### `get-structure`

Required params:
- `file_path` (string)

Returns per-file metadata:
- language, domain, role, entry-point flag
- named exports + default export flag
- internal imports (resolved) and external imports
- line count, token estimate, hash
- `importedByCount`, direct imports count

---

## How indexing works

1. Walk source files (skip hidden dirs, symlinks, large files)
2. Parse imports/exports with language-specific regex
3. Resolve internal imports to graph edges (including tsconfig/jsconfig aliases)
4. Build graph adjacency maps
5. Compute BFS depth from entry points
6. Start MCP server with in-memory index

Supported languages: TypeScript, JavaScript, Python, Go, Rust, Java, C#, C/C++, Ruby, PHP, Swift, Kotlin, Dart.

---

## CLI flags

```txt
--root        Project root directory (default: .)
--exclude     Additional directory names to skip (repeatable)
--include     Restrict walk to subdirectory (repeatable)
--cache-dir   Override cache directory (default: ~/.coldstart/indexes/)
--quiet       Suppress stderr logging
--no-cache    Skip cache and always rebuild index
```

---

## Cache behavior

Indexes are stored in:

`~/.coldstart/indexes/<hash-of-root>/`

Current cache reuse checks are:
- Schema/version match
- Cache age under 1 hour

If either fails, the index is rebuilt.

---

## Limitations

1. Regex extraction is approximate, not AST-accurate.
2. Complex/dynamic import patterns can be missed.
3. It is a routing layer, not a behavior summarizer.
4. Hidden directories are skipped by default.
5. Files over 1 MB are ignored.

