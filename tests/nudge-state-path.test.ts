/**
 * The nudge/preguard/recall hooks share per-session state. It used to live at a
 * literal "/tmp/find_nudge_*.json": on Windows that is C:\tmp, absent on a fresh
 * machine, so every state write failed silently and the spiral nudge never fired.
 * On CI it only passed when another test file had happened to create C:\tmp first.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findNudgeStatePath } from '../hooks/nudge-state-path.mjs';

describe('find-nudge state path', () => {
  it('lives in os.tmpdir(), which exists on every platform', () => {
    expect(path.dirname(findNudgeStatePath('abc'))).toBe(os.tmpdir());
    expect(path.basename(findNudgeStatePath('abc'))).toBe('find_nudge_abc.json');
  });

  it('no hook builds the path from a literal /tmp', () => {
    const hooksDir = path.join(__dirname, '..', 'hooks');
    for (const f of fs.readdirSync(hooksDir).filter((n) => n.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(hooksDir, f), 'utf8');
      expect(src, f).not.toMatch(/[`'"]\/tmp\/find_nudge_/);
    }
  });
});
