import type { Language } from "./types.js";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Extension → Language mapping
// ---------------------------------------------------------------------------
export const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "cpp",
  ".h": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".rb": "ruby",
  ".php": "php",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".gradle": "groovy",
  ".groovy": "groovy",
};

// ---------------------------------------------------------------------------
// Default excludes for filesystem walker
// ---------------------------------------------------------------------------
export const DEFAULT_EXCLUDES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".mypy_cache",
  ".ruff_cache",
  ".pytest_cache",
  "target", // Rust/Maven
  ".gradle",
  "vendor", // PHP/Go
  "venv", // Python virtual environments
  "Pods", // iOS CocoaPods
  ".dart_tool",
  ".pub-cache",
  "coverage",
  ".nyc_output",
  "tmp",
  "temp",
  ".cache",
  "logs",
  "obj", // .NET intermediate build output
  "CMakeFiles", // CMake generated
  "bower_components", // legacy JS
  "generated",
  "__generated__",
]);

// Derived at startup by hashing all files in the sibling indexer/ directory.
// Changes whenever indexer source (src/ tsx path) or compiled output (dist/ node path) changes.
// No manual bumps needed.
export const CACHE_VERSION: string = (() => {
  function hashDir(dir: string, hash: ReturnType<typeof createHash>, ext: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const fullPath = join(dir, name);
      if (statSync(fullPath).isDirectory()) {
        hashDir(fullPath, hash, ext);
      } else if (extname(name) === ext) {
        hash.update(name);
        hash.update(readFileSync(fullPath));
      }
    }
  }

  try {
    const thisFile = fileURLToPath(import.meta.url);
    const ext = thisFile.endsWith(".ts") ? ".ts" : ".js";
    const indexerDir = join(resolve(thisFile, ".."), "indexer");
    const hash = createHash("sha256");
    hashDir(indexerDir, hash, ext);
    return hash.digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
})();

// IDF threshold for "rare" token: log(20) ≈ 3.0 — tokens appearing in < 5% of files
export const IDF_RARITY_THRESHOLD = Math.log(20);

// Incremental patch threshold: if <= this many files changed, patch in place.
// Above this, trigger a full rebuild (covers large AI agent write bursts, refactors, branch merges).
export const PATCH_THRESHOLD = 30;

// Cache TTL: 24h safety net. Primary freshness signal is now the file watcher.
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
