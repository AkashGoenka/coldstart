import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { collectConstantReferences } from '../src/indexer/extractors/ruby.js';

const require = createRequire(import.meta.url);

// Guards the node-identity fix that made the wasm ruby extractor correct. The
// extractor detects class/module definition names with `sameNode(...)` (compares
// stable node `.id`), NOT object identity (`===`). web-tree-sitter mints a fresh
// node wrapper per accessor call, so a `===` check is ALWAYS false there — the
// `module Admin` / `class BaseController` definition names would leak in as
// constant *references*, producing spurious autoload edges. This parses on the
// real vendored ruby .wasm and asserts those names do NOT leak.

const RUBY_WASM = fileURLToPath(new URL('../vendor/wasm/tree-sitter-ruby.wasm', import.meta.url));

const SNIPPET = `
module Admin
  class BaseController < ApplicationController
    def show
      Account.find(params[:id])
      FOO = 1
    end
  end
end
`;

describe('wasm ruby extraction correctness (constant references)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let root: any;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Parser, Language } = require('web-tree-sitter') as any;
    await Parser.init();
    const lang = await Language.load(RUBY_WASM);
    const parser = new Parser();
    parser.setLanguage(lang);
    root = parser.parse(SNIPPET).rootNode;
  });

  it('does not leak module/class definition names as constant references', () => {
    const refs = collectConstantReferences(root);
    // Each reference is a nesting-qualified candidate group; its base name is
    // the last element. The real references must be present...
    const baseNames = refs.map((g) => g[g.length - 1]);
    expect(baseNames).toContain('ApplicationController'); // superclass ref
    expect(baseNames).toContain('Account'); // body constant ref
    // ...but the module/class DEFINITION names (`Admin`, `BaseController`) must
    // NOT appear as references — that leak was exactly what the old
    // object-identity check produced under wasm.
    expect(baseNames).not.toContain('Admin');
    expect(baseNames).not.toContain('BaseController');
  });
});
