import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListRootsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  readLock,
  isDaemonAlive,
  tryAcquireSpawnLock,
} from '../daemon-lock.js';

// ---------------------------------------------------------------------------
// Daemon health check
// ---------------------------------------------------------------------------
async function isDaemonServing(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wait until daemon lockfile has a valid port and the HTTP server is responding
// ---------------------------------------------------------------------------
async function waitForDaemon(rootDir: string, timeoutMs = 180_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lock = await readLock(rootDir);
    if (lock && isDaemonAlive(lock.pid) && await isDaemonServing(lock.port)) {
      return lock.port;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Daemon did not become ready within ${Math.round(timeoutMs / 1000)}s`);
}

// ---------------------------------------------------------------------------
// Ensure exactly one daemon is running for this root
// ---------------------------------------------------------------------------
async function ensureDaemon(rootDir: string, quiet: boolean): Promise<void> {
  const lock = await readLock(rootDir);
  if (lock && isDaemonAlive(lock.pid) && await isDaemonServing(lock.port)) {
    return; // Already running
  }

  const release = await tryAcquireSpawnLock(rootDir);
  if (release === null) {
    // Another bridge is already handling daemon spawn — just wait
    return;
  }

  try {
    // Re-check after acquiring lock in case daemon appeared in the meantime
    const lock2 = await readLock(rootDir);
    if (lock2 && isDaemonAlive(lock2.pid) && await isDaemonServing(lock2.port)) return;

    const daemonArgv = [...process.argv.slice(1)];
    if (!daemonArgv.includes('--daemon')) daemonArgv.push('--daemon');

    const child = spawn(process.execPath, daemonArgv, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    if (!quiet) process.stderr.write('[coldstart] Daemon spawned\n');
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// Bridge entry point
// ---------------------------------------------------------------------------
export async function startBridge(
  cliRoot: string,
  rootExplicit: boolean,
  quiet: boolean,
): Promise<void> {
  let finalRoot = resolve(cliRoot);

  // Daemon client — created lazily on first tool call so we don't block initialize
  let daemonClient: Client | null = null;
  let connectingPromise: Promise<Client> | null = null;

  // Resolves after we know finalRoot and have called ensureDaemon
  let daemonEnsuredResolve!: () => void;
  const daemonEnsured = new Promise<void>(res => { daemonEnsuredResolve = res; });

  async function getOrConnectClient(): Promise<Client> {
    if (daemonClient) return daemonClient;
    await daemonEnsured;
    if (!connectingPromise) {
      connectingPromise = (async () => {
        const port = await waitForDaemon(finalRoot);
        const client = new Client(
          { name: 'coldstart-bridge', version: '1.0.0' },
          { capabilities: {} },
        );
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${port}/mcp`),
        );
        await client.connect(transport);
        daemonClient = client;
        return client;
      })();
    }
    return connectingPromise;
  }

  // -------------------------------------------------------------------------
  // Stdio MCP server — handles the AI client on this end
  // -------------------------------------------------------------------------
  const server = new Server(
    { name: 'coldstart-mcp', version: '3.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const client = await getOrConnectClient();
    return client.listTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    let client: Client;
    try {
      client = await getOrConnectClient();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Daemon unreachable';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
        isError: true,
      };
    }
    const { name, arguments: args } = request.params;
    try {
      return await client.callTool({ name, arguments: args ?? {} });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Daemon call failed';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // After connect: determine the actual root from roots/list if not explicit
  if (!rootExplicit) {
    try {
      const result = await server.request(
        { method: 'roots/list' },
        ListRootsResultSchema,
        { timeout: 1000 },
      );
      if (result?.roots?.length) {
        const uri = result.roots[0].uri;
        finalRoot = uri.startsWith('file://') ? fileURLToPath(uri) : resolve(uri);
      }
    } catch {
      // No roots/list support — use cliRoot as-is
    }
  }

  // Now that we know finalRoot, ensure the daemon is up
  try {
    await ensureDaemon(finalRoot, quiet);
  } catch (err) {
    if (!quiet) process.stderr.write(`[coldstart] Failed to ensure daemon: ${err}\n`);
  }
  daemonEnsuredResolve();
}
