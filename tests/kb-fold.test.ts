import { describe, it, expect } from 'vitest';
import { fold, stableStringify } from '../src/kb/fold.js';
import type { RawRecord } from '../src/kb/types.js';

// Shorthand: a valid put record with overrides.
let seq = 0;
function put(over: Partial<RawRecord> = {}): RawRecord {
  seq++;
  return {
    v: 1,
    ts: `2026-07-02T10:00:${String(seq).padStart(2, '0')}.000Z`,
    id: 'n1',
    type: 'lesson',
    op: 'put',
    ...over,
  } as RawRecord;
}

describe('kb fold — determinism', () => {
  it('is order-independent: shuffled input folds identically (ts sort)', () => {
    const records = [
      put({ title: 'first', aliases: ['a'] }),
      put({ title: 'second', aliases: ['b'] }),
      put({ body: 'the body', aliases: ['c'] }),
    ];
    const forward = fold('n1', records).note;
    const reversed = fold('n1', [...records].reverse()).note;
    const shuffled = fold('n1', [records[1], records[2], records[0]]).note;
    expect(stableStringify(reversed)).toEqual(stableStringify(forward));
    expect(stableStringify(shuffled)).toEqual(stableStringify(forward));
    expect(forward!.title).toBe('second');
    // 'first' was demoted to an alias when 'second' replaced it
    expect(forward!.aliases.sort()).toEqual(['a', 'b', 'c', 'first']);
  });

  it('cross-branch union interleave: A+B and B+A fold identically', () => {
    const branchA = [put({ title: 'from A', invariants: ['inv-A'] })];
    const branchB = [put({ title: 'from B', invariants: ['inv-B'] })];
    const ab = fold('n1', [...branchA, ...branchB]).note;
    const ba = fold('n1', [...branchB, ...branchA]).note;
    expect(stableStringify(ab)).toEqual(stableStringify(ba));
  });

  it('equal ts ties break deterministically via canonical JSON', () => {
    const t = '2026-07-02T12:00:00.000Z';
    const r1 = put({ ts: t, title: 'aaa' });
    const r2 = put({ ts: t, title: 'zzz' });
    const a = fold('n1', [r1, r2]).note;
    const b = fold('n1', [r2, r1]).note;
    expect(a!.title).toEqual(b!.title);
  });
});

describe('kb fold — per-field merge rules', () => {
  it('summary/title LWW; aliases + invariants union', () => {
    const note = fold('n1', [
      put({ type: 'flow', title: 'one', summary: 's1', aliases: ['x'], invariants: ['i1'] }),
      put({ type: 'flow', summary: 's2', aliases: ['x', 'y'], invariants: ['i1', 'i2'] }),
    ]).note!;
    expect(note.title).toBe('one'); // second put had no title — LWW keeps last SET value
    expect(note.summary).toBe('s2');
    expect(note.aliases).toEqual(['x', 'y']);
    expect(note.invariants).toEqual(['i1', 'i2']);
  });

  it('a replaced title is demoted to an alias — old retrieval keys survive merges', () => {
    const note = fold('n1', [
      put({ type: 'flow', title: 'Auth token flow' }),
      put({ type: 'flow', title: 'token minting on login' }),
    ]).note!;
    expect(note.title).toBe('token minting on login');
    expect(note.aliases).toContain('Auth token flow');
    // idempotent: re-putting the same title doesn't self-alias
    const again = fold('n1', [put({ type: 'flow', title: 'same' }), put({ type: 'flow', title: 'same' })]).note!;
    expect(again.aliases).toEqual([]);
  });

  it('behaviors replace by concept_id, keep the others, add new', () => {
    const note = fold('f1', [
      put({ id: 'f1', type: 'file', behaviors: [
        { concept_id: 'caching', detail: 'old detail', symbols: ['getA'] },
        { concept_id: 'retries', detail: 'retries thrice' },
      ] }),
      put({ id: 'f1', type: 'file', behaviors: [
        { concept_id: 'caching', detail: 'new detail' },
        { concept_id: 'locking', detail: 'file lock' },
      ] }),
    ]).note!;
    expect(note.behaviors).toHaveLength(3);
    expect(note.behaviors.find((b) => b.concept_id === 'caching')!.detail).toBe('new detail');
    expect(note.behaviors.find((b) => b.concept_id === 'retries')!.detail).toBe('retries thrice');
    expect(note.behaviors.find((b) => b.concept_id === 'locking')).toBeTruthy();
  });

  it('features union by concept_id, later role wins', () => {
    const note = fold('f1', [
      put({ id: 'f1', type: 'file', features: [{ concept_id: 'auth-flow', role: 'entry' }] }),
      put({ id: 'f1', type: 'file', features: [
        { concept_id: 'auth-flow', role: 'entry point + token mint' },
        { concept_id: 'audit-flow', role: 'emits events' },
      ] }),
    ]).note!;
    expect(note.features).toHaveLength(2);
    expect(note.features.find((f) => f.concept_id === 'auth-flow')!.role).toBe('entry point + token mint');
  });

  it('steps are whole-array LWW (ordered story replaced, not spliced)', () => {
    const note = fold('w1', [
      put({ id: 'w1', type: 'flow', steps: [
        { path: 'a.ts', role: 'start' }, { path: 'b.ts', role: 'middle' }, { path: 'c.ts', role: 'end' },
      ] }),
      put({ id: 'w1', type: 'flow', steps: [
        { path: 'a.ts', role: 'start' }, { path: 'd.ts', role: 'new end' },
      ] }),
    ]).note!;
    expect(note.steps.map((s) => s.path)).toEqual(['a.ts', 'd.ts']);
  });

  it('anchors union by path; hash only updated by records that carry one', () => {
    const note = fold('f1', [
      put({ id: 'f1', type: 'file', anchors: [{ path: 'src/a.ts', hash: 'sha256:aaa', symbols: ['fn'] }] }),
      // Mentioning the anchor WITHOUT a hash (not re-verified) must not wipe it.
      put({ id: 'f1', type: 'file', anchors: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] }),
    ]).note!;
    expect(note.anchors).toHaveLength(2);
    expect(note.anchors.find((a) => a.path === 'src/a.ts')!.hash).toBe('sha256:aaa');
    expect(note.anchors.find((a) => a.path === 'src/b.ts')!.hash).toBeUndefined();
  });

  it('cross-branch hash disagreement: later ts wins deterministically', () => {
    const note = fold('f1', [
      put({ id: 'f1', type: 'file', anchors: [{ path: 'src/a.ts', hash: 'sha256:old' }] }),
      put({ id: 'f1', type: 'file', anchors: [{ path: 'src/a.ts', hash: 'sha256:new' }] }),
    ]).note!;
    expect(note.anchors[0].hash).toBe('sha256:new');
  });
});

