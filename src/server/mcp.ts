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
  handleTraceDeps,
  handleGetStructure,
  handleTraceImpact,
} from './tools.js';

// ---------------------------------------------------------------------------
// Tool definitions — shared between the stdio server and HTTP daemon sessions
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  {
    name: 'get-overview',
    description:
      'Locate files in the codebase by keyword, symbol name, filename, or path tokens. Returns a ranked list of relative file paths — nothing else.\n\n' +
      'This is your primary entry point. Use it BEFORE Read/Grep/Glob/Bash when you need to find which files are relevant to a task.\n\n' +
      'INDEXING: tokens come from directory path segments, filenames, and exported symbol names. Both split tokens AND lowercased compounds are indexed (e.g. "UsersPage" → "users" + "userspage"). You can query camelCase/PascalCase directly — do not decompose it yourself.\n\n' +
      'PAGE SIZE: `max_results` is 7. If the right file is not in the top 7, your query is wrong — refine it with different keywords, synonyms via `[a|b]`, or a more specific token. Pagination almost never helps.\n\n' +
      'TEST FILES: excluded by default. Pass `include_tests: true` if your task is about test/automation code.\n\n' +
      'FRAMEWORK CONVENTION FILES (page.tsx, route.ts, layout.tsx): query by directory name — the filename is generic, the directory uniquely identifies them.\n\n' +
      'NEXT STEPS after get-overview: to inspect a specific candidate file (its symbols + 1-hop imports), call `get-structure` on its path. For reverse lookups (who imports this file), use `trace-deps` with `direction: "importers"`. For symbol-level callers/implementors, use `trace-impact`. Avoid reading source files just to check structure — these tools return that as structured data.',
    inputSchema: {
      type: 'object',
      properties: {
        domain_filter: {
          type: 'string',
          description: 'One or more keywords relevant to your task. Bare words are independent concepts (AND logic). Bracket groups are synonyms (OR within): "[auth|login|jwt] payment". Accepts camelCase ("UsersPage") and partial matches ("workspace" matches "workspaces"). If results are missing your target, retry with the codebase\'s own terms (e.g. "post"→"Message", "edit"→"Update").',
        },
        max_results: {
          type: 'number',
          description: 'Page size, default 7. Do not increase this to "see more" — if the right file is not in the top 7, refine the query instead.',
        },
        include_tests: {
          type: 'boolean',
          description: 'Include test and automation files. Default false.',
        },
      },
      required: ['domain_filter'],
    },
  },
  {
    name: 'get-structure',
    description:
      'Drill into a specific file: returns its symbols (name, kind, line range, extends/implements) and its 1-hop internal imports as a compact text block. Use this AFTER get-overview surfaces a candidate file, to decide whether to open it in full.\n\n' +
      'Output is compact text, not JSON: one symbol per line, methods indented under their parent class. Library/external imports are stripped — only internal repo paths are shown.\n\n' +
      'Prefer this over Read when you only need shape or imports. Reach for Read when you need actual implementation details.\n\n' +
      'If you have called get-structure on 5+ files for one question, you are enumerating — switch to trace-deps (file graph) or trace-impact (symbol graph) to expand in one call instead of opening more files one-by-one.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path to the file (e.g. "src/auth/service.ts"). Suffix matches are accepted.',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'trace-deps',
    description:
      'Who depends on this file? Lists every file that imports it, directly or transitively. Reach for this BEFORE grepping for import paths or opening files just to check their dependents.\n\n' +
      'Also accepts the outgoing direction (what this file imports) — most useful with depth 2-3 for transitive reach. For a file\'s direct 1-hop imports, get-structure already returns them inline.\n\n' +
      'Secondary use — blast-radius: before changing a file, list its importers to scope what\'s affected.\n\n' +
      'Default depth 1; raise to 2-3 for transitive reach.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path to the file (e.g. "src/auth/service.ts"). Suffix matches are accepted.',
        },
        direction: {
          type: 'string',
          enum: ['imports', 'importers', 'both'],
          description: 'Which direction to trace (default: "both").',
        },
        depth: {
          type: 'number',
          description: 'Levels of transitive deps to include (1-3, default 1).',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'trace-impact',
    description:
      'Locate where a symbol is defined and find every caller, implementor, and extender. Use this whenever you have an exact function/class/constant name — to jump to its definition, find its callsites, or trace inheritance chains. The response always includes `target.file` and `target.line` for the definition site, even when there are zero callers.\n\n' +
      'This is your fastest path to "where is X defined" and "who uses X" — reach for it BEFORE grepping `def foo`, `class Foo`, or `FOO_CONSTANT`. One call returns the definition plus the full caller/implementor set, which matters most for interface methods, listener/handler hooks, and cross-cutting concerns where callsites are scattered.\n\n' +
      'Also accepts a Java/Kotlin annotation name (e.g. `Transactional`, `OnUserRegistered`): if no symbol matches by name, the response lists every symbol bearing `@<name>` as `annotatedSymbols`. Use this instead of grepping for `@SomeAnnotation`.\n\n' +
      'Secondary use — blast-radius: when you\'re about to change a symbol, the same response tells you what depends on it.\n\n' +
      'Limitations: (1) only top-level and one-level-nested symbols are indexed. (2) If `impacted` comes back empty, the response includes a file-level fallback and an explicit "Defined at" note — use that, do not retry with grep. (3) Inheritance chains (extends/implements) are the most reliable signal.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name (e.g. "validateToken", "AuthService", "UserDTO").',
        },
        file: {
          type: 'string',
          description: 'Optional file path to disambiguate when the symbol name appears in multiple files.',
        },
        depth: {
          type: 'number',
          description: 'Max traversal depth (1–10, default 3).',
        },
      },
      required: ['symbol'],
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
        });
        break;

      case 'trace-deps':
        result = handleTraceDeps(index, {
          file_path: (params['file_path'] ?? params['path'] ?? params['file']) as string,
          direction: params['direction'] as 'imports' | 'importers' | 'both' | undefined,
          depth: params['depth'] as number | undefined,
        });
        break;

      case 'get-structure':
        result = handleGetStructure(index, {
          file_path: (params['file_path'] ?? params['path'] ?? params['file']) as string,
        });
        break;

      case 'trace-impact':
        result = handleTraceImpact(index, {
          symbol: params['symbol'] as string,
          file: params['file'] as string | undefined,
          depth: params['depth'] as number | undefined,
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
