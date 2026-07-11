/**
 * Lazily-constructed, memoised tree-sitter parser, shared by the language
 * extractors. Every extractor calls `makeParser(grammar)` once at module scope
 * and gets back a `getParser()` that builds the parser on first use and caches
 * it for the process lifetime.
 *
 * Dual-mode (spike/experimental): when `COLDSTART_WASM=1`, extractors that pass
 * a `wasm` spec run on web-tree-sitter (WASM) instead of the native
 * node-tree-sitter binding. The wasm parser is wrapped so the extractors need
 * ZERO body changes:
 *   - it accepts the same `.parse(string)` AND `.parse(chunkCallback)` shapes
 *     (the >32 KB chunked path is reconstructed into a full string, since
 *     web-tree-sitter has no 32 KB cap);
 *   - it deletes the previous Tree on each new parse() call, bounding live wasm
 *     memory to one tree per language (safe: extraction is fully synchronous per
 *     file, so a tree is always fully traversed before the next parse()).
 * web-tree-sitter is imported lazily inside initWasm() — native/production never
 * loads it. Grammars without a shipped .wasm (c#, kotlin, xml) simply pass no
 * spec and stay native even under COLDSTART_WASM (hybrid).
 */
import ParserModule from 'tree-sitter';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = ParserModule as { new(): any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyParser = any;

const WASM_MODE = process.env['COLDSTART_WASM'] === '1';

/**
 * Where to find a grammar's prebuilt .wasm. Most grammars ship one inside their
 * own npm package (resolved via `pkg`/`wasm` with require.resolve). A few
 * grammars (c#, kotlin, xml) don't ship a .wasm, so coldstart vendors a built
 * one under `vendor/wasm/`; those pass `vendored` (a basename resolved against
 * the repo's vendor dir) instead of `pkg`.
 */
export interface WasmSpec {
  pkg?: string;   // npm package that ships the .wasm, e.g. 'tree-sitter-java'
  wasm?: string;  // the .wasm file inside that package, e.g. 'tree-sitter-java.wasm'
  vendored?: string; // basename under vendor/wasm/, e.g. 'tree-sitter-c-sharp.wasm'
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
}
const pendingWasm: Pending[] = [];

/** Resolve the absolute path of a spec's .wasm, or null if it doesn't ship one. */
function resolveWasm(spec: WasmSpec): string | null {
  // Vendored grammars (c#/kotlin/xml) live in the repo, not an npm package.
  if (spec.vendored) {
    const p = join(VENDOR_WASM_DIR, spec.vendored);
    return existsSync(p) ? p : null;
  }
  try {
    const p = require.resolve(`${spec.pkg}/${spec.wasm}`);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

let initPromise: Promise<void> | null = null;

/**
 * Must be awaited before any parsing when COLDSTART_WASM=1 — loads the
 * web-tree-sitter runtime and every registered grammar's .wasm. Idempotent and
 * concurrency-safe (single memoised promise). No-op in native mode.
 */
export function ensureParsersReady(): Promise<void> {
  if (!WASM_MODE) return Promise.resolve();
  if (!initPromise) initPromise = initWasm();
  return initPromise;
}

async function initWasm(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Parser, Language } = require('web-tree-sitter') as any;
  await Parser.init();
  for (const entry of pendingWasm) {
    const path = resolveWasm(entry.spec);
    if (!path) continue; // no wasm shipped → its getParser stays native (set at makeParser time)
    const lang = await Language.load(path);
    const real = new Parser();
    real.setLanguage(lang);
    entry.setReady(wrapWasmParser(real));
  }
}

/**
 * Wrap a web-tree-sitter Parser so extractors can use it exactly like the native
 * one: same parse() shapes, and automatic previous-tree cleanup.
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
 * Build a memoised getParser(). In native mode (or when no wasm ships), returns
 * the native node-tree-sitter parser. In wasm mode with a resolvable .wasm,
 * returns the wasm-backed wrapper (populated by ensureParsersReady()).
 */
export function makeParser(grammar: unknown, wasm?: WasmSpec): () => AnyParser {
  if (WASM_MODE && wasm && resolveWasm(wasm)) {
    let ready: AnyParser = null;
    pendingWasm.push({ spec: wasm, setReady: (p) => { ready = p; } });
    return () => {
      if (!ready) {
        throw new Error(
          `[coldstart] wasm parser for ${wasm.pkg ?? wasm.vendored} not initialised — ` +
          `ensureParsersReady() must be awaited before parsing`,
        );
      }
      return ready;
    };
  }
  // Native (unchanged behaviour).
  let parser: AnyParser = null;
  return () => {
    if (!parser) {
      parser = new ParserCtor();
      parser.setLanguage(grammar);
    }
    return parser;
  };
}
