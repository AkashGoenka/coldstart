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
import { aliasRepairWorklist, type AliasRepairPage } from '../src/kb/alias-repair.js';

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

  it('the MCP kb_write description names the required fields — it never did', () => {
    expect(kbWriteTool.description).toContain(requiredFieldsLine());
    expect(kbWriteTool.description).toContain('identityAliases');
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

  it('names identityAliases and symbols on a bare file note, and prints a re-put that merges', () => {
    const w = missingFieldsWarning({ type: 'file-single', path: 'src/a.ts', summary: 's' } as never, id)!;
    expect(w).toContain('"identityAliases"');
    expect(w).toContain('symbols');
    // The fix line must carry the id, or "retry" means "write a second note".
    expect(w).toContain(`"id":"${id}"`);
    expect(w).toContain('"path":"src/a.ts"');
  });

  it('is silent once a file note carries both', () => {
    expect(missingFieldsWarning({
      type: 'file-single', path: 'src/a.ts', summary: 's', identityAliases: ['alias words'],
      anchors: [{ path: 'src/a.ts', symbols: ['doThing'] }],
    } as never, id)).toBeNull();
  });

  it('accepts a hub that supplies its symbols as facets', () => {
    expect(missingFieldsWarning({
      type: 'file-hub', path: 'src/y.ts', identityAliases: ['grab bag'],
      facets: [{ symbol: 'alpha', detail: 'the thing' }],
    } as never, id)).toBeNull();
  });

  it('asks a flow for identityAliases but never for anchor symbols (its symbols ride on steps)', () => {
    const w = missingFieldsWarning({ type: 'flow', title: 't', steps: [{ path: 'src/a.ts' }] } as never, id)!;
    expect(w).toContain('"identityAliases"');
    expect(w).not.toContain('anchors[].symbols');
  });

  it('asks a lesson for scope.terms instead of identityAliases — it has no anchors at all', () => {
    const w = missingFieldsWarning({ type: 'lesson', kind: 'absence', title: 't' } as never, id)!;
    expect(w).toContain('scope.terms');
    expect(w).not.toContain('"identityAliases"');
  });

  it('says nothing on a retraction', () => {
    expect(missingFieldsWarning({ op: 'retract', id, reason: 'wrong' } as never, id)).toBeNull();
  });
});

describe('missingFieldsWarning judges the folded note, not the spec', () => {
  // `op: 'put'` appends a record; the note is the fold of the log, and
  // identityAliases and anchors UNION (incidentAliases don't — see fold.ts).
  // So an update that omits a field has not dropped it — judging the record
  // alone told every repair write it was still incomplete.
  const id = 'src-a-ts-1234';
  const bare = { id, type: 'file-single', path: 'src/a.ts', verified: ['src/a.ts'] } as never;

  it('stays silent when the fold already carries what the spec omitted', () => {
    expect(missingFieldsWarning(bare, id, {
      id, type: 'file', identityAliases: ['the thing'],
      anchors: [{ path: 'src/a.ts', symbols: ['doThing'] }],
    })).toBeNull();
  });

  it('still fires when the note really lacks the field', () => {
    const w = missingFieldsWarning(bare, id, {
      id, type: 'file', identityAliases: [], anchors: [{ path: 'src/a.ts', symbols: [] }],
    })!;
    expect(w).toContain('"identityAliases"');
    expect(w).toContain('symbols');
  });

  it('reports only the fields still missing, not every field the spec omitted', () => {
    const w = missingFieldsWarning(bare, id, {
      id, type: 'file', identityAliases: ['the thing'],
      anchors: [{ path: 'src/a.ts', symbols: [] }],
    })!;
    expect(w).toContain('symbols');
    expect(w).not.toContain('"identityAliases"');
  });

  it('falls back to judging the spec when no folded note is supplied', () => {
    expect(missingFieldsWarning(bare, id)).toContain('"identityAliases"');
  });
});

