/**
 * Auto-migrate legacy npx-based .mcp.json entries to direct node invocation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

interface McpEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, McpEntry>;
  [key: string]: unknown;
}

/**
 * Detect if an MCP entry is the legacy npx-based coldstart form.
 */
function isLegacyNpxEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  return (
    e.command === 'npx' &&
    Array.isArray(e.args) &&
    (e.args as string[]).some(a => a === 'coldstart-mcp' || a === 'coldstart')
  );
}

/**
 * Resolve the `dist/index.js` of the running coldstart install.
 *
 * Derived from this module's own location (`<install>/dist/migrate.js`), so it
 * points at the live install regardless of how it was launched. There is no
 * version-pinned copy to consult — `npx` is no longer a supported flow, so the
 * running path is always stable.
 */
async function findStableInstall(): Promise<string | null> {
  try {
    const entryPath = path.join(path.dirname(path.dirname(__filename)), 'dist', 'index.js');
    return fs.existsSync(entryPath) ? entryPath : null;
  } catch {
    return null;
  }
}

/**
 * Build the new MCP entry for fast (direct node) invocation.
 */
async function buildFastEntry(rootDir: string): Promise<McpEntry | null> {
  const entryPath = await findStableInstall();
  if (!entryPath) return null;

  return {
    command: 'node',
    args: [entryPath, '--root', rootDir],
  };
}

/**
 * Auto-migrate legacy npx-based .mcp.json entries to direct node invocation.
 * Called at server startup; failures are non-fatal (logged but don't block).
 */
export async function migrateLegacyMcpConfig(rootDir: string): Promise<void> {
  // Opt-out via environment variable
  if (process.env.COLDSTART_NO_AUTO_MIGRATE === '1') return;

  const candidates = [
    path.join(rootDir, '.mcp.json'),
    path.join(rootDir, '.cursor', 'mcp.json'),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;

    let config: McpConfig;
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8')) as McpConfig;
    } catch {
      continue;
    }

    const entry = config.mcpServers?.coldstart;
    if (!entry) continue;

    // Only migrate if it's the exact legacy pattern we generated
    if (!isLegacyNpxEntry(entry)) continue;

    // Resolve a stable install
    const newEntry = await buildFastEntry(rootDir);
    if (!newEntry) {
      process.stderr.write('[coldstart] Detected legacy npx-based .mcp.json but could not resolve the running install path. Reinstall (`npm i -g coldstart`) and run `coldstart init` to migrate.\n');
      continue;
    }

    // Create backup with timestamp
    const backup = `${file}.bak-${Date.now()}`;
    try {
      fs.copyFileSync(file, backup);
    } catch (err) {
      process.stderr.write(`[coldstart] Failed to create backup at ${backup}: ${err}\n`);
      continue;
    }

    // Update the config
    config.mcpServers!.coldstart = newEntry;

    try {
      fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
      process.stderr.write(`[coldstart] Migrated ${path.basename(file)} from npx to direct node (backup at ${path.basename(backup)}). Faster startup next session.\n`);
    } catch (err) {
      process.stderr.write(`[coldstart] Failed to write migrated config: ${err}\n`);
    }
  }
}
