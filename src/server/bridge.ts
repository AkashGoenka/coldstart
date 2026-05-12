import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { watch, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
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
  killDaemon,
  getCurrentVersion,
  deleteLock,
  daemonLogPath,
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
// Fix #4: Tail daemon log to bridge stderr
//
// On cold start, the daemon is spawned detached and creates its log file
// asynchronously — it does NOT exist at the moment we want to start tailing.
// We poll-wait (cheap stat calls) up to 5s for it to appear before installing
// the watcher. Once the watcher is attached, it's kernel-driven (FSEvents /
// inotify / ReadDirectoryChangesW) and costs ~0 CPU at idle; each event reads
// only the newly-appended bytes.
// ---------------------------------------------------------------------------
function startLogTailer(rootDir: string): () => void {
  const logPath = daemonLogPath(rootDir);
  let stopped = false;
  let watcher: ReturnType<typeof watch> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let currentOffset = 0;

  const drain = (): void => {
    try {
      if (!existsSync(logPath)) {
        currentOffset = 0;
        return;
      }
      const stat = statSync(logPath);
      if (stat.size < currentOffset) {
        // Log rotated (e.g., .log -> .log.prev on daemon restart)
        currentOffset = 0;
      }
      if (stat.size > currentOffset) {
        // Positional read from exact offset to avoid races with concurrent
        // appends and to skip re-reading bytes we've already streamed.
        const length = stat.size - currentOffset;
        const buf = Buffer.allocUnsafe(length);
        const fd = openSync(logPath, 'r');
        try {
          const bytesRead = readSync(fd, buf, 0, length, currentOffset);
          if (bytesRead > 0) {
            currentOffset += bytesRead;
            process.stderr.write(buf.subarray(0, bytesRead));
          }
        } finally {
          closeSync(fd);
        }
      }
    } catch {
      // Best effort — don't crash bridge over log read errors
    }
  };

  const attachWatcher = (): void => {
    if (stopped) return;
    let initialSize: number;
    try {
      initialSize = statSync(logPath).size;
    } catch {
      return;
    }
    // Cold start: the daemon just rotated its log and the new .log is small
    // (a fresh boot writes ~5 KB). Start from offset 0 so users see the full
    // "Daemon starting / HTTP server / Walking filesystem ..." sequence.
    // Warm reconnect: the daemon has been running, log already has history;
    // start at EOF so we don't replay hours of past events on every connect.
    const COLD_START_THRESHOLD = 8 * 1024;
    currentOffset = initialSize < COLD_START_THRESHOLD ? 0 : initialSize;
    // Stream whatever already exists at attach time (so we don't miss the
    // first few lines written between file creation and watcher install).
    // Then keep `currentOffset` at the new EOF.
    drain();
    try {
      watcher = watch(logPath, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          drain();
        }, 100);
      });
    } catch {
      // ignore
    }
  };

  // Cold start: daemon is spawned detached and creates its log file async.
  // Poll-wait (cheap stat) up to 5s for the file to appear, then attach.
  if (existsSync(logPath)) {
    attachWatcher();
  } else {
    const deadline = Date.now() + 5000;
    const poll = (): void => {
      if (stopped) return;
      if (existsSync(logPath)) {
        attachWatcher();
        return;
      }
      if (Date.now() > deadline) return; // give up silently
      pollTimer = setTimeout(poll, 50);
    };
    poll();
  }

  return () => {
    stopped = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (pollTimer) clearTimeout(pollTimer);
    watcher?.close();
  };
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
let logTailerStop: (() => void) | null = null;

async function ensureDaemon(rootDir: string, quiet: boolean): Promise<void> {
  const lock = await readLock(rootDir);
  const currentVersion = getCurrentVersion();

  // Fix #1: Version-mismatch restart
  // If a daemon exists but its version doesn't match the current bridge version,
  // kill it and proceed to spawn a new one.
  if (lock && isDaemonAlive(lock.pid)) {
    if (lock.version && lock.version !== currentVersion) {
      if (!quiet) {
        process.stderr.write(
          `[coldstart] Version mismatch: daemon v${lock.version} vs bridge v${currentVersion}, restarting...\n`,
        );
      }
      await killDaemon(lock.pid);
      await deleteLock(rootDir).catch(() => {});
    } else if (await isDaemonServing(lock.port)) {
      // Already running and version matches — start log tailer
      logTailerStop = startLogTailer(rootDir);
      return;
    }
  }

  const release = await tryAcquireSpawnLock(rootDir);
  if (release === null) {
    // Another bridge is already handling daemon spawn — just wait
    return;
  }

  try {
    // Re-check after acquiring lock in case daemon appeared in the meantime
    const lock2 = await readLock(rootDir);
    if (lock2 && isDaemonAlive(lock2.pid) && await isDaemonServing(lock2.port)) {
      // Check version again
      if (!lock2.version || lock2.version === currentVersion) {
        // Already running — start log tailer
        logTailerStop = startLogTailer(rootDir);
        return;
      }
      // Version mismatch — kill and proceed
      await killDaemon(lock2.pid);
      await deleteLock(rootDir).catch(() => {});
    }

    const daemonArgv = [...process.argv.slice(1)];
    if (!daemonArgv.includes('--daemon')) daemonArgv.push('--daemon');

    const child = spawn(process.execPath, daemonArgv, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    if (!quiet) process.stderr.write('[coldstart] Daemon spawned\n');
    // Fix #4: Start tailing daemon log once it's spawned
    logTailerStop = startLogTailer(rootDir);
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
