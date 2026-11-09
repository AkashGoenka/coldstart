/**
 * The required-field shape used to be hand-maintained in three places — the
 * `kb write` guide, the capture prompt's inlined shapes, and the MCP kb_write
 * tool description — and they drifted, silently, for months: the capture
 * prompt's flow shape lost "aliases" and every flow written from it went into
 * the notebook reachable only by its exact title, while the MCP description
 * never mentioned "aliases" at all.
 *
 * They now all render from hooks/note-shape.mjs. These tests pin every consumer
 * to that one table, so a field cannot go missing from one surface again.
 */
import { describe, it, expect } from 'vitest';
import {
  SPEC_SHAPES, NOTE_CHECKS, checksForSpec, shapesBlock, requiredFieldsLine, unanchoredSteps,
} from '../hooks/note-shape.mjs';
import { WRITE_GUIDE_SHAPES, missingFieldsWarning, flowStepsWarning } from '../src/kb/write-guide.js';
import { TOOL_DEFINITIONS } from '../src/server/mcp.js';
import { buildCapturePayload } from '../hooks/capture-payload.mjs';
import { USER_COMMANDS, REPAIR_ALIASES_COMMAND } from '../src/init.js';

const payload = buildCapturePayload({
  root: '/tmp/repo', cli: '/tmp/cli.js', sid: 'shape-parity-test', envelope: 'inject',
  entries: [{ path: 'src/a.ts', tier: 'edited', notes: [] }],
});
const kbWriteTool = TOOL_DEFINITIONS.find((t) => t.name === 'kb_write')!;

describe('the table is the shape', () => {
  it('every check names a spec type and a note type that actually exist', () => {
    const specTypes = new Set([...SPEC_SHAPES.map((s) => s.spec), 'file']);
    const noteTypes = new Set(SPEC_SHAPES.map((s) => s.noteType));
    for (const c of NOTE_CHECKS) {
      for (const t of c.specTypes) expect(specTypes, `${c.check} → ${t}`).toContain(t);
      for (const t of c.noteTypes) expect(noteTypes, `${c.check} → ${t}`).toContain(t);
    }
  });

  it('every required field appears in the spec example an agent copies', () => {
    for (const s of SPEC_SHAPES) {
      for (const c of checksForSpec(s.spec)) {
        // The bare field name, minus the JSON-path decoration in `field`.
        const key = (c.fieldBySpec?.[s.spec] ?? c.field).replace(/^.*\./, '').replace(/\[\]$/, '');
        expect(s.example, `${s.spec} example is missing "${key}"`).toContain(`"${key}"`);
      }
    }
  });
});

describe('every surface renders from the table', () => {
  const surfaces: [string, string][] = [
    ['write guide', WRITE_GUIDE_SHAPES],
    ['capture prompt', payload],
  ];

  for (const [label, text] of surfaces) {
    it(`${label} carries every spec example verbatim`, () => {
      for (const s of SPEC_SHAPES) {
        // The first line of the example is enough to prove the rendering came
        // from the table rather than from a copy someone typed alongside it.
        const first = s.example.trim().split('\n')[0];
        expect(text, `${label} lost the ${s.spec} shape`).toContain(first);
      }
    });
  }

  it('both renderings agree on the fields, differing only in prose', () => {
    const full = shapesBlock();
    const compact = shapesBlock({ compact: true });
    for (const s of SPEC_SHAPES) {
      for (const c of checksForSpec(s.spec)) {
        const key = (c.fieldBySpec?.[s.spec] ?? c.field).replace(/^.*\./, '').replace(/\[\]$/, '');
        expect(full).toContain(`"${key}"`);
        expect(compact).toContain(`"${key}"`);
      }
    }
    expect(compact.length).toBeLessThan(full.length); // compact drops the prose
  });

  it('the MCP kb_write description names the required fields', () => {
    expect(kbWriteTool.description).toContain(requiredFieldsLine());
  });

  it('exposes kb_repair, so no-shell clients can find their unfindable notes', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain('kb_repair');
  });
});

