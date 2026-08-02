/**
 * `kb repair-aliases` assembles a paginated, read-only worklist for
 * reconciling identityAliases — distinct from `kb repair`'s
 * missing-identity-aliases check (that one catches notes with NONE at all;
 * this one surfaces what's hidden past the render cap on notes that already
 * have some, so an agent can retract with full visibility). It never writes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planAliasRepair, aliasRepairWorklist } from '../src/kb/alias-repair.js';
import { kbWrite } from '../src/kb/write.js';
import { initSkeleton } from '../src/kb/store.js';
import { readFileSync, readdirSync } from 'node:fs';
import { notebookDir } from '../src/kb/store.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-alias-repair-'));
  initSkeleton(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function rawSnapshot(): string {
  const dir = join(notebookDir(root), '.raw');
  return readdirSync(dir).sort().map((f) => `${f}:${readFileSync(join(dir, f), 'utf8')}`).join('\n');
}

describe('planAliasRepair', () => {
  it('is empty on a fresh notebook', () => {
    const page = planAliasRepair(root);
    expect(page.total).toBe(0);
    expect(page.entries).toEqual([]);
    expect(page.more).toBeUndefined();
  });

  it('includes file and flow notes, never lessons', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's', identityAliases: ['a thing'] } as never, { force: true });
    await kbWrite(root, {
      type: 'flow', title: 'how x happens', identityAliases: ['x flow'], summary: 'fact',
      steps: [{ path: 'src/a.ts', role: 'entry' }], verified: ['src/a.ts'],
    } as never, { force: true, isNew: true });
    await kbWrite(root, {
      type: 'lesson', kind: 'absence', title: 'no retry logic', body: 'looked, absent',
      scope: { terms: ['retry'] },
    } as never, { force: true, isNew: true });

    const page = planAliasRepair(root);
    expect(page.total).toBe(2);
    expect(page.entries.map((e) => e.type).sort()).toEqual(['file', 'flow']);
  });

  it('reports the hidden-past-cap aliases alongside the capped render', async () => {
    // 5 writes x 6 aliases = 30 identity aliases, capped render keeps the newest ~12.
    for (let w = 0; w < 5; w++) {
      await kbWrite(root, {
        type: 'file-single', path: 'src/a.ts', summary: `s${w}`,
        identityAliases: Array.from({ length: 6 }, (_, i) => `w${w}alias${i}`),
      } as never, { force: true });
    }
    const page = planAliasRepair(root);
    const entry = page.entries[0];
    expect(entry.identityAliases.length).toBeLessThan(30);
    expect(entry.hiddenIdentityAliases).toContain('w0alias0');
    expect(entry.identityAliases).not.toContain('w0alias0');
    // Nothing double-counted: hidden + capped together account for the full union.
    expect(new Set([...entry.identityAliases, ...entry.hiddenIdentityAliases]).size).toBe(30);
  });

  it('an under-cap note has no hidden aliases', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's', identityAliases: ['one', 'two'] } as never, { force: true });
    const page = planAliasRepair(root);
    expect(page.entries[0].hiddenIdentityAliases).toEqual([]);
  });

  it('paginates: default limit 10, stable id order, "more" only when truncated', async () => {
    for (let i = 0; i < 13; i++) {
      await kbWrite(root, { type: 'file-single', path: `src/f${i}.ts`, summary: 's', identityAliases: ['a'] } as never, { force: true });
    }
    const first = planAliasRepair(root, 0, 10);
    expect(first.total).toBe(13);
    expect(first.entries).toHaveLength(10);
    expect(first.more).toEqual({ remaining: 3, nextOffset: 10 });

    const second = planAliasRepair(root, first.more!.nextOffset, 10);
    expect(second.entries).toHaveLength(3);
    expect(second.more).toBeUndefined();

    // No overlap and no gap across the two pages.
    const ids = [...first.entries, ...second.entries].map((e) => e.note);
    expect(new Set(ids).size).toBe(13);
  });

  it('ignores retracted notes', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's' } as never, { force: true });
    const id = planAliasRepair(root).entries[0].note;
    await kbWrite(root, { op: 'retract', type: 'file', path: 'src/a.ts', id, reason: 'wrong', target: { kind: 'note' } } as never, { force: true });
    expect(planAliasRepair(root).total).toBe(0);
  });

  it('writes nothing — pure read', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's', identityAliases: ['a'] } as never, { force: true });
    const before = rawSnapshot();
    planAliasRepair(root);
    expect(rawSnapshot()).toBe(before);
  });
});

describe('aliasRepairWorklist', () => {
  it('says so plainly when there is nothing to reconcile', () => {
    expect(aliasRepairWorklist(planAliasRepair(root))).toBe('No file/flow notes to reconcile.');
  });

  it('names the note, its files, capped + hidden aliases, and the batching instruction', async () => {
    for (let w = 0; w < 5; w++) {
      await kbWrite(root, {
        type: 'file-single', path: 'src/a.ts', summary: `s${w}`,
        identityAliases: Array.from({ length: 6 }, (_, i) => `w${w}alias${i}`),
      } as never, { force: true });
    }
    const text = aliasRepairWorklist(planAliasRepair(root));
    expect(text).toContain('src/a.ts');
    expect(text).toContain('hidden past cap');
    expect(text).toContain('w0alias0');
    expect(text).toContain('&&');
    expect(text).toContain('kb write');
  });

  it('tells the agent to mark the batch verified and re-run with no offset, when truncated', async () => {
    for (let i = 0; i < 11; i++) {
      await kbWrite(root, { type: 'file-single', path: `src/f${i}.ts`, summary: 's', identityAliases: ['a'] } as never, { force: true });
    }
    const text = aliasRepairWorklist(planAliasRepair(root, 0, 10));
    expect(text).toContain('aliasesVerified:true');
    expect(text).toContain('NO --offset');
    expect(text).toContain('1 more note');
  });

  it('a note marked aliasesVerified with nothing else changed does not resurface', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's', identityAliases: ['a'] } as never, { force: true });
    const id = planAliasRepair(root).entries[0].note;
    expect(planAliasRepair(root).total).toBe(1);
    await kbWrite(root, { id, type: 'file', path: 'src/a.ts', aliasesVerified: true } as never, { force: true });
    expect(planAliasRepair(root).total).toBe(0);
    expect(aliasRepairWorklist(planAliasRepair(root))).toBe('No file/flow notes to reconcile.');
  });

  it('a later unrelated write to identityAliases makes a verified note reappear', async () => {
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 's', identityAliases: ['a'] } as never, { force: true });
    const id = planAliasRepair(root).entries[0].note;
    await kbWrite(root, { id, type: 'file', path: 'src/a.ts', aliasesVerified: true } as never, { force: true });
    expect(planAliasRepair(root).total).toBe(0);
    await kbWrite(root, { id, type: 'file', path: 'src/a.ts', identityAliases: ['b'] } as never, { force: true });
    expect(planAliasRepair(root).total).toBe(1);
  });

  it('marking a batch verified does not skip notes on the next default-offset call — the pagination bug', async () => {
    // 15 notes, page size 10: mark ALL of page 1 verified, then re-call with
    // the SAME (default) offset — every one of the 5 that were originally at
    // positions 10-14 must still show up, not just the ones that happen to
    // land at the new front after the first 10 drop out.
    for (let i = 0; i < 15; i++) {
      await kbWrite(root, { type: 'file-single', path: `src/g${i}.ts`, summary: 's', identityAliases: ['a'] } as never, { force: true });
    }
    const page1 = planAliasRepair(root, 0, 10);
    expect(page1.entries).toHaveLength(10);
    const page1Ids = new Set(page1.entries.map((e) => e.note));
    for (const e of page1.entries) {
      await kbWrite(root, { id: e.note, type: 'file', path: e.paths[0], aliasesVerified: true } as never, { force: true });
    }
    const page2 = planAliasRepair(root, 0, 10); // no offset increment — the fix
    expect(page2.total).toBe(5);
    expect(page2.entries).toHaveLength(5);
    for (const e of page2.entries) expect(page1Ids.has(e.note)).toBe(false); // none re-shown, none skipped
  });
});
