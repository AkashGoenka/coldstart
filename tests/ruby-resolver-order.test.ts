import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRailsFqcnIndex } from '../src/indexer/resolvers/ruby.js';

// Shared, hoisted so the vi.mock factory (hoisted above imports) can read it.
const ctl = vi.hoisted(() => ({ order: 'asc' as 'asc' | 'desc' }));

// Wrap the real readdir so we can force every directory enumeration into a
// chosen order and prove the FQCN winner does not depend on it.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: async (p: unknown, opts: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries: any[] = await (actual.readdir as any)(p, opts);
      entries.sort((a, b) => {
        const an = typeof a === 'string' ? a : a.name;
        const bn = typeof b === 'string' ? b : b.name;
        return ctl.order === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
      });
      return entries;
    },
  };
});

// Regression for the WASM-migration order-sensitivity bug: buildRailsFqcnIndex
// used to pick the winner for an ambiguous autoload constant from walkRbFiles'
// filesystem-readdir order, so native and WASM runs (which enumerate/parse in
// different deterministic orders) could resolve the same duplicate FQCN to
// different files. The fix sorts the file list by path, making the tie-break
// deterministic and identical regardless of enumeration order.
describe('buildRailsFqcnIndex — order-independent FQCN resolution', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'coldstart-rbindex-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  async function build(order: 'asc' | 'desc'): Promise<Map<string, string>> {
    ctl.order = order;
    const fileIdSet = new Set([
      'app/models/visibility.rb',
      'app/models/concerns/visibility.rb',
    ]);
    return buildRailsFqcnIndex(root, fileIdSet, root);
  }

  it('resolves an ambiguous constant identically under opposite enumeration orders', async () => {
    // Two files collide on the `visibility` autoload key inside the app/models
    // root: a top-level model and one under concerns/ (whose `concerns/` segment
    // is stripped to the same key). Without a stable sort the winner flips with
    // enumeration order.
    mkdirSync(join(root, 'app', 'models', 'concerns'), { recursive: true });
    writeFileSync(join(root, 'app', 'models', 'visibility.rb'), 'class Visibility; end\n');
    writeFileSync(join(root, 'app', 'models', 'concerns', 'visibility.rb'), 'module Visibility; end\n');

    const asc = await build('asc');
    const desc = await build('desc');

    // Same winner regardless of enumeration order → order-independent.
    expect(asc.get('visibility')).toBe(desc.get('visibility'));
    // And specifically the path-sorted-first file (concerns/ < visibility.rb).
    expect(asc.get('visibility')).toBe('app/models/concerns/visibility.rb');
  });
});
