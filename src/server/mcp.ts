import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListRootsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { IndexContext } from '../index-manager.js';
import { getCurrentVersion } from '../daemon-lock.js';
import {
  handleFind,
  handleGetStructure,
} from './tools.js';

// ---------------------------------------------------------------------------
// Tool definitions — shared between the stdio server and HTTP daemon sessions
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  {
    name: 'find',
    description:
      'Locate the files relevant to a task. Pass `query` = EVERY salient identifier from the task (symbol names, domain nouns, the rare token you half-remember) — not one distilled keyword. Recall is bounded by the terms you give: a one-token query cannot out-rank lookalikes, so over-supply rather than under-supply. Reach for find BEFORE Read/Grep/Glob.\n\n' +
      'HOW IT WORKS: find greps every term across the repo body AND matches declared names (filenames, path segments, exported symbols), then ranks files by DISTINCT-TERM COVERAGE — the file that covers MORE of your query rises above its lookalikes. This catches body-level matches (nested defs, dynamic refs, string literals) that a declared-name index misses.\n\n' +
      'OUTPUT: a ranked page. Top files get an inline preview — their indexed symbols (with line ranges) plus the body lines where your rare terms CLUSTER (def/class/assignment lines first), so you often answer WITHOUT a follow-up Read. Lower-ranked files list as bare paths. Prose/doc and stylesheet matches are partitioned into secondary lists so they do not crowd out source. Related files (sharing a rare identifier with a top hit, no import edge between them) are surfaced as first-class neighbors.\n\n' +
      'NAMING: case- and separator-insensitive (`LoadStaging` ≡ `load_staging`). It does NOT expand synonyms or plurals for you — that is your job: if the concept could be named two ways, pass both tokens.\n\n' +
      'AFTER THE RESULT:\n' +
      '1. A path + its inline symbols/preview answer the question → done, no Read needed.\n' +
      '2. Path looks right but you need shape/usage → `gs` on it (symbols + imports + per-symbol callers + importers in one shot).\n' +
      '3. "no indexed file contains any of [...]" → those identifiers do not exist in the repo; reformulate or grep for a phrase/regex find cannot index. Do not grep spelling variants of a token find already reported absent.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Space-separated identifiers for the thing you are looking for — pass every salient token from the task, not one keyword. camelCase/snake_case both accepted. More discriminating tokens = sharper ranking.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'gs',
    description:
      'Drill into a known file. Returns these sections as compact text:\n' +
      '- Symbols — top-level + per-class methods (name, kind, line range, extends/implements). With cross-file callers attached per exported symbol (inline if 1 caller; newline-per-caller block if ≥2). For huge files (>20 symbols, no `match`), symbols are reordered by caller count (most-used first) and truncated to top 15.\n' +
      '- Imports — 1-hop internal outbound dependencies (library imports stripped).\n' +
      '- Importers — 1-hop reverse: files in this repo that import this one. With `match`, additionally lists EVERY indexed file (importer or not, any language) whose CONTENT references the matched term even when its filename does not (a registry, admin, or config file using the symbol — or a frontend file referencing a backend name). That subsection IS the complete "who uses <symbol>" answer: it is exhaustive over indexed content, so a subsystem absent from it does NOT use the symbol — do not grep to enumerate or re-verify use-sites, and do not keep hunting in subsystems the section rules out.\n' +
      '- Related — files sharing rare identifier/string-literal tokens with this file (with `match`: with the matched symbols\' code region), shown only when NO import edge connects them. These are name-reference relations the import graph cannot see — Django migrations↔models, config-by-name registration, cross-language (JS↔Python) pairs. Treat them as first-class neighbors: the shared token shown is the reason they are related.\n' +
      'Use this AFTER find surfaces a candidate file. This is the right tool for "who uses this file" / "who calls this symbol" — no separate call needed.\n\n' +
      '`view` controls which sections you get (default `full` = all four). `symbols`, `imports`, `importers`, `callers` each return one section in isolation when you want a byte-light answer.\n\n' +
      'For god-files (large classes, large routers, large config modules), pass `match` to filter symbols/imports/importers/callers to one area — e.g. `match: "auth"` or `match: "/^handle/"`. Substring is case-insensitive; wrap in slashes for regex.\n\n' +
      'Prefer this over Read when you need shape, neighbors, or usage. Reach for Read only for implementation details inside a method body. If you have called gs on 5+ files for one question, you are enumerating — go back to find with a sharper `path` glob or a different concept token instead.',
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
        symbol: {
          type: 'string',
          description: 'Deliver the BODY of the named symbol(s) inline, sliced from their indexed line range — so you read a method WITHOUT a Read at a guessed offset. Comma/pipe-separate names (`serialize,restore_state`). A bare name matches the method (`serialize` → `Graph.serialize`). Each body is followed by `callers:`/`calls:` POINTERS (file + line range) so the next hop is one more `gs --symbol` call, not a windowed Read. Use this the moment a file’s symbol list shows the method you need — it replaces the read-at-offset hunt on god-files. If the name is NOT a declared symbol (a runtime/template-injected value, a string key, a config token), it falls back to an in-tool GREP: returns the body lines where the token appears, with context — so you never shell out to grep. Overrides `view`/`match`.',
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
      case 'find':
        result = handleFind(index, {
          query: (params['query'] ?? params['domain_filter']) as string | undefined,
        });
        break;

      case 'gs':
        result = handleGetStructure(index, {
          file_path: (params['file_path'] ?? params['file'] ?? params['file_name']) as string,
          match: params['match'] as string | undefined,
          symbol: params['symbol'] as string | undefined,
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
// Factory — creates a fully wired MCP server (the stdio reader over the cache)
// ---------------------------------------------------------------------------
export function createMcpServer(getContext: () => Promise<IndexContext>): Server {
  const server = new Server(
    { name: 'coldstart', version: getCurrentVersion() },
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