describe('kb fold — tombstones', () => {
  it('retract removes a behavior; a LATER put legitimately re-adds', () => {
    const r1 = put({ id: 'f1', type: 'file', behaviors: [{ concept_id: 'x', detail: 'wrong claim' }] });
    const r2 = put({ id: 'f1', type: 'file', op: 'retract', target: { kind: 'behavior', key: 'x' } });
    const r3 = put({ id: 'f1', type: 'file', behaviors: [{ concept_id: 'x', detail: 're-learned' }] });
    expect(fold('f1', [r1, r2]).note!.behaviors).toHaveLength(0);
    // no resurrection from ORDER alone: union-interleave with the retract last
    expect(fold('f1', [r2, r1]).note!.behaviors).toHaveLength(0);
    const revived = fold('f1', [r1, r2, r3]).note!;
    expect(revived.behaviors[0].detail).toBe('re-learned');
  });

  it('retract kinds: anchor by path, alias/invariant by exact text', () => {
    const note = fold('w1', [
      put({ id: 'w1', type: 'flow', aliases: ['keep', 'drop'], invariants: ['inv'], anchors: [{ path: 'a.ts' }, { path: 'b.ts' }] }),
      put({ id: 'w1', type: 'flow', op: 'retract', target: { kind: 'alias', key: 'drop' } }),
      put({ id: 'w1', type: 'flow', op: 'retract', target: { kind: 'anchor', key: 'b.ts' } }),
      put({ id: 'w1', type: 'flow', op: 'retract', target: { kind: 'invariant', key: 'inv' } }),
    ]).note!;
    expect(note.aliases).toEqual(['keep']);
    expect(note.anchors.map((a) => a.path)).toEqual(['a.ts']);
    expect(note.invariants).toEqual([]);
  });

  it('note retract → status retracted; later put revives; supersede is sticky', () => {
    const base = put({ title: 't' });
    const retractNote = put({ op: 'retract', target: { kind: 'note' } });
    expect(fold('n1', [base, retractNote]).note!.status).toBe('retracted');
    expect(fold('n1', [base, retractNote, put({ body: 'again' })]).note!.status).toBe('active');

    const sup = put({ op: 'supersede', by: 'winner-note' });
    const after = fold('n1', [base, sup, put({ body: 'restamp' })]).note!;
    expect(after.status).toBe('superseded');
    expect(after.supersededBy).toBe('winner-note');
    expect(after.body).toBe('restamp'); // content still merges
  });
});

describe('kb fold — tolerant reader', () => {
  it('skips unknown ops, newer majors, malformed records — with warnings, never throwing', () => {
    const good = put({ title: 'good' });
    const { note, warnings } = fold('n1', [
      good,
      { v: 2, ts: '2026-07-02T10:59:00Z', id: 'n1', type: 'lesson', op: 'put', title: 'from the future' },
      { v: 1, ts: '2026-07-02T10:59:01Z', id: 'n1', type: 'lesson', op: 'frobnicate' },
      'not an object',
      { v: 1, id: 'n1', type: 'lesson', op: 'put' }, // missing ts
      null,
    ]);
    expect(note!.title).toBe('good');
    expect(warnings.length).toBe(5);
    expect(warnings.join(' ')).toContain('newer coldstart');
  });

  it('preserves unknown fields (shallow LWW) into extra', () => {
    const note = fold('n1', [
      put({ confidence: 'high', novel_field: { a: 1 } } as Partial<RawRecord>),
      put({ confidence: 'low' } as Partial<RawRecord>),
    ]).note!;
    expect(note.extra['confidence']).toBe('low');
    expect(note.extra['novel_field']).toEqual({ a: 1 });
  });

  it('type is immutable: mismatched-type records are skipped', () => {
    const { note, warnings } = fold('n1', [
      put({ type: 'lesson', title: 'lesson title' }),
      put({ type: 'flow', title: 'flow hijack' }),
    ]);
    expect(note!.type).toBe('lesson');
    expect(note!.title).toBe('lesson title');
    expect(warnings.join(' ')).toContain('type is immutable');
  });

  it('empty/garbage-only log → null note', () => {
    expect(fold('n1', []).note).toBeNull();
    expect(fold('n1', ['junk', 42]).note).toBeNull();
  });

  it('file note with no title falls back to its anchor path', () => {
    const note = fold('f1', [put({ id: 'f1', type: 'file', anchors: [{ path: 'src/x.ts' }], summary: 's' })]).note!;
    expect(note.title).toBe('src/x.ts');
  });
});
