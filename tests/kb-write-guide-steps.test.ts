import { describe, it, expect } from 'vitest';
import { flowStepsWarning } from '../src/kb/write-guide.js';
import type { WriteSpec } from '../src/kb/write.js';

// A flow's anchors are derived from its steps, so a stepless flow folds to a
// note with zero anchors and still reports `put → <id>` like any success —
// silently unreachable by kb lookup and by the anchor channel. Reported from a
// real notebook where it had recurred across sessions, because the file-note
// shape (title + summary) is what gets reused from memory.
describe('stepless-flow warning', () => {
  const w = (s: unknown) => flowStepsWarning(s as WriteSpec);

  it('warns on a flow with no steps, and on an empty steps array', () => {
    expect(w({ type: 'flow', title: 'how x happens', summary: 's' })).toMatch(/no "steps"/);
    expect(w({ type: 'flow', title: 'how x happens', steps: [] })).toMatch(/no "steps"/);
  });

  it('stays silent once the flow carries steps', () => {
    expect(w({ type: 'flow', title: 'how x happens', steps: [{ path: 'src/a.ts', role: 'entry' }] })).toBeNull();
  });

  it('never fires on non-flows or on a retract', () => {
    expect(w({ type: 'file', path: 'src/a.ts', summary: 's' })).toBeNull();
    expect(w({ type: 'lesson', kind: 'absence', title: 'no retries', body: 'b' })).toBeNull();
    expect(w({ type: 'flow', op: 'retract', id: 'f1' })).toBeNull();
  });
});
