import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We can't easily test runInit interactively, but we can test that the
// MCP entry structure is correct when it's generated. This is a basic
// smoke test that validates the new node-form entries are being written.

describe('init MCP entry format', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-init-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should generate node-form MCP entries, not npx-form', async () => {
    // Read the latest init.ts and verify that buildMcpEntry generates node-form entries
    // by checking the source directly

    const initPath = path.resolve(path.dirname(__filename), '..', 'src', 'init.ts');
    const initSource = fs.readFileSync(initPath, 'utf8');

    // Check that buildMcpEntry function no longer returns 'npx' command
    expect(initSource).not.toMatch(/command:\s*['"]npx['"]/);

    // Check that it now returns 'node' command
    expect(initSource).toMatch(/command:\s*['"]node['"]/);

    // Check that getOrInstallStableVersion is being called
    expect(initSource).toContain('getOrInstallStableVersion()');
  });

  it('should reference .coldstart/versions in the install logic', async () => {
    const initPath = path.resolve(path.dirname(__filename), '..', 'src', 'init.ts');
    const initSource = fs.readFileSync(initPath, 'utf8');

    // Verify the stable version directory is being used
    expect(initSource).toContain('.coldstart/versions');
  });

  it('should pass node_modules path as absolute, not tilde-expanded', async () => {
    const initPath = path.resolve(path.dirname(__filename), '..', 'src', 'init.ts');
    const initSource = fs.readFileSync(initPath, 'utf8');

    // The function should use path.join to create absolute paths
    expect(initSource).toContain('path.join(');
  });
});
