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
          'Use this like a search engine — pass keywords from your current task to find relevant files fast. NOT for general codebase summarization or exploration. Only call this when you have a specific concept to look up (e.g. "auth", "payment stripe", "user profile"). domain_filter is required. Returns top-ranked files by IDF-weighted relevance score. Barrel/re-export index files and test files are excluded unless the query contains test-related keywords. Supports synonym groups: "[auth|login|jwt] payment" — files matching any synonym in a group score as if they matched all.',
        inputSchema: {
          type: 'object',
          properties: {
            domain_filter: {
              type: 'string',
              description: 'One or more keywords relevant to your task. Bare words are independent concepts (AND logic across them). Bracket groups are synonyms (OR logic within): "[auth|login|jwt] payment" means files must match the auth concept AND payment concept, where any of auth/login/jwt satisfies the auth concept. Partial matches work: "grouphub" matches files indexed under "group" and "hub", "authentication" matches files indexed under "auth".',
            },
            threshold_pct: {
              type: 'number',
              description: 'Relative score threshold (0–1). Files scoring below threshold_pct × top_score are excluded. Default 0.30.',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of files to return after threshold filtering. Default 20.',
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
          threshold_pct: params['threshold_pct'] as number | undefined,
          max_results: params['max_results'] as number | undefined,
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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  // -------------------------------------------------------------------------
  // Start server
  // -------------------------------------------------------------------------
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
