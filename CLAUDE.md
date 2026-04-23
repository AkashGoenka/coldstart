# coldstart-mcp

MCP server that indexes a codebase and exposes structural intelligence to AI agents via four tools: `get-overview`, `get-structure`, `trace-deps`, `trace-impact`. Agents call these instead of reading files to answer questions about exports, dependencies, and blast radius of changes.

Pipeline: walk → parse (Tree-sitter for TS/JS/Java/Ruby/Python/Go/Rust/C#/PHP/Kotlin) → resolve imports → build graph → serve over stdio.

Key files: `src/index.ts` (entry), `src/indexer/` (walk/parse/resolve/graph), `src/server/` (MCP protocol + tool handlers), `src/cache/disk-cache.ts`, `src/types.ts`, `src/constants.ts`.
