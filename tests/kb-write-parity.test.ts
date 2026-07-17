import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeGuideCli, writeGuideMcp, WRITE_GUIDE_SHAPES, flowEvidenceWarning } from '../src/kb/write-guide.js';
import type { WriteSpec } from '../src/kb/write.js';

/**
 * MCP ↔ CLI parity for the kb write surface (2026-07-17): both no-spec guides
 * are the SAME shapes text (only the howto differs), and the flow-evidence
 * WARN reads capture markers from every host's elicit hook.
 */

const cleanup: string[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) fs.rmSync(f, { force: true });
});

function marker(prefix: string, sid: string, files: Record<string, { reads?: number; edits?: number; gs?: number }>): void {
  const p = path.join(os.tmpdir(), `${prefix}${sid}-main.json`);
  fs.writeFileSync(p, JSON.stringify({ v: 2, files }));
  cleanup.push(p);
}

const flow = (steps: string[]): WriteSpec => ({
  type: 'flow', title: 't', summary: 's',
  steps: steps.map((p) => ({ path: p, role: 'r' })),
} as unknown as WriteSpec);

describe('kb write guide parity', () => {
  it('CLI and MCP guides share the exact shapes text; only the howto differs', () => {
    expect(writeGuideCli()).toContain(WRITE_GUIDE_SHAPES);
    expect(writeGuideMcp()).toContain(WRITE_GUIDE_SHAPES);
    expect(writeGuideCli()).toContain('heredoc');
    expect(writeGuideMcp()).toContain('call kb_write again');
    expect(writeGuideMcp()).not.toContain('heredoc');
  });
});

describe('flowEvidenceWarning reads every host\'s markers', () => {
  it.each([
    ['claude', 'coldstart-kb-'],
    ['cursor', 'coldstart-cursor-kb-'],
    ['codex', 'coldstart-codex-kb-'],
  ])('%s marker satisfies the evidence check', (_host, prefix) => {
    const sid = `parity-${_host}-${process.pid}`;
    marker(prefix, sid, { 'src/a.py': { reads: 1 }, 'src/b.py': { edits: 1 } });
    expect(flowEvidenceWarning(flow(['src/a.py', 'src/b.py']), sid)).toBeNull(); // 2 read steps: fine
    expect(flowEvidenceWarning(flow(['src/a.py', 'src/ghost.py', 'src/ghost2.py']), sid))
      .toContain('only 1 of 3');
  });

  it('no marker / not a flow / no session → no opinion', () => {
    expect(flowEvidenceWarning(flow(['src/a.py', 'src/b.py']), `parity-none-${process.pid}`)).toBeNull();
    expect(flowEvidenceWarning({ type: 'file', path: 'x.py' } as unknown as WriteSpec, 'any')).toBeNull();
    expect(flowEvidenceWarning(flow(['src/a.py']), undefined)).toBeNull();
  });
});
