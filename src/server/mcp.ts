import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CodebaseIndex } from '../types.js';
import {
  handleGetOverview,
  handleTraceDeps,
  handleGetStructure,
  handleTraceImpact,
} from './tools.js';

export async function startMCPServer(index: CodebaseIndex): Promise<void> {
  const server = new Server(
    { name: 'coldstart-mcp', version: '3.0.0' },
    { capabilities: { tools: {} } },
  );

  // -------------------------------------------------------------------------
  // List tools
  // -------------------------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get-overview',
        description:
          'Use `get-overview` to locate files by symbol, filename, or path tokens.\n' +
          'Returns a compact filtered list with source flags (F=filename, P=path, S=symbol).\n\n' +
          'HOW INDEXING WORKS: Files are indexed by (1) directory path segments, (2) filename, ' +
          '(3) exported symbol names — both split into tokens AND as the full lowercased compound ' +
          '(e.g. "UsersPage" → indexed as "users" + "userspage"). ' +
          'This means you can query by camelCase/PascalCase name directly.\n\n' +
          'FIRST CALL STRATEGY: If you know the component or file name, pass it directly in the first call — ' +
          'e.g. `domain_filter: "GroupHubActionMenu"`. Do not decompose it yourself; the tool splits it internally. ' +
          'Only iterate if the first call returns zero results or too many.\n' +
          '- Zero results → try synonyms, shorter tokens, or a different spelling\n' +
          '- Too many results → add another concept token to narrow down\n' +
          '- Diagnostic warning → tokens are too common; add a second specific token\n\n' +
          'TEST FILES: Test and automation files (e.g. e2e tests, locators, page objects) are excluded by default. ' +
          'If your task involves test or automation code, pass `include_tests: true`.\n\n' +
          'For framework convention files (page.tsx, route.ts, layout.tsx), query by directory name — ' +
          'the filename is generic, the directory is what uniquely identifies them.\n\n' +
          'For finding all files that import a given file/symbol, use `trace-deps` instead.\n\n' +
          'For line-level full-text search or matches inside comments/strings, use grep/ripgrep instead.',
        inputSchema: {
          type: 'object',
          properties: {
            domain_filter: {
              type: 'string',
              description: 'One or more keywords relevant to your task. Bare words are independent concepts (AND logic across them). Bracket groups are synonyms (OR logic within): "[auth|login|jwt] payment" means files must match the auth concept AND payment concept, where any of auth/login/jwt satisfies the auth concept. You can pass camelCase names directly: "UsersPage" finds files that export UsersPage. Partial matches work: "workspace" matches files indexed under "workspaces".',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of files to return. Default 15.',
            },
            include_tests: {
              type: 'boolean',
              description: 'Include test and automation files in results. Default false. Pass true when working on test or automation code.',
            },
          },
          required: ['domain_filter'],
        },
      },
      {
        name: 'trace-deps',
        description:
          'Call this INSTEAD OF manually reading import statements across multiple files. Given a file you already know, returns its full dependency graph (what it imports and what imports it) without reading any file contents. Saves tokens when you need to understand how a component connects to the rest of the codebase.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Relative path to the file (e.g. "src/auth/service.ts").',
            },
            direction: {
              type: 'string',
              enum: ['imports', 'importers', 'both'],
              description: 'Which direction to trace (default: "both").',
            },
            depth: {
              type: 'number',
              description: 'How many levels of transitive deps to include (1-3, default 1).',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'get-structure',
        description:
          'Call this INSTEAD OF reading a file just to understand its exports or imports. Returns exports, internal/external imports, line count, token estimate, and architectural role — at zero file-read cost. Use it to decide whether a file is worth reading in full before spending tokens on it.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Relative path to the file.',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'trace-impact',
        description:
          'Call this when you need to understand what code will break if you change a symbol. Given a function, class, interface, or type, returns every symbol that directly or transitively depends on it — with the full dependency chain for each. Use it before refactoring to scope the blast radius without reading all dependent files.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Symbol name to analyse (e.g. "validateToken", "AuthService", "UserDTO").',
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
    ],
  }));

  // -------------------------------------------------------------------------
  // Call tool
  // -------------------------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

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
          file_path: params['file_path'] as string,
          direction: params['direction'] as 'imports' | 'importers' | 'both' | undefined,
          depth: params['depth'] as number | undefined,
        });
        break;

      case 'get-structure':
        result = handleGetStructure(index, {
          file_path: params['file_path'] as string,
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

    const isError = 'error' in result;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError,
    };
  });

  // -------------------------------------------------------------------------
  // Start server
  // -------------------------------------------------------------------------
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
