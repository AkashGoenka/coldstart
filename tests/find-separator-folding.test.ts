import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { foldSep, collectCoverage, buildNoteMap } from '../src/server/find.js';
import { appendRecord } from '../src/kb/raw-log.js';
import type { CodebaseIndex } from '../src/types.js';

/**
 * Separator invariance of the NAME/PATH/SYMBOL channels: `spatial-view`,
 * `spatial_view`, `SpatialView` and `spatialview` are renderings of ONE
 * compound; the name channel must score them identically. (Root-caused from
 * the q16 three-arm trace: the gold migration ranked tail purely because the
 * agent hyphenated its query.) Body/grep matching stays literal — these tests
 * use file contents that contain NO query term, so any coverage must come
 * from the folded name/path/symbol channel.
 */
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-fold-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeRepoFile(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function fakeIndex(files: Record<string, string[]>): CodebaseIndex {
  const map = new Map<string, { path: string; symbols: { name: string }[] }>();
  for (const [rel, syms] of Object.entries(files)) {
    writeRepoFile(rel, 'x = 1\n'); // body carries NO query term
    map.set(rel, { path: path.join(root, rel), symbols: syms.map((name) => ({ name })) });
  }
  return { rootDir: root, files: map } as unknown as CodebaseIndex;
}

describe('separator folding (name/path/symbol channels)', () => {
  it('foldSep collapses kebab/snake to the canonical rendering', () => {
    expect(foldSep('spatial-view')).toBe('spatialview');
    expect(foldSep('spatial_view_source_identifier')).toBe('spatialviewsourceidentifier');
    expect(foldSep('plainword')).toBe('plainword');
  });

  it('all four renderings of one compound reach both the snake-named path and the PascalCase symbol', async () => {
    const index = fakeIndex({
      'app/migrations/11857_spatial_view_source_identifier_filter.py': ['Migration'],
      'app/models.py': ['SpatialView'],
      'app/unrelated.py': ['Widget'],
    });
    for (const variant of ['spatial-view', 'spatial_view', 'spatialview', 'SpatialView']) {
      const cov = await collectCoverage(index, root, [variant]);
      expect(cov.get('app/migrations/11857_spatial_view_source_identifier_filter.py'), variant).toBeDefined();
      expect(cov.get('app/models.py'), variant).toBeDefined();
      expect(cov.get('app/unrelated.py'), variant).toBeUndefined();
    }
  });

  it('note lane: a snake_case query term hits the kebab-case compound in a note title', () => {
    writeRepoFile('app/datatypes.py', 'x = 1\n');
    appendRecord(root, {
      id: 'filelist-note', type: 'lesson', op: 'put', kind: 'absence',
      title: 'file-list datatype matching request files to a tile',
      body: 'b.', anchors: [{ path: 'app/datatypes.py' }],
    });
    appendRecord(root, {
      id: 'off-topic', type: 'flow', op: 'put', title: 'unrelated saving flow',
      summary: 's.', steps: [{ path: 'app/datatypes.py', role: 'saves' }],
      anchors: [{ path: 'app/datatypes.py' }],
    });
    // flow outranks lesson by type; only a term HIT on the lesson's title can win the hub pick
    const picked = buildNoteMap(root, ['file_list']);
    expect(picked.get('app/datatypes.py')!.note.id).toBe('filelist-note');
  });
});
