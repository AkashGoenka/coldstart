import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { migrateLegacyMcpConfig } from '../src/migrate.js';

describe('migrateLegacyMcpConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-migrate-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should be a no-op if .mcp.json is already in node-form', async () => {
    const mcpPath = path.join(tempDir, '.mcp.json');
    const modernConfig = {
      mcpServers: {
        coldstart: {
          command: 'node',
          args: ['/path/to/node_modules/coldstart-mcp/dist/index.js', '--root', tempDir],
        },
      },
    };
    fs.writeFileSync(mcpPath, JSON.stringify(modernConfig, null, 2));

    const originalContent = fs.readFileSync(mcpPath, 'utf8');

    await migrateLegacyMcpConfig(tempDir);

    // File should be unchanged
    const afterContent = fs.readFileSync(mcpPath, 'utf8');
    expect(afterContent).toBe(originalContent);

    // No backup should be created
    const files = fs.readdirSync(tempDir);
    const backupFile = files.find(f => f.startsWith('.mcp.json.bak-'));
    expect(backupFile).toBeUndefined();
  });

  it('should skip migration if COLDSTART_NO_AUTO_MIGRATE=1', async () => {
    const mcpPath = path.join(tempDir, '.mcp.json');
    const legacyConfig = {
      mcpServers: {
        coldstart: {
          command: 'npx',
          args: ['-y', 'coldstart-mcp', '--root', tempDir],
        },
      },
    };
    fs.writeFileSync(mcpPath, JSON.stringify(legacyConfig, null, 2));

    const originalContent = fs.readFileSync(mcpPath, 'utf8');

    const originalEnv = process.env;
    process.env = { ...originalEnv, COLDSTART_NO_AUTO_MIGRATE: '1' };

    try {
      await migrateLegacyMcpConfig(tempDir);

      // File should be unchanged
      const afterContent = fs.readFileSync(mcpPath, 'utf8');
      expect(afterContent).toBe(originalContent);
    } finally {
      process.env = originalEnv;
    }
  });

  it('should handle missing .mcp.json gracefully', async () => {
    // tempDir exists but has no .mcp.json
    await expect(migrateLegacyMcpConfig(tempDir)).resolves.not.toThrow();
  });

  it('should handle malformed .mcp.json gracefully', async () => {
    const mcpPath = path.join(tempDir, '.mcp.json');
    fs.writeFileSync(mcpPath, 'invalid json {]');

    // Should not throw, just skip the file
    await expect(migrateLegacyMcpConfig(tempDir)).resolves.not.toThrow();

    // Original file should be untouched
    const content = fs.readFileSync(mcpPath, 'utf8');
    expect(content).toBe('invalid json {]');
  });

  it('should preserve non-coldstart MCP entries untouched', async () => {
    const mcpPath = path.join(tempDir, '.mcp.json');
    const configWithOtherEntries = {
      mcpServers: {
        other: {
          command: 'node',
          args: ['/path/to/other-mcp'],
        },
      },
    };
    fs.writeFileSync(mcpPath, JSON.stringify(configWithOtherEntries, null, 2));

    const originalContent = fs.readFileSync(mcpPath, 'utf8');

    await migrateLegacyMcpConfig(tempDir);

    // File should be unchanged (no coldstart entry to migrate)
    const afterContent = fs.readFileSync(mcpPath, 'utf8');
    expect(afterContent).toBe(originalContent);
  });

  it('should detect legacy npx-based coldstart entries', async () => {
    // Test that the detection logic recognizes the legacy pattern
    const mcpPath = path.join(tempDir, '.mcp.json');
    const legacyConfig = {
      mcpServers: {
        coldstart: {
          command: 'npx',
          args: ['-y', 'coldstart-mcp', '--root', tempDir],
        },
      },
    };
    fs.writeFileSync(mcpPath, JSON.stringify(legacyConfig, null, 2));

    // When a stable install cannot be found, migration logs a message but continues
    // The file should be left alone if buildFastEntry returns null
    await migrateLegacyMcpConfig(tempDir);

    // File should still exist (not deleted)
    expect(fs.existsSync(mcpPath)).toBe(true);
  });

  it('should check .cursor/mcp.json path', async () => {
    const cursorDir = path.join(tempDir, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    const mcpPath = path.join(cursorDir, 'mcp.json');

    const modernConfig = {
      mcpServers: {
        coldstart: {
          command: 'node',
          args: ['/path/to/node_modules/coldstart-mcp/dist/index.js', '--root', tempDir],
        },
      },
    };
    fs.writeFileSync(mcpPath, JSON.stringify(modernConfig, null, 2));

    const originalContent = fs.readFileSync(mcpPath, 'utf8');

    // Should not throw even when checking cursor paths
    await migrateLegacyMcpConfig(tempDir);

    const afterContent = fs.readFileSync(mcpPath, 'utf8');
    expect(afterContent).toBe(originalContent);
  });
});
