/**
 * Batch write (`kbWriteBatch`) — the capture write path. The agent authors ALL
 * its notes as one array and writes them in a single call: well-formed notes
 * land, malformed ones are reported together (not atomic), coverage is finalized
 * once against the durable worklist, and a retract with the documented
 * target-form actually removes a note.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { kbWriteBatch } from '../src/kb/write-batch.js';
import { kbWrite } from '../src/kb/write.js';
import { loadNote, initSkeleton } from '../src/kb/store.js';
import { fileNoteId } from '../src/kb/ids.js';
import { worklistJsonPath } from '../src/kb/durable-worklist.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-kb-batch-'));
  initSkeleton(root);
  writeRepoFile('src/a.ts', 'export function A() {}\n');
  writeRepoFile('src/b.ts', 'export function B() {}\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function writeRepoFile(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
const SID = 'sess1';
const AID = 'main';
function seedWorklist(files: { path: string; tier: string; needsNote: boolean }[]): void {
  fs.writeFileSync(worklistJsonPath(root, SID, AID), JSON.stringify({ ts: Date.now(), sid: SID, aid: AID, files, wrote: [] }));
}

describe('kbWriteBatch', () => {
  it('writes the valid notes and reports the invalid one together', async () => {
    const res = await kbWriteBatch(root, [
      { type: 'file-single', path: 'src/a.ts', summary: 'purpose of a', anchors: [{ path: 'src/a.ts', symbols: ['A'] }] },
      { type: 'file' } as never, // no character, no path → error
      { type: 'file-single', path: 'src/b.ts', summary: 'purpose of b', anchors: [{ path: 'src/b.ts', symbols: ['B'] }] },
    ], { force: true });

    expect(res.written).toBe(2);
    expect(res.errors).toBe(1);
    // A malformed note does not silence the good ones on either side of it.
    expect(loadNote(root, fileNoteId('src/a.ts')).note).not.toBeNull();
    expect(loadNote(root, fileNoteId('src/b.ts')).note).not.toBeNull();
    const bad = res.outcomes.find((o) => o.status === 'error');
    expect(bad?.message).toBeTruthy();
  });

  it('finalizes coverage once against the durable worklist and names what is left', async () => {
    seedWorklist([
      { path: 'src/a.ts', tier: 'edited', needsNote: true },
      { path: 'src/b.ts', tier: 'edited', needsNote: true },
    ]);
    const res = await kbWriteBatch(root, [
      { type: 'file-single', path: 'src/a.ts', summary: 'a', anchors: [{ path: 'src/a.ts', symbols: ['A'] }] },
    ], { force: true, session: SID, agent: AID });
    expect(res.coverage).toContain('1 of 2 worklist files noted');
    expect(res.coverage).toContain('src/b.ts [edited]');
  });

  it('retract with target:{kind:"note"} removes a note — no type/path needed (the documented form)', async () => {
    const id = fileNoteId('src/a.ts');
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 'a' }, { force: true });
    expect(loadNote(root, id).note?.status).toBe('active');
    const res = await kbWriteBatch(root, [
      { op: 'retract', id, target: { kind: 'note' } } as never,
    ], { force: true });
    expect(res.errors).toBe(0);
    expect(res.written).toBe(1);
    expect(loadNote(root, id).note?.status).toBe('retracted');
  });

  it('a bare retract without a target still errors (unchanged validation)', async () => {
    const id = fileNoteId('src/a.ts');
    await kbWrite(root, { type: 'file-single', path: 'src/a.ts', summary: 'a' }, { force: true });
    const res = await kbWriteBatch(root, [
      { op: 'retract', id } as never,
    ], { force: true });
    expect(res.errors).toBe(1);
    expect(res.outcomes[0].message).toContain('target');
  });
});
