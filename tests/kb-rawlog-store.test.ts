import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { appendRecord, readLog, listIds, rawPath } from '../src/kb/raw-log.js';
import { initSkeleton, loadAll, loadNote, renderIds, notePath, notebookDir } from '../src/kb/store.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-kb-test-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('kb raw-log', () => {
  it('appendRecord stamps v/ts and injects a live hash for verified paths only', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1;\n');

    const rec = appendRecord(root, {
      id: 'n1', type: 'lesson', op: 'put',
      title: 'a lesson',
      anchors: [{ path: 'src/a.ts' }, { path: 'src/unverified.ts' }],
      verified: ['src/a.ts'],
    });
    expect(rec.v).toBe(1);
    expect(typeof rec.ts).toBe('string');
    const a = rec.anchors!.find((x) => x.path === 'src/a.ts')!;
    expect(a.hash).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(rec.anchors!.find((x) => x.path === 'src/unverified.ts')!.hash).toBeUndefined();

    // A verified path with no matching anchor gets one added.
    const rec2 = appendRecord(root, { id: 'n1', type: 'lesson', op: 'put', verified: ['src/a.ts'] });
    expect(rec2.anchors).toHaveLength(1);

    // A verified path whose file is gone stamps "missing" — an honest signal.
    const rec3 = appendRecord(root, { id: 'n1', type: 'lesson', op: 'put', verified: ['src/gone.ts'] });
    expect(rec3.anchors![0].hash).toBe('missing');
  });

  it('append rejects invalid envelope; read tolerates garbage lines', () => {
    expect(() => appendRecord(root, { id: 'Bad Id!', type: 'lesson', op: 'put' })).toThrow(/invalid note id/);
    expect(() => appendRecord(root, { id: 'ok', type: 'nope' as never, op: 'put' })).toThrow(/invalid note type/);
    expect(() => appendRecord(root, { id: 'ok', type: 'lesson', op: 'zap' as never })).toThrow(/invalid op/);

    appendRecord(root, { id: 'n2', type: 'flow', op: 'put', title: 't' });
    fs.appendFileSync(rawPath(root, 'n2'), 'THIS IS NOT JSON\n{"v":1,"ts":"2026-01-01T00:00:00Z","id":"n2","type":"flow","op":"put","summary":"ok"}\n');
    const { records, warnings } = readLog(root, 'n2');
    expect(records).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('unparseable');
  });

  it('listIds reflects the raw dir; missing notebook → empty', () => {
    expect(listIds(root)).toEqual([]);
    appendRecord(root, { id: 'b-note', type: 'file', op: 'put', summary: 's' });
    appendRecord(root, { id: 'a-note', type: 'lesson', op: 'put', title: 't' });
    expect(listIds(root)).toEqual(['a-note', 'b-note']);
  });
});

describe('kb store', () => {
  it('initSkeleton is idempotent and writes okf.yaml + notebook .gitignore', () => {
    initSkeleton(root);
    initSkeleton(root);
    const nb = notebookDir(root);
    expect(fs.readFileSync(path.join(nb, 'okf.yaml'), 'utf8')).toContain('okf_version');
    expect(fs.readFileSync(path.join(nb, '.gitignore'), 'utf8')).toContain('notes/');
  });

  it('loadAll folds every log; loadNote memoizes by mtime and sees appends', () => {
    appendRecord(root, { id: 'n1', type: 'lesson', op: 'put', title: 'first' });
    appendRecord(root, { id: 'n2', type: 'flow', op: 'put', title: 'flow' });
    const { notes } = loadAll(root);
    expect(notes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);

    // mtime memo must not serve stale folds after an append
    const before = loadNote(root, 'n1').note!;
    expect(before.title).toBe('first');
    // ensure a different mtime even on coarse filesystems
    const p = rawPath(root, 'n1');
    appendRecord(root, { id: 'n1', type: 'lesson', op: 'put', title: 'second' });
    fs.utimesSync(p, new Date(), new Date(Date.now() + 2000));
    expect(loadNote(root, 'n1').note!.title).toBe('second');
  });

  it('renderIds writes derived md for folded notes', () => {
    appendRecord(root, { id: 'n1', type: 'lesson', op: 'put', title: 'The Lesson', body: 'body text' });
    const rendered = renderIds(root);
    expect(rendered).toEqual(['n1']);
    const md = fs.readFileSync(notePath(root, 'n1'), 'utf8');
    expect(md).toContain('type: lesson');
    expect(md).toContain('# The Lesson');
    expect(md).toContain('body text');
  });
});
