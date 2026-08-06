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
 *
 * 2026-08-06: all three hosts write ONE shared marker prefix now (previously
 * per-host, which meant manual /capture-notes — always the shared
 * kb-elicit.mjs --manual — could never see Cursor's/Codex's own automatic
 * evidence). The "every host" framing below is now about content parity
 * (any host's marker satisfies the check), not separate namespaces.
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
    // Both teach the batch (array) path; only the howto differs — CLI shells out
    // to a heredoc'd file, MCP passes `specs` inline.
    expect(writeGuideCli()).toContain('JSON array');
    expect(writeGuideCli()).toContain('/tmp/notes.json');
    expect(writeGuideMcp()).toContain('specs');
    expect(writeGuideMcp()).not.toContain('/tmp/notes.json');
  });
});

describe('flowEvidenceWarning reads the shared marker regardless of which host wrote it', () => {
  it.each([
    ['claude'], ['cursor'], ['codex'],
  ])('%s marker satisfies the evidence check', (_host) => {
    const sid = `parity-${_host}-${process.pid}`;
    marker('coldstart-kb-', sid, { 'src/a.py': { reads: 1 }, 'src/b.py': { edits: 1 } });
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
