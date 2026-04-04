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
          'CALL THIS FIRST when entering an unfamiliar codebase — before any file search or Glob. Returns domain structure with files grouped by architectural role, entry point count, and inter-domain dependency edges. Use it to understand where code lives so subsequent searches are targeted, not broad.',
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
