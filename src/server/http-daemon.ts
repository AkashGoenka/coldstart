import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IndexContext } from '../index-manager.js';
import { createMcpServer } from './mcp.js';

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString();
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/**
 * Start the HTTP daemon server. Returns the port it bound to.
 * Each incoming MCP session gets its own Server + Transport instance,
 * but all sessions share the same getContext closure (same live index).
 */
export async function startDaemonHttpServer(
  getContext: () => Promise<IndexContext>,
): Promise<number> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    if (!url.startsWith('/mcp')) { res.writeHead(404); res.end(); return; }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'DELETE') {
      if (sessionId) {
        const transport = sessions.get(sessionId);
        if (transport) { await transport.close(); sessions.delete(sessionId); }
      }
      res.writeHead(200); res.end();
      return;
    }

    if (req.method === 'GET') {
      if (sessionId && sessions.has(sessionId)) {
        // SSE stream for an existing session
        await sessions.get(sessionId)!.handleRequest(req, res);
      } else if (!sessionId) {
        // Pre-session GET from StreamableHTTPClientTransport.start() — create a new session
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        const mcpServer = createMcpServer(getContext);
        await mcpServer.connect(transport);
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await transport.handleRequest(req, res);
        if (transport.sessionId) sessions.set(transport.sessionId, transport);
      } else {
        // Has session ID but session not found — stale
        res.writeHead(400); res.end();
      }
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);

      if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.handleRequest(req, res, body);
        return;
      }

      // New session — create a dedicated Server + Transport pair
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const mcpServer = createMcpServer(getContext);
      await mcpServer.connect(transport);
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await transport.handleRequest(req, res, body);
      if (transport.sessionId) sessions.set(transport.sessionId, transport);
      return;
    }

    res.writeHead(405); res.end();
  });

  return new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      resolve((httpServer.address() as AddressInfo).port);
    });
  });
}
