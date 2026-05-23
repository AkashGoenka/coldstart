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
      'Locate files by matching your query against DECLARED NAMES — filenames, directory path segments, and exported symbol names. GO does NOT match file BODIES (comments, docstrings, string literals, HTML/template content, SQL); for those, grep is the correct tool. Templates, stylesheets, JSON, and markdown ARE indexed by filename and path tokens, just not by body content.\n\n' +
      'GO is the entry point: reach for it BEFORE Read/Grep/Glob when you need to find which files are relevant. The agent loop runs on identifiers — GO hands you the identifiers (in `matched`) and the file paths; you take it from there.\n\n' +
      'OUTPUT: each result is `{ path, matched }`. `matched` is the list of indexed name tokens that triggered this match, sorted rarest-first (fewest files contain the token = first in the list). The leading tokens are the high-signal identifiers — names unique enough that grepping them reliably finds usages, callers, or in-body references.\n\n' +
      'HOW TO CONSUME THE OUTPUT:\n' +
      '1. If a path looks like the file you need → call `get-structure` on it (then `Read` if you need implementation).\n' +
      '2. If the path is not exactly right but a leading matched token names what you are looking for (e.g. queried "tile sort order", got `matched: ["loadstaging_sortorder", "sortorder", ...]`) → grep that token across the repo. The matched token is the codebase\'s actual name for your concept.\n' +
      '3. If your query words DO NOT appear in any `matched` list → the concept is not in any declared name. Likely places: string literals, comments, docstrings, templates, SQL, config — GO does not index those. Grep with file-type scoping is the right next move; do NOT keep reformulating GO.\n\n' +
      'SCOPING AND EVIDENCE — use these instead of follow-up calls:\n' +
      '- `path` (glob) — when you already know the area: `path: "arches/app/**"`, `path: "**/*.htm"`, or with negation `path: "src/**,!**/legacy/**"`. Filters before ranking; sharper than a broad query.\n' +
      '- `with_importers: true` — attaches `importers: [paths]` per result (cheap). Use when you also want one-hop reverse context (who consumes this).\n' +
      '- `callers_for: "src/foo.ts"` — attaches a top-level `callers` map for the named file(s): each exported symbol with its cross-file callers (file:line). Expensive — only request for files you have already decided to drill into; do not blanket-request for every result.\n\n' +
      'FRAMEWORK CONVENTION FILES (page.tsx, route.ts, __init__.py): query by directory name — the filename is generic.',
    inputSchema: {
      type: 'object',
      properties: {
        domain_filter: {
          type: 'string',
          description: 'Concept tokens for the thing you are looking for. Bare words = AND across concepts; `[a|b]` = OR within a synonym group. camelCase accepted. If `matched` tokens in the response do not contain your query words, GO does not index where this concept lives (try grep) — it is not "the query is wrong".',
        },
        max_results: {
          type: 'number',
          description: 'Page size, default 10. The top results are the best-scored declared-name matches — if none of them are what you want, more pages will not help; switch to grep (concept is in bodies/strings/templates) or to a more specific identifier you saw in a matched token.',
        },
        include_tests: {
          type: 'boolean',
          description: 'Include test and automation files. Default false.',
        },
        path: {
          type: 'string',
          description: 'Minimatch-style glob to scope where to look (e.g. "arches/app/**/*.py", "src/auth/**", "**/*.htm"). Comma-separate to combine; prefix with "!" to exclude (e.g. "src/**,!**/legacy/**"). Supports `**`, `*`, `?` and `!` negation; brace `{a,b}` and char-class `[abc]` are NOT supported. Filters before ranking, so a focused glob produces sharper results than a broad query. If a path filter is supplied but matches no candidate files you will see `excluded_by_path` and `path_filter` on the response — re-check syntax there.',
        },
        with_importers: {
          type: 'boolean',
          description: 'When true, each result gets an `importers: [paths]` field listing up to 8 files that import it. Cheap. Use when you want one-hop reverse context inline with the search (e.g. to see which routes/handlers consume a service module surfaced by GO).',
        },
        callers_for: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description: 'A file path (or list of paths) for which GO should attach symbol-level callers as a top-level `callers` map. For each named file the entry is either an array `[{ exportedSymbol, callers: ["file:line (caller)", ...] }, ...]` (only exported symbols with at least one cross-file caller appear) or `{ note: "..." }` when nothing is indexed (no exports, member-expression call sites, or no callers). If the file path cannot be resolved you get `{ error: "File not found." }`. Expensive — pass only files you have already decided to drill into; do not blanket-request callers for every result. This is the right tool for "who calls this symbol" once you know which file owns the symbol.',
        },
      },
      required: ['domain_filter'],
    },
  },
  {
    name: 'get-structure',
    description:
      'Drill into a specific file: returns its top-level symbols (exported symbols + all top-level classes and functions, with name, kind, line range, extends/implements) and its 1-hop internal imports as a compact text block. Symbols nested below the top level are not listed. Use this AFTER get-overview surfaces a candidate file, to decide whether to open it in full.\n\n' +
      'Output is compact text, not JSON: one symbol per line, methods indented under their parent class. Library/external imports are stripped — only internal repo paths are shown.\n\n' +
      'For god-files (large classes, large routers, large config modules), pass `match` to filter both symbols and imports to the area you care about — e.g. `match: "auth"` or `match: "/^handle/"`. Substring is case-insensitive; wrap in slashes for regex. Without `match`, very large files still show all symbols/imports.\n\n' +
      'Prefer this over Read when you only need shape or imports. Reach for Read when you need actual implementation details. If you have called get-structure on 5+ files for one question, you are enumerating — go back to GO with a sharper `path` glob or a different concept token instead.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path to the file (e.g. "src/auth/service.ts"). Suffix matches are accepted.',
        },
        match: {
          type: 'string',
          description: 'Filter both symbols and imports by name. Substring (case-insensitive) by default; wrap in slashes for regex: "/^handle/". Use this on large/god-files to avoid a 90-line dump — e.g. `match: "tile"` on a big models.py reduces output to just tile-related symbols and imports.',
        },
        view: {
          type: 'string',
          enum: ['symbols', 'imports', 'both'],
          description: 'Which section to return. Default "both". Use "symbols" or "imports" when you know which one you need to halve the output.',
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
          domain_filter: params['domain_filter'] as string | undefined,
          max_results: params['max_results'] as number | undefined,
          include_tests: params['include_tests'] as boolean | undefined,
          path: params['path'] as string | undefined,
          with_importers: params['with_importers'] as boolean | undefined,
          callers_for: params['callers_for'] as string | string[] | undefined,
        });
        break;

      case 'get-structure':
        result = handleGetStructure(index, {
          file_path: (params['file_path'] ?? params['file'] ?? params['file_name']) as string,
          match: params['match'] as string | undefined,
          view: params['view'] as 'symbols' | 'imports' | 'both' | undefined,
        });
        break;

      default:
        result = { error: `Unknown tool: ${name}` };
    }

    if (isRebuilding) {
      (result as Record<string, unknown>)['_indexStatus'] = 'rebuilding — results from previous snapshot';
    }

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