describe('no surface still claims a flow is anchored by its steps', () => {
  // It is anchored by `verified`. Three shipped texts said otherwise, which is
  // why flows ended up describing files they were not filed at.
  const texts: [string, string][] = [
    ['write guide', WRITE_GUIDE_SHAPES],
    ['capture prompt', payload],
    ['stepless-flow warning', flowStepsWarning({ type: 'flow', title: 't' } as never, null) ?? ''],
  ];
  for (const [label, text] of texts) {
    it(`${label} says anchors come from "verified"`, () => {
      expect(text.toLowerCase(), `${label} still says anchors come from steps`)
        .not.toMatch(/anchors come from (its )?"?steps/);
      expect(text).toContain('verified');
    });
  }
});

describe('write-time warnings use the same checks kb repair does', () => {
  const id = 'src-a-ts-1234';

  it('names symbols on a bare file note, and prints a re-put that merges', () => {
    const w = missingFieldsWarning({ type: 'file-single', path: 'src/a.ts', summary: 's' } as never, id)!;
    expect(w).not.toContain('Aliases');
    expect(w).toContain('symbols');
    // The fix line must carry the id, or "retry" means "write a second note".
    expect(w).toContain(`"id":"${id}"`);
    expect(w).toContain('"path":"src/a.ts"');
  });

  it('is silent once a file note carries symbols', () => {
    expect(missingFieldsWarning({
      type: 'file-single', path: 'src/a.ts', summary: 's',
      anchors: [{ path: 'src/a.ts', symbols: ['doThing'] }],
    } as never, id)).toBeNull();
  });

  it('accepts a hub that supplies its symbols as facets', () => {
    expect(missingFieldsWarning({
      type: 'file-hub', path: 'src/y.ts',
      facets: [{ symbol: 'alpha', detail: 'the thing' }],
    } as never, id)).toBeNull();
  });

  it('never asks a flow for anchor symbols (its symbols ride on steps)', () => {
    expect(missingFieldsWarning({ type: 'flow', title: 't', steps: [{ path: 'src/a.ts' }] } as never, id)).toBeNull();
  });

  it('asks a lesson for scope.terms — it has no anchors at all', () => {
    const w = missingFieldsWarning({ type: 'lesson', kind: 'absence', title: 't' } as never, id)!;
    expect(w).toContain('scope.terms');
    expect(w).not.toContain('Aliases');
  });

  it('says nothing on a retraction', () => {
    expect(missingFieldsWarning({ op: 'retract', id, reason: 'wrong' } as never, id)).toBeNull();
  });
});

describe('missingFieldsWarning judges the folded note, not the spec', () => {
  // `op: 'put'` appends a record; the note is the fold of the log, and
  // anchors UNION.
  // So an update that omits a field has not dropped it — judging the record
  // alone told every repair write it was still incomplete.
  const id = 'src-a-ts-1234';
  const bare = { id, type: 'file-single', path: 'src/a.ts', verified: ['src/a.ts'] } as never;

  it('stays silent when the fold already carries what the spec omitted', () => {
    expect(missingFieldsWarning(bare, id, {
      id, type: 'file',
      anchors: [{ path: 'src/a.ts', symbols: ['doThing'] }],
    })).toBeNull();
  });

  it('still fires when the note really lacks the field', () => {
    const w = missingFieldsWarning(bare, id, {
      id, type: 'file', anchors: [{ path: 'src/a.ts', symbols: [] }],
    })!;
    expect(w).toContain('symbols');
  });

  it('falls back to judging the spec when no folded note is supplied', () => {
    expect(missingFieldsWarning(bare, id)).toContain('symbols');
  });
});

describe('flowStepsWarning judges the folded note, not the spec', () => {
  it('stays silent on a partial update that keeps its stored steps', () => {
    const spec = { type: 'flow', id: 'f', invariants: ['more words'] };
    expect(flowStepsWarning(spec as never, { steps: [{ path: 'src/a.ts' }] })).toBeNull();
  });

  it('fires when the note really has no chain', () => {
    expect(flowStepsWarning({ type: 'flow', title: 't' } as never, { steps: [] })).toContain('no "steps"');
  });
});

describe('unanchoredSteps', () => {
  it('returns the step paths the note is not filed at, deduped and in order', () => {
    expect(unanchoredSteps({
      id: 'f',
      anchors: [{ path: 'src/a.ts' }],
      steps: [{ path: 'src/a.ts' }, { path: 'src/c.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }],
    })).toEqual(['src/c.ts', 'src/b.ts']);
  });
});

describe('search aliases are gone from every surface', () => {
  const texts: [string, string][] = [
    ['write guide', WRITE_GUIDE_SHAPES],
    ['capture prompt', payload],
    ['kb_write tool', JSON.stringify(kbWriteTool)],
    ['required-fields line', requiredFieldsLine()],
  ];
  for (const [label, text] of texts) {
    it(`${label} never asks for identityAliases / incidentAliases`, () => {
      expect(text).not.toMatch(/identityAliases|incidentAliases/);
    });
  }

  it('the alias checks stay registered but never fire (shipped ids are never deleted)', () => {
    for (const id of ['missing-aliases', 'missing-identity-aliases']) {
      const c = NOTE_CHECKS.find((x) => x.check === id)!;
      expect(c).toBeDefined();
      expect(c.specTypes).toEqual([]);
      expect(c.noteTypes).toEqual([]);
    }
  });

  it('no kb_repair_aliases tool and no /repair-aliases user command', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).not.toContain('kb_repair_aliases');
    expect(Object.values(USER_COMMANDS).map((c) => c.name)).not.toContain(REPAIR_ALIASES_COMMAND);
  });
});
