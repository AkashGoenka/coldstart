/**
 * web-tree-sitter (WASM) parser factory, shared by the language extractors.
 * Every extractor calls `makeParser(spec)` once at module scope and gets back a
 * `getParser()` that returns the wasm-backed parser (built once, cached for the
 * process lifetime).
 *
 * coldstart runs EVERY grammar on web-tree-sitter — there is no native
 * node-tree-sitter path. `.wasm` grammars are inert data (no node-gyp, no
 * install scripts, no per-grammar peer-dep), so a plain `npm i` always works.
 * All grammars are vendored under `vendor/wasm/`.
 *
 * The wasm parser is wrapped so the extractors need ZERO body changes:
 *   - it accepts the same `.parse(string)` AND `.parse(chunkCallback)` shapes
 *     (the >32 KB chunked path is reconstructed into a full string, since
 *     web-tree-sitter has no 32 KB cap);
 *   - it deletes the previous Tree on each new parse() call, bounding live wasm
 *     memory to one tree per language (safe: extraction is fully synchronous per
 *     file, so a tree is always fully traversed before the next parse()).
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyParser = any;

/**
 * Where to find a grammar's prebuilt .wasm. Every grammar is vendored under
 * `vendor/wasm/` as `<basename>.wasm` (grammars that ship a .wasm in their npm
 * package are copied verbatim; c#/kotlin/xml are built from source — see
 * `scripts/wasm-build/`). Vendoring keeps coldstart free of the `tree-sitter`
 * core peerDependency that each grammar package carries.
 */
export interface WasmSpec {
  vendored: string; // basename under vendor/wasm/, e.g. 'tree-sitter-java.wasm'
}

/**
 * Absolute path to the repo's vendored-wasm dir. This module compiles to
 * dist/indexer/extractors/ and runs from src/indexer/extractors/ under vitest —
 * both are exactly three levels below the repo root, so the same relative walk
 * up to vendor/wasm/ resolves in both layouts.
 */
const VENDOR_WASM_DIR = fileURLToPath(new URL('../../../vendor/wasm/', import.meta.url));

interface Pending {
  spec: WasmSpec;
  setReady: (p: AnyParser) => void;
  loaded: boolean;
}
const pendingWasm: Pending[] = [];

/** Resolve the absolute path of a spec's vendored .wasm, or null if absent. */
function resolveWasm(spec: WasmSpec): string | null {
  const p = join(VENDOR_WASM_DIR, spec.vendored);
  return existsSync(p) ? p : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runtime: Promise<any> | null = null;
function getRuntime(): Promise<{ Parser: unknown; Language: unknown }> {
  if (!runtime) {
    runtime = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Parser, Language } = require('web-tree-sitter') as any;
      await Parser.init();
      return { Parser, Language };
    })();
  }
  return runtime;
}

// Serialise draining so concurrent callers never double-load a grammar.
let draining: Promise<void> = Promise.resolve();

/**
 * Must be awaited before any parsing — loads the web-tree-sitter runtime and
 * every grammar registered so far whose .wasm isn't loaded yet. Idempotent and
 * concurrency-safe: calls are serialised, each `Pending` is loaded exactly once
 * (guarded by `loaded`), and a call made after new grammars register picks them
 * up. Awaited inside `parseFile`, so every parse path is covered. There is no
 * native fallback — a missing vendored .wasm throws.
 */
export function ensureParsersReady(): Promise<void> {
  draining = draining.then(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Parser, Language } = (await getRuntime()) as any;
    for (const entry of pendingWasm) {
      if (entry.loaded) continue;
      const path = resolveWasm(entry.spec);
      if (!path) {
        throw new Error(
          `[coldstart] vendored wasm '${entry.spec.vendored}' not found under vendor/wasm/ — ` +
          `the package is corrupt or the grammar was not vendored`,
        );
      }
      const lang = await Language.load(path);
      const real = new Parser();
      real.setLanguage(lang);
      entry.setReady(wrapWasmParser(real));
      entry.loaded = true;
    }
  });
  return draining;
}

/**
 * Wrap a web-tree-sitter Parser so extractors can use it like a node one: same
 * parse() shapes, and automatic previous-tree cleanup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapWasmParser(real: any): AnyParser {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let live: any = null;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parse(input: string | ((startIndex: number) => string | null)): any {
      if (live) { try { live.delete(); } catch { /* already freed */ } live = null; }
      let src: string;
      if (typeof input === 'function') {
        // Reconstruct the full source from the native chunk-callback shape.
        let s = '';
        let i = 0;
        for (;;) {
          const chunk = input(i);
          if (chunk == null || chunk.length === 0) break;
          s += chunk;
          i += chunk.length;
        }
        src = s;
      } else {
        src = input;
      }
      live = real.parse(src);
      return live;
    },
  };
}

/**
 * Build a memoised getParser() backed by the spec's vendored .wasm. The parser
 * is populated by ensureParsersReady(); calling getParser() before that promise
 * resolves throws (parseFile awaits it, so this only fires on misuse).
 */
export function makeParser(spec: WasmSpec): () => AnyParser {
  let ready: AnyParser = null;
  pendingWasm.push({ spec, loaded: false, setReady: (p) => { ready = p; } });
  return () => {
    if (!ready) {
      throw new Error(
        `[coldstart] wasm parser for ${spec.vendored} not initialised — ` +
        `ensureParsersReady() must be awaited before parsing`,
      );
    }
    return ready;
  };
}
