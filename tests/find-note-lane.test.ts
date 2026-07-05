import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildNoteMap, noteLine } from '../src/server/find.js';
import { appendRecord } from '../src/kb/raw-log.js';
import { hashFile } from '../src/kb/freshness.js';

/**
 * find's notebook lane: one agent-authored Note: line per previewed file.
 * Query-aware pick on hub files (term hits on title/aliases beat type rank),
 * freshness stamped per displayed file, zero output without a notebook.
 */
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-notelane-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeRepoFile(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('find note lane', () => {
  it('no notebook → empty map (zero-cost default)', () => {
    expect(buildNoteMap(root, ['anything']).size).toBe(0);
  });

  it('hub file: the query-matching note wins over a higher-ranked off-topic one', () => {
    writeRepoFile('app/models.py', 'class SpatialView: pass\n');
    // flow (rank 1) anchors models.py but is about lifecycle — off-topic here
    appendRecord(root, {
      id: 'lifecycle-flow', type: 'flow', op: 'put',
      title: 'resource lifecycle state changes dispatch to hooks',
      summary: 'lifecycle dispatch.',
      steps: [{ path: 'app/models.py', role: 'persists new lifecycle state' }],
      anchors: [{ path: 'app/models.py' }], // kbWrite derives these from steps
    });
    // lesson (rank 2) is what the query is actually about
    appendRecord(root, {
      id: 'spatialview-dropdown', type: 'lesson', op: 'put', kind: 'bug-cause',
      title: 'spatialview geometrynode dropdown shows wrong nodes',
      body: 'limit_choices_to filters datatype only.',
      anchors: [{ path: 'app/models.py' }],
    });
    const offTopic = buildNoteMap(root, ['lifecycle', 'hooks']);
    expect(offTopic.get('app/models.py')!.note.id).toBe('lifecycle-flow');
    const onTopic = buildNoteMap(root, ['spatialview', 'geometrynode']);
    expect(onTopic.get('app/models.py')!.note.id).toBe('spatialview-dropdown');
    // no term hits either way → type rank decides (flow beats lesson)
    const neutral = buildNoteMap(root, ['unrelated']);
    expect(neutral.get('app/models.py')!.note.id).toBe('lifecycle-flow');
  });

  it('noteLine: flow renders step role, lesson renders kind+title, freshness stamps the displayed file', () => {
    writeRepoFile('app/models.py', 'v1\n');
    const goodHash = hashFile(root, 'app/models.py');
    appendRecord(root, {
      id: 'fresh-lesson', type: 'lesson', op: 'put', kind: 'trap',
      title: 'a trap about models', body: 'body.',
      anchors: [{ path: 'app/models.py', hash: goodHash }],
    });
    const map = buildNoteMap(root, ['trap', 'models']);
    const line = noteLine(root, 'app/models.py', map.get('app/models.py')!);
    expect(line).toContain('Note:  trap: a trap about models');
    expect(line).toContain('[fresh]');
    expect(line).toContain('kb: fresh-lesson');

    fs.writeFileSync(path.join(root, 'app/models.py'), 'v2 drifted\n');
    expect(noteLine(root, 'app/models.py', map.get('app/models.py')!)).toContain('[evidence changed]');

    appendRecord(root, {
      id: 'a-flow', type: 'flow', op: 'put', title: 'how saving works',
      summary: 's.', steps: [{ path: 'app/save.py', role: 'receives the request' }],
      anchors: [{ path: 'app/save.py' }],
    });
    writeRepoFile('app/save.py', 'x\n');
    const flowMap = buildNoteMap(root, ['saving']);
    const flowLine = noteLine(root, 'app/save.py', flowMap.get('app/save.py')!);
    expect(flowLine).toContain('part of "how saving works"');
    expect(flowLine).toContain('receives the request');
  });

  it('superseded notes never annotate', () => {
    writeRepoFile('app/x.py', 'x\n');
    appendRecord(root, {
      id: 'dead', type: 'lesson', op: 'put', kind: 'trap', title: 'old truth about xpy',
      body: 'b.', anchors: [{ path: 'app/x.py' }],
    });
    appendRecord(root, { id: 'dead', type: 'lesson', op: 'supersede', by: 'dead' });
    expect(buildNoteMap(root, ['xpy']).has('app/x.py')).toBe(false);
  });
});
