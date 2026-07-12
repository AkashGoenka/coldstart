#!/usr/bin/env node
// Load a vendored grammar .wasm in web-tree-sitter and parse a snippet, to prove
// the clang-built SIDE_MODULE is ABI-compatible with the runtime.
//   node scripts/wasm-build/verify-wasm.mjs <wasm> <ts_lang_export> <snippet-file|->
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const [wasmPath, snippetPath] = process.argv.slice(2);
if (!wasmPath) { console.error('usage: verify-wasm.mjs <wasm> [<snippet-file>]'); process.exit(1); }

const { Parser, Language } = require('web-tree-sitter');
await Parser.init();
const lang = await Language.load(wasmPath);
const parser = new Parser();
parser.setLanguage(lang);

const src = snippetPath && snippetPath !== '-'
  ? readFileSync(snippetPath, 'utf8')
  : 'class C { int f() { return 1; } }';
const tree = parser.parse(src);
const root = tree.rootNode;
console.log('root type      :', root.type);
console.log('child count    :', root.childCount);
console.log('has ERROR      :', root.hasError);
console.log('sexp (head)    :', root.toString().slice(0, 200));
if (root.childCount === 0) { console.error('FAIL: empty parse'); process.exit(1); }
console.log('OK: parsed', src.length, 'bytes');
