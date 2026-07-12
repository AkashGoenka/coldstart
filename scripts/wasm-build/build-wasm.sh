#!/usr/bin/env bash
# Build a tree-sitter grammar to an emscripten-compatible SIDE_MODULE .wasm
# using plain LLVM (clang + wasm-ld), NO emscripten / wasi-sdk required.
#
# Why not `tree-sitter build --wasm`? That auto-downloads the tree-sitter CLI
# binary and a wasi-sdk from GitHub releases, both of which are unreachable in
# the build environment (egress proxy only allows the project repo). This
# script reproduces the same ABI the shipped grammar .wasm use:
#   - PIC "shared" wasm side module (imported memory, __memory_base /
#     __table_base globals, imported __indirect_function_table),
#   - libc functions (malloc/memcpy/iswspace/...) left as undefined `env`
#     imports, resolved by web-tree-sitter's core module at Language.load(),
#   - a single exported `tree_sitter_<lang>` entrypoint.
# Verified byte-for-byte import/export-shape identical to the npm-shipped
# grammar .wasm (see scripts/wasm-build/verify-wasm.mjs).
#
# Usage: build-wasm.sh <export_symbol> <out.wasm> <src_include_dir> <c_file...>
set -euo pipefail

EXPORT="$1"; OUT="$2"; INCDIR="$3"; shift 3
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHIM="$HERE/shim-sysroot/include"

clang \
  --target=wasm32 \
  -fPIC \
  -fvisibility=default \
  -nostdlib \
  -O2 \
  -DNDEBUG \
  -isystem "$SHIM" \
  -I "$INCDIR" \
  -Wl,--experimental-pic \
  -Wl,-shared \
  -Wl,--export="$EXPORT" \
  -Wl,--export=__wasm_call_ctors \
  -Wl,--export=__wasm_apply_data_relocs \
  -Wl,--allow-undefined \
  -Wl,--no-entry \
  -o "$OUT" \
  "$@"

echo "built $OUT ($(wc -c < "$OUT") bytes)"
