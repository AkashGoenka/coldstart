import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { handleGetOverview, handleFindFiles, handleTraceDeps, handleGetStructure, } from './tools.js';
export async function startMCPServer(index) {
    const server = new Server({ name: 'coldstart-mcp', version: '2.0.0' }, { capabilities: { tools: {} } });
    // -------------------------------------------------------------------------
    // List tools
    // -------------------------------------------------------------------------
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'get-overview',
                description: 'Get a high-level overview of the codebase: file counts, language breakdown, domains, inter-domain dependencies, entry points, and the most imported files.',
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
                description: 'Search for files relevant to a query. Uses TF-IDF + PageRank + git co-change to rank results. Returns file paths with domain, exports, centrality score, and reasons for inclusion.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Natural language or keyword query (e.g. "user authentication", "payment stripe webhook").',
                        },
                        domain: {
                            type: 'string',
                            description: 'Filter results to a specific domain.',
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
                description: 'Trace the import/export dependencies of a specific file. Shows what the file imports and what imports it, with optional transitive depth.',
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
                description: 'Get full structural metadata for a specific file: language, domain, exports, imports (internal + external), line count, token estimate, architectural role, and centrality.',
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
        const params = (args ?? {});
        let result;
        switch (name) {
            case 'get-overview':
                result = handleGetOverview(index, {
                    domain_filter: params['domain_filter'],
                });
                break;
            case 'find-files':
                result = handleFindFiles(index, {
                    query: params['query'],
                    domain: params['domain'],
                    limit: params['limit'],
                    prefer_source: params['prefer_source'],
                });
                break;
            case 'trace-deps':
                result = handleTraceDeps(index, {
                    file_path: params['file_path'],
                    direction: params['direction'],
                    depth: params['depth'],
                });
                break;
            case 'get-structure':
                result = handleGetStructure(index, {
                    file_path: params['file_path'],
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
//# sourceMappingURL=mcp.js.map