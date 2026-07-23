import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { startWatcher } from '../src/watcher.js';

// fs.watch({recursive}) event delivery is async; poll instead of fixed sleeps.
async function waitFor(cond: () => boolean, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}

describe('watcher notebook route', () => {
  let root: string;
  let stop: (() => void) | null = null;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-watch-'));
    fs.mkdirSync(path.join(root, '.coldstart/notebook/.raw'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  });
  afterEach(() => {
    stop?.();
    stop = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('routes notebook .raw/*.jsonl to onNotebookRaw and code files to onBatch — never crossed', async () => {
    const codeBatches: string[] = [];
    const notebookBatches: string[] = [];
    stop = startWatcher(
      root,
      (batch) => codeBatches.push(...batch),
      (batch) => notebookBatches.push(...batch),
    );
    // let the watcher settle before generating events
    await new Promise((r) => setTimeout(r, 100));

    fs.writeFileSync(path.join(root, '.coldstart/notebook/.raw/my-note.jsonl'), '{"v":1}\n');
    fs.writeFileSync(path.join(root, 'src/code.ts'), 'export const x = 1;\n');

    expect(await waitFor(() => notebookBatches.length > 0 && codeBatches.length > 0)).toBe(true);
    expect(notebookBatches.some((p) => p.endsWith('my-note.jsonl'))).toBe(true);
    expect(codeBatches.some((p) => p.endsWith('code.ts'))).toBe(true);
    // the .jsonl must NOT leak into the index batch (the old line-24 filter dropped
    // it entirely; the new route must not overcorrect into patching the index with it)
    expect(codeBatches.some((p) => p.endsWith('.jsonl'))).toBe(false);
    expect(notebookBatches.some((p) => p.endsWith('.ts'))).toBe(false);
  });

  it('the keeper\'s own writes into .coldstart/ (index.html, derived .md) never feed the code batch', async () => {
    // Regression: the keeper regenerates `.coldstart/notebook/index.html` (and
    // re-renders derived `.md`) on every notes refresh. The watcher used to
    // catch those self-writes (.html/.md ARE indexed extensions) and feed them
    // back as "repo changed" → cache save → notes refresh → regen → an endless
    // loop that reloaded the notebook view every ~5s. Excluded/hidden dirs must
    // never enter the code batch.
    const codeBatches: string[] = [];
    const notebookBatches: string[] = [];
    stop = startWatcher(root, (b) => codeBatches.push(...b), (b) => notebookBatches.push(...b));
    await new Promise((r) => setTimeout(r, 100));

    fs.writeFileSync(path.join(root, '.coldstart/notebook/index.html'), '<html></html>\n');
    fs.writeFileSync(path.join(root, '.coldstart/notebook/some-note.md'), '# note\n');
    // a real code change still gets through — so we can assert the batch fired
    fs.writeFileSync(path.join(root, 'src/code.ts'), 'export const z = 3;\n');

    expect(await waitFor(() => codeBatches.some((p) => p.endsWith('code.ts')))).toBe(true);
    expect(codeBatches.some((p) => p.includes('.coldstart'))).toBe(false);
    expect(codeBatches.some((p) => p.endsWith('index.html'))).toBe(false);
    expect(codeBatches.some((p) => p.endsWith('.md'))).toBe(false);
  });

  it('a stray .jsonl OUTSIDE the notebook is still ignored', async () => {
    const codeBatches: string[] = [];
    const notebookBatches: string[] = [];
    stop = startWatcher(root, (b) => codeBatches.push(...b), (b) => notebookBatches.push(...b));
    await new Promise((r) => setTimeout(r, 100));

    fs.writeFileSync(path.join(root, 'src/data.jsonl'), '{}\n');
    fs.writeFileSync(path.join(root, 'src/code.ts'), 'export const y = 2;\n');

    expect(await waitFor(() => codeBatches.length > 0)).toBe(true);
    expect(notebookBatches).toHaveLength(0);
    expect(codeBatches.some((p) => p.endsWith('.jsonl'))).toBe(false);
  });
});
