import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import NativeParser from 'tree-sitter';
import RubyGrammar from 'tree-sitter-ruby';
import { collectConstantReferences } from '../src/indexer/extractors/ruby.js';

const require = createRequire(import.meta.url);

// Guards the node-identity fix behind the WASM migration: the ruby extractor
// used `node === parent.namedChildren[0]` to detect class/module definition
// names. node-tree-sitter caches node wrappers so `===` holds; web-tree-sitter
// mints a fresh wrapper per accessor call, so `===` was always false there and
// the definition names leaked in as constant *references* — producing spurious
// autoload edges (measured as a systematic +59/+72 ruby edge delta on a
// mastodon checkout). The fix compares stable node `.id`s instead. This test
// parses the same source on BOTH engines and asserts identical extraction.

// A snippet whose nested `module Admin` / `class BaseController` definition
// names would be mis-extracted as references under the old object-identity check.
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

describe('native-vs-WASM extraction parity (ruby constant references)', () => {
  it('collectConstantReferences is identical on native and WASM trees', async () => {
    // Native tree.
    const np = new NativeParser();
    np.setLanguage(RubyGrammar as never);
    const nativeRefs = collectConstantReferences(np.parse(SNIPPET).rootNode);

    // WASM tree (web-tree-sitter + the in-package ruby .wasm).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Parser, Language } = require('web-tree-sitter') as any;
    await Parser.init();
    const lang = await Language.load(require.resolve('tree-sitter-ruby/tree-sitter-ruby.wasm'));
    const wp = new Parser();
    wp.setLanguage(lang);
    const wasmRefs = collectConstantReferences(wp.parse(SNIPPET).rootNode);

    expect(wasmRefs).toEqual(nativeRefs);
    // Sanity: the module/class definition names must NOT leak in as references
    // (these exact spurious groups were what the old identity check produced).
    expect(nativeRefs).not.toContainEqual(['Admin']);
    expect(nativeRefs).not.toContainEqual(['Admin::BaseController', 'BaseController']);
  });
});
