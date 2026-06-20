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
 * Resolve the path to a stable coldstart-mcp install.
 *
 * Logic:
 * - If process.argv[1] is NOT inside ~/.npm/_npx/ and the parent has a package.json
 *   with "name": "coldstart-mcp", use it (we're running from a stable install).
 * - Otherwise, check if ~/.coldstart/versions/<our-version>/node_modules/coldstart-mcp/dist/index.js exists.
 * - Otherwise return null.
 */
async function findStableInstall(): Promise<string | null> {
  try {
    // Read our package.json to get the version
    const pkgPath = path.resolve(path.dirname(path.dirname(__filename)), 'package.json');
    if (!fs.existsSync(pkgPath)) return null;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string; name?: string };
    const ourVersion = pkg.version;
    if (!ourVersion) return null;
    // Accept both the current name and the legacy one so a stable install resolves
    // across the coldstart-mcp → coldstart rename.
    const names = new Set([pkg.name ?? 'coldstart', 'coldstart', 'coldstart-mcp']);

    // Check if we're in a stable install (not in ~/.npm/_npx/)
    const argv1 = process.argv[1];
    if (argv1 && !argv1.includes('.npm/_npx/')) {
      const parent = path.dirname(argv1);
      const parentPkg = path.join(parent, '..', 'package.json');
      if (fs.existsSync(parentPkg)) {
        const parentJson = JSON.parse(fs.readFileSync(parentPkg, 'utf8')) as { name?: string };
        if (parentJson.name && names.has(parentJson.name)) {
          const entryPath = path.resolve(parent, '..', 'dist', 'index.js');
          if (fs.existsSync(entryPath)) {
            return entryPath;
          }
        }
      }
    }

    // Check ~/.coldstart/versions/<version>/
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (!home) return null;

    const versionedPath = path.join(home, '.coldstart', 'versions', ourVersion, 'node_modules', pkg.name ?? 'coldstart', 'dist', 'index.js');
    if (fs.existsSync(versionedPath)) {
      return versionedPath;
    }

    return null;
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
      process.stderr.write('[coldstart] Detected legacy npx-based .mcp.json but could not resolve a stable install path. Run `npx -y coldstart@latest init` to migrate.\n');
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
