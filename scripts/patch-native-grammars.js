#!/usr/bin/env node
/**
 * Patches tree-sitter-dart and tree-sitter-swift after npm install.
 *
 * tree-sitter-dart@1.0.0: Ships a pre-built NAN-style native binding incompatible with
 * tree-sitter@0.21.x NAPI Language format. We rewrite binding.cc + binding.gyp to NAPI
 * and rebuild.
 *
 * tree-sitter-swift@0.6.0: Ships parser.c but binding.gyp has an `actions` block that
 * tries to regenerate it via tree-sitter-cli (not installed). We remove those actions
 * and rebuild from the pre-existing parser.c.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

function run(cmd, cwd) {
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
  } catch (err) {
    console.error(`[patch] Command failed: ${cmd}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Patch tree-sitter-dart
// ---------------------------------------------------------------------------

const DART_DIR = join(ROOT, 'node_modules', 'tree-sitter-dart');

if (existsSync(DART_DIR)) {
  console.log('[patch] Patching tree-sitter-dart binding to NAPI format...');

  const dartBindingCC = join(DART_DIR, 'bindings', 'node', 'binding.cc');
  const currentDartCC = readFileSync(dartBindingCC, 'utf-8');

  if (currentDartCC.includes('nan.h') || currentDartCC.includes('NAN_METHOD')) {
    writeFileSync(dartBindingCC, `#include <napi.h>

typedef struct TSLanguage TSLanguage;

extern "C" TSLanguage *tree_sitter_dart();

// "tree-sitter", "language" hashed with BLAKE2
const napi_type_tag LANGUAGE_TYPE_TAG = {
    0x8AF2E5212AD58ABF, 0xD5006CAD83ABBA16
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports["name"] = Napi::String::New(env, "dart");
    auto language = Napi::External<TSLanguage>::New(env, tree_sitter_dart());
    language.TypeTag(&LANGUAGE_TYPE_TAG);
    exports["language"] = language;
    return exports;
}

NODE_API_MODULE(tree_sitter_dart_binding, Init)
`);

    writeFileSync(join(DART_DIR, 'binding.gyp'), `{
  "targets": [
    {
      "target_name": "tree_sitter_dart_binding",
      "dependencies": [
        "<!(node -p \\"require('node-addon-api').targets\\"):node_addon_api_except",
      ],
      "include_dirs": [
        "src",
      ],
      "sources": [
        "src/parser.c",
        "bindings/node/binding.cc",
        "src/scanner.c"
      ],
      "cflags_c": [
        "-std=c99",
      ]
    }
  ]
}
`);

    console.log('[patch] Rebuilding tree-sitter-dart...');
    run('npx node-gyp rebuild', DART_DIR);
    console.log('[patch] tree-sitter-dart rebuilt successfully.');
  } else {
    console.log('[patch] tree-sitter-dart already patched, skipping.');
  }
} else {
  console.warn('[patch] tree-sitter-dart not found, skipping.');
}

// ---------------------------------------------------------------------------
// Patch tree-sitter-swift
// ---------------------------------------------------------------------------

const SWIFT_DIR = join(ROOT, 'node_modules', 'tree-sitter-swift');

if (existsSync(SWIFT_DIR)) {
  console.log('[patch] Patching tree-sitter-swift binding.gyp (remove generate actions)...');

  const swiftGYP = join(SWIFT_DIR, 'binding.gyp');
  const currentSwiftGYP = readFileSync(swiftGYP, 'utf-8');

  if (currentSwiftGYP.includes('wait_for_tree_sitter') || currentSwiftGYP.includes('tree-sitter-cli')) {
    writeFileSync(swiftGYP, `{
  "targets": [
    {
      "target_name": "tree_sitter_swift_binding",
      "dependencies": [
        "<!(node -p \\"require('node-addon-api').targets\\"):node_addon_api_except",
      ],
      "include_dirs": [
        "src",
      ],
      "sources": [
        "bindings/node/binding.cc",
        "src/parser.c",
        "src/scanner.c",
      ],
      "cflags_c": [
        "-std=c11",
      ]
    }
  ]
}
`);

    console.log('[patch] Rebuilding tree-sitter-swift...');
    run('npx node-gyp rebuild', SWIFT_DIR);
    console.log('[patch] tree-sitter-swift rebuilt successfully.');
  } else {
    console.log('[patch] tree-sitter-swift already patched, skipping.');
  }
} else {
  console.warn('[patch] tree-sitter-swift not found, skipping.');
}

console.log('[patch] Native grammar patching complete.');
