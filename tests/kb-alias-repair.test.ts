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

  it('tells the agent how to fetch the next batch when truncated', async () => {
    for (let i = 0; i < 11; i++) {
      await kbWrite(root, { type: 'file-single', path: `src/f${i}.ts`, summary: 's', identityAliases: ['a'] } as never, { force: true });
    }
    const text = aliasRepairWorklist(planAliasRepair(root, 0, 10));
    expect(text).toContain('--offset 10');
    expect(text).toContain('1 more note');
  });
});