describe('flowStepsWarning judges the folded note, not the spec', () => {
  it('stays silent on an alias-only update that keeps its stored steps', () => {
    const spec = { type: 'flow', id: 'f', identityAliases: ['more words'] };
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

describe('kb repair-aliases surfaces agree with each other and with the frozen field name', () => {
  // identityAliases never appears in a spec an agent writes for THIS command
  // (repair-aliases only reconciles it, never asks for it) — so nothing here
  // is pinned by the SPEC_SHAPES checks above. Without this, alias-repair.ts's
  // own field names, the MCP tool description, and USER_COMMANDS.repairAliases
  // could drift apart exactly the way the capture prompt did (this file's
  // header) and nothing would notice.
  const repairAliasesTool = TOOL_DEFINITIONS.find((t) => t.name === 'kb_repair_aliases')!;
  const identityAliasesCheck = NOTE_CHECKS.find((c) => c.check === 'missing-identity-aliases')!;
  const emptyPage: AliasRepairPage = { total: 0, offset: 0, entries: [] };
  const onePage: AliasRepairPage = {
    total: 1,
    offset: 0,
    entries: [{
      note: 'x', type: 'file', title: 't', notePath: 'x.md', paths: ['src/x.ts'],
      identityAliases: ['a'], hiddenIdentityAliases: [], incidentAliases: [],
    }],
  };

  it('the field note-shape.mjs freezes is the one alias-repair.ts reconciles', () => {
    expect(identityAliasesCheck.field).toBe('identityAliases');
    expect(aliasRepairWorklist(onePage)).toContain('identityAliases');
  });

  it('the CLI worklist, the MCP description, and the /repair-aliases descriptions all name identityAliases', () => {
    const surfaces: [string, string][] = [
      ['aliasRepairWorklist', aliasRepairWorklist(onePage)],
      ['kb_repair_aliases tool description', repairAliasesTool.description],
      ['USER_COMMANDS.repairAliases.description', USER_COMMANDS.repairAliases.description],
      ['USER_COMMANDS.repairAliases.skillDescription', USER_COMMANDS.repairAliases.skillDescription],
    ];
    for (const [label, text] of surfaces) {
      expect(text, `${label} lost "identityAliases"`).toContain('identityAliases');
    }
  });

  it('the MCP and skill descriptions still distinguish this from kb_repair\'s missing-aliases check', () => {
    // The one line that, if it silently vanished, would have an agent run
    // repair-aliases on a note with NO aliases instead of the cheap
    // missing-identity-aliases fix repair-notes already gives it.
    expect(repairAliasesTool.description.toLowerCase()).toContain('no aliases at all');
    expect(USER_COMMANDS.repairAliases.skillDescription.toLowerCase()).toContain('not for');
  });

  it('the empty-notebook sentinel string is the exact one the MCP description promises', () => {
    const empty = aliasRepairWorklist(emptyPage);
    expect(empty).toBe('No file/flow notes to reconcile.');
    expect(repairAliasesTool.description).toContain(empty);
  });

  it('the MCP tool exposes the offset/limit params the pagination footer and description both name', () => {
    const props = Object.keys((repairAliasesTool.inputSchema as { properties: Record<string, unknown> }).properties);
    expect(props).toEqual(expect.arrayContaining(['offset', 'limit']));
    expect(repairAliasesTool.description).toContain('nextOffset');
  });

  it('exposes kb_repair_aliases, so no-shell clients can reconcile aliases too', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain('kb_repair_aliases');
  });

  it('repairAliases rides the same USER_COMMANDS table capture/repair use — not a fourth hand-kept copy', () => {
    expect(Object.keys(USER_COMMANDS)).toEqual(expect.arrayContaining(['capture', 'repair', 'repairAliases']));
    expect(USER_COMMANDS.repairAliases.name).toBe(REPAIR_ALIASES_COMMAND);
  });
});
