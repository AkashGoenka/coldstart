import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CodebaseIndex } from '../types.js';
import {
  handleGetOverview,
  handleFindFiles,
  handleTraceDeps,
  handleGetStructure,
} from './tools.js';

export async function startMCPServer(index: CodebaseIndex): Promise<void> {
  const server = new Server(
    { name: 'coldstart-mcp', version: '2.0.0' },
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
          'CALL THIS FIRST when entering an unfamiliar codebase — before any file search or Glob. Returns domain structure, entry points, and the most-imported files at zero file-read cost. Use it to understand where code lives so subsequent searches are targeted, not broad.',
        inputSchema: {
          type: 'object',
          properties: {
            domain_filter: {
              type: 'string',
              description: 'Restrict overview to a specific domain (e.g. "auth", "payments").',
            },
          },
        },
      },
      {
        name: 'find-files',
        description:
          'Call this BEFORE Glob or Grep when looking for files by topic or functionality. Uses TF-IDF + PageRank + git co-change to rank candidates. Returns a confidence level (high/medium/low) and a recommended next action for each result — so you read only 2-3 targeted files instead of broad-searching dozens. If top result confidence is "high", read it directly. If "low", the response will tell you to supplement with a targeted Grep.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language or keyword query (e.g. "user authentication", "membership action menu").',
            },
            domain: {
              type: 'string',
              description: 'Filter results to a specific domain from get-overview.',
            },
            limit: {
              type: 'number',
              description: 'Max results to return (1-10, default 5).',
            },
            prefer_source: {
              type: 'boolean',
              description: 'Apply stronger penalty to test files and type definitions.',
            },
          },
          required: ['query'],
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
        });
        break;

      case 'find-files':
        result = handleFindFiles(index, {
          query: params['query'] as string,
          domain: params['domain'] as string | undefined,
          limit: params['limit'] as number | undefined,
          prefer_source: params['prefer_source'] as boolean | undefined,
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
