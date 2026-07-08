import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildViewData, renderViewHtml, kbView } from '../src/kb/view.js';
import { VIEW_TEMPLATE } from '../src/kb/view-template.js';
import { hashFile } from '../src/kb/freshness.js';
import { initSkeleton, notebookDir } from '../src/kb/store.js';

const DATE = '2026-07-08';
let root: string;

function raw(root: string, id: string, record: Record<string, unknown>): void {
  const dir = path.join(notebookDir(root), '.raw');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), JSON.stringify(record) + '\n');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-view-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'auth.ts'), 'export function mint(){ return "t"; }\n');
  initSkeleton(root);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('kb view — buildViewData', () => {
  it('maps notes, derives backlinks, rolls up freshness, strips frontmatter/H1', () => {
    const good = hashFile(root, 'src/auth.ts'); // fresh: stored hash == live hash
    raw(root, 'src-auth-ts-abc12345', {
      v: 1, ts: '2026-07-02T10:00:00.000Z', id: 'src-auth-ts-abc12345', type: 'file', op: 'put',
      title: 'src/auth.ts', character: 'single',
      summary: 'Owns token minting. Part of [[login-flow]].',
      anchors: [{ path: 'src/auth.ts', hash: good }],
    });
    raw(root, 'login-flow', {
      v: 1, ts: '2026-07-02T11:00:00.000Z', id: 'login-flow', type: 'flow', op: 'put',
      title: 'login flow', summary: 'User authenticates via [[src-auth-ts-abc12345]].',
      steps: [{ path: 'src/auth.ts', symbols: ['mint'], role: 'mints token' }],
      anchors: [{ path: 'src/auth.ts', hash: good }],
    });

    const data = buildViewData(root, DATE);
    expect(data.summary.total).toBe(2);
    expect(data.summary.byType).toEqual({ file: 1, flow: 1 });
    expect(data.summary.byFreshness).toEqual({ fresh: 2 });
    expect(data.summary.generated).toBe(DATE);

    const byId = Object.fromEntries(data.notes.map((n) => [n.id, n]));
    const file = byId['src-auth-ts-abc12345'];
    expect(file.type).toBe('file');
    expect(file.character).toBe('single');
    expect(file.dir).toBe('src');
    expect(file.anchors[0].state).toBe('fresh');
    expect(file.freshness).toBe('fresh');
    // body is the rendered markdown, with frontmatter + leading `# title` removed
    expect(file.body).not.toMatch(/^---/);
    expect(file.body).not.toMatch(/^#\s/);
    expect(file.body).toContain('[[login-flow]]');
    // wikilinks become outLinks; the referenced note gains a backlink
    expect(file.outLinks).toContain('login-flow');
    expect(byId['login-flow'].backlinks).toContain('src-auth-ts-abc12345');
  });

  it('reports changed and missing anchors and rolls up to the worst state', () => {
    raw(root, 'stale-note', {
      v: 1, ts: '2026-07-02T10:00:00.000Z', id: 'stale-note', type: 'file', op: 'put',
      title: 'src/auth.ts', character: 'single', summary: 'x',
      anchors: [
        { path: 'src/auth.ts', hash: 'sha256:000000000000' }, // wrong hash → changed
        { path: 'src/gone.ts', hash: 'sha256:111111111111' },  // absent file → missing
      ],
    });
    const data = buildViewData(root, DATE);
    const n = data.notes[0];
    const states = n.anchors.map((a) => a.state).sort();
    expect(states).toEqual(['changed', 'missing']);
    expect(n.freshness).toBe('missing'); // worst-of rollup (missing > changed)
  });

  it('excludes retracted notes', () => {
    raw(root, 'dead-note', {
      v: 1, ts: '2026-07-02T10:00:00.000Z', id: 'dead-note', type: 'file', op: 'retract',
      target: { kind: 'note' },
    });
    expect(buildViewData(root, DATE).notes).toHaveLength(0);
  });
});

describe('kb view — renderViewHtml', () => {
  it('injects data and neutralizes </script> so note text cannot break out', () => {
    const html = renderViewHtml(VIEW_TEMPLATE, { summary: { total: 1 }, notes: [{ body: 'evil </script> text' }] });
    expect(html).not.toContain('__DATA_JSON__');
    expect(html).not.toContain('evil </script>');   // raw closer would break the tag
    expect(html).toContain('evil <\\/script>');       // neutralized form survives
  });
});

describe('kb view — kbView side effects', () => {
  it('writes index.html into the notebook and self-registers it in .gitignore', () => {
    raw(root, 'src-auth-ts-abc12345', {
      v: 1, ts: '2026-07-02T10:00:00.000Z', id: 'src-auth-ts-abc12345', type: 'file', op: 'put',
      title: 'src/auth.ts', character: 'single', summary: 'x',
      anchors: [{ path: 'src/auth.ts', hash: hashFile(root, 'src/auth.ts') }],
    });
    const out = kbView(root, VIEW_TEMPLATE, { open: false, generated: DATE });
    expect(out).toBe(path.join(notebookDir(root), 'index.html'));
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out, 'utf8')).toContain('"total":1');
    expect(fs.readFileSync(path.join(notebookDir(root), '.gitignore'), 'utf8')).toContain('index.html');
  });
});
