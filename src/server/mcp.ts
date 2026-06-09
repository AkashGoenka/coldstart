import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListRootsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { IndexContext } from '../index-manager.js';
import {
  handleGetOverview,
  handleGetStructure,
} from './tools.js';

// ---------------------------------------------------------------------------
// Tool definitions — shared between the stdio server and HTTP daemon sessions
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  {
    name: 'get-overview',
    description:
      'Locate files by matching `query` against DECLARED NAMES — filenames, path segments, exported symbols. Reach for GO BEFORE Read/Grep/Glob when finding which files are relevant.\n\n' +
      'OUTPUT: `<path> [tok1, tok2, ...]` per result. Bracketed tokens are the matched name tokens, rarest-first (leftmost = highest signal).\n\n' +
      'CAPABILITIES:\n' +
      '- Naming-variant tolerant — case, separators, plural ≡ singular. `LoadStaging` ≡ `load_staging` ≡ `load-staging`; `tile` ≡ `tiles`. Pass the concept; do NOT grep-alternate spellings.\n' +
      '- Multi-concept — `auth payment` (AND), `[auth|login|jwt] payment` (OR), plus a small built-in synonym set (auth/login/jwt, search/find/query, message/post/chat).\n' +
      '- `path: "arches/app/**/*.py"` — glob scope; comma-combine; `!` to exclude.\n' +
      '- `include_tests: true` — opt in to tests (excluded by default).\n\n' +
      'DOES NOT MATCH:\n' +
      '- File body content (comments, docstrings, strings, HTML/template, SQL) → grep.\n' +
      '- Import specifiers (by design).\n' +
      '- Nested symbols → use `get-structure`.\n\n' +
      'AFTER THE RESULT:\n' +
      '1. Path looks right → `get-structure` on it. Default returns symbols + imports + per-symbol callers + importers in one shot — that is your "who uses this" answer.\n' +
      '2. Leading `[matched]` token names your concept but the path is off → re-call GO with that token (~10× cheaper than bash-grep).\n' +
      '3. Query words missing from every `[matched]` list → concept lives in body content; grep, scoped by file extension.\n\n' +
      'FRAMEWORK CONVENTION FILES (page.tsx, route.ts, __init__.py): query by directory name — the filename is generic.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Concept tokens for the thing you are looking for. Bare words = AND across concepts; `[a|b]` = OR within a synonym group. camelCase accepted. Designed to be re-called: lift a rare token from a prior result\'s `[matched]` list into the next `query`. If `[matched]` lists do not contain your query words, GO does not index where this concept lives (try grep) — not "the query is wrong".',
        },
        max_results: {
          type: 'number',
          description: 'Page size, default 10. The top results are the best-scored declared-name matches; reformulate `query` before paging deep.',
        },
        include_tests: {
          type: 'boolean',
          description: 'Include test and automation files. Default false.',
        },
        path: {
          type: 'string',
          description: 'Minimatch-style glob to scope where to look (e.g. "arches/app/**/*.py", "src/auth/**", "**/*.htm"). Comma-separate to combine; prefix with "!" to exclude (e.g. "src/**,!**/legacy/**"). Supports `**`, `*`, `?` and `!` negation; brace `{a,b}` and char-class `[abc]` are NOT supported. Filters before ranking, so a focused glob produces sharper results than a broad query. If a path filter is supplied but matches no candidate files you will see `excluded_by_path` and `path_filter` on the response — re-check syntax there.',
        },
        page: {
          type: 'number',
          description: 'Results page (default 1). Prefer reformulating `query` over paging.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get-structure',
    description:
      'Drill into a known file. Returns four sections as compact text:\n' +
      '- Symbols — top-level + per-class methods (name, kind, line range, extends/implements). With cross-file callers attached per exported symbol (inline if 1 caller; newline-per-caller block if ≥2). For huge files (>20 symbols, no `match`), symbols are reordered by caller count (most-used first) and truncated to top 15.\n' +
      '- Imports — 1-hop internal outbound dependencies (library imports stripped).\n' +
      '- Importers — 1-hop reverse: files in this repo that import this one.\n' +
      'Use this AFTER get-overview surfaces a candidate file. This is the right tool for "who uses this file" / "who calls this symbol" — no separate call needed.\n\n' +
      '`view` controls which sections you get (default `full` = all four). `symbols`, `imports`, `importers`, `callers` each return one section in isolation when you want a byte-light answer.\n\n' +
      'For god-files (large classes, large routers, large config modules), pass `match` to filter symbols/imports/importers/callers to one area — e.g. `match: "auth"` or `match: "/^handle/"`. Substring is case-insensitive; wrap in slashes for regex.\n\n' +
      'Prefer this over Read when you need shape, neighbors, or usage. Reach for Read only for implementation details inside a method body. If you have called get-structure on 5+ files for one question, you are enumerating — go back to GO with a sharper `path` glob or a different concept token instead.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path to the file (e.g. "src/auth/service.ts"). Suffix matches are accepted.',
        },
        match: {
          type: 'string',
          description: 'Filter all sections by name. Substring (case-insensitive) by default; use `|` to OR substrings (`match: "resource|tile"`); wrap in slashes for regex (`match: "/^handle/"`). Use this on large/god-files to avoid a wall of output — e.g. `match: "tile"` on a big models.py reduces output to just tile-related symbols, their callers, and matching imports/importers.',
        },
        view: {
          type: 'string',
          enum: ['full', 'symbols', 'imports', 'importers', 'callers'],
          description: 'Which sections to return. Default "full" = symbols (with inline callers) + imports + importers. Use one of the narrower views to halve or quarter the output when you know what you need: "symbols" (shape only, no callers), "imports" (outbound only), "importers" (inbound only), "callers" (per-symbol cross-file callers in expanded form, no symbol shape).',
        },
      },
      required: ['file_path'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Shared handler registration — used by stdio server and HTTP daemon sessions
// ---------------------------------------------------------------------------
export function registerToolHandlers(
  server: Server,
  getContext: () => Promise<IndexContext>,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

    let ctx: IndexContext;
    try {
      ctx = await getContext();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Index build failed — restart the MCP server.';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
        isError: true,
      };
    }
    const { index, isRebuilding } = ctx;

    let result: object;

    switch (name) {
      case 'get-overview':
        result = handleGetOverview(index, {
          query: (params['query'] ?? params['domain_filter']) as string | undefined,
          max_results: params['max_results'] as number | undefined,
          include_tests: params['include_tests'] as boolean | undefined,
          path: params['path'] as string | undefined,
          page: params['page'] as number | undefined,
        });
        break;

      case 'get-structure':
        result = handleGetStructure(index, {
          file_path: (params['file_path'] ?? params['file'] ?? params['file_name']) as string,
          match: params['match'] as string | undefined,
          view: params['view'] as 'full' | 'symbols' | 'imports' | 'importers' | 'callers' | undefined,
        });
        break;

      default:
        result = { error: `Unknown tool: ${name}` };
    }

    // _indexStatus deliberately dropped: per-call byte savings on hot path; if
    // the agent needs a stale-snapshot warning it is one query away via GO.
    void isRebuilding;

    const isError = 'error' in result;
    const rawText = (result as { __rawText?: string }).__rawText;
    return {
      content: [{ type: 'text', text: rawText !== undefined ? rawText : JSON.stringify(result, null, 2) }],
      isError,
    };
  });
}

// ---------------------------------------------------------------------------
// Factory — creates a fully wired MCP server (used per-session in HTTP daemon)
// ---------------------------------------------------------------------------
export function createMcpServer(getContext: () => Promise<IndexContext>): Server {
  const server = new Server(
    { name: 'coldstart-mcp', version: '3.0.0' },
    { capabilities: { tools: {} } },
  );
  registerToolHandlers(server, getContext);
  return server;
}

// ---------------------------------------------------------------------------
// Stdio MCP server — traditional single-process mode (--no-daemon)
// ---------------------------------------------------------------------------
export async function startMCPServer(
  onReady: (clientRoots: string[]) => Promise<void>,
  getContext: () => Promise<IndexContext>,
): Promise<void> {
  const server = createMcpServer(getContext);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // After connect, ask for roots — cap at 1s so standalone runs don't stall
  let clientRoots: string[] = [];
  try {
    const result = await server.request(
      { method: 'roots/list' },
      ListRootsResultSchema,
      { timeout: 1000 },
    );
    if (result && result.roots && result.roots.length > 0) {
      clientRoots = result.roots.map((r: any) => r.uri);
    }
  } catch {
    // Client might not support roots/list, or timed out — proceed with CLI root
  }

  await onReady(clientRoots);
}
