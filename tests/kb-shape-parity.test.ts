/**
 * The capture prompt inlines its own copy of the spec shapes (deliberately — the
 * "run kb write with no spec" bounce was what caused stepless flows). Two copies
 * means drift, and drift already happened: the inlined flow shape lost "aliases",
 * and every flow written from it went into the notebook with none.
 *
 * These tests pin both copies to the same required-field list. They are about
 * FINDABILITY, so the list is the set of fields a note cannot be retrieved
 * without — not the full schema.
 */
import { describe, it, expect } from 'vitest';
import { WRITE_GUIDE_SHAPES, missingFieldsWarning } from '../src/kb/write-guide.js';
import { buildCapturePayload } from '../hooks/capture-payload.mjs';

/** The shape block for one type, from its `{"type":"..."` marker onward. */
function shapeBlock(text: string, type: string): string {
  const i = text.indexOf(`{"type":"${type}"`);
  expect(i, `${type} shape missing entirely`).toBeGreaterThan(-1);
  return text.slice(i, i + 420);
}

const REQUIRED: Record<string, string[]> = {
  'file-single': ['path', 'summary', 'aliases', 'symbols'],
  'file-hub': ['path', 'aliases', 'facets'],
  flow: ['title', 'aliases', 'summary', 'steps'],
};

const payload = buildCapturePayload({
  root: '/tmp/repo', cli: '/tmp/cli.js', sid: 'shape-parity-test', envelope: 'inject',
  entries: [{ path: 'src/a.ts', tier: 'edited', notes: [] }],
});

describe('spec shape parity: capture prompt vs write guide', () => {
  for (const [type, fields] of Object.entries(REQUIRED)) {
    it(`${type} carries ${fields.join('/')} in BOTH copies`, () => {
      for (const [label, text] of [['write guide', WRITE_GUIDE_SHAPES], ['capture prompt', payload]] as const) {
        const block = shapeBlock(text, type);
        for (const f of fields) {
          expect(block, `${label}: ${type} shape is missing "${f}"`).toContain(`"${f}"`);
        }
      }
    });
  }
});

describe('missingFieldsWarning', () => {
  const id = 'src-a-ts-1234';

  it('names aliases and symbols on a bare file note, and prints a re-put that merges', () => {
    const w = missingFieldsWarning({ type: 'file-single', path: 'src/a.ts', summary: 's' } as never, id);
    expect(w).toContain('"aliases"');
    expect(w).toContain('symbols');
    // The fix line must carry the id, or "retry" means "write a second note".
    expect(w).toContain(`"id":"${id}"`);
    expect(w).toContain('"path":"src/a.ts"');
  });

  it('is silent once a file note carries both', () => {
    const spec = {
      type: 'file-single', path: 'src/a.ts', summary: 's', aliases: ['alias words'],
      anchors: [{ path: 'src/a.ts', symbols: ['doThing'] }],
    };
    expect(missingFieldsWarning(spec as never, id)).toBeNull();
  });

  it('asks a flow for aliases but never for anchor symbols (its symbols ride on steps)', () => {
    const w = missingFieldsWarning({ type: 'flow', title: 't', steps: [{ path: 'src/a.ts' }] } as never, id);
    expect(w).toContain('"aliases"');
    expect(w).not.toContain('anchors[].symbols');
  });

  it('asks a lesson for scope.terms instead of aliases — it has no anchors at all', () => {
    const w = missingFieldsWarning({ type: 'lesson', kind: 'absence', title: 't' } as never, id);
    expect(w).toContain('scope.terms');
    expect(w).not.toContain('"aliases"');
  });

  it('says nothing on a retraction', () => {
    expect(missingFieldsWarning({ op: 'retract', id, reason: 'wrong' } as never, id)).toBeNull();
  });
});
