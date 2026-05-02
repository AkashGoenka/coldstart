import type { Language } from "./types.js";

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
  "Pods", // iOS CocoaPods
  ".dart_tool",
  ".pub-cache",
  "coverage",
  ".nyc_output",
  "tmp",
  "temp",
  ".cache",
  "logs",
  "generated",
  "__generated__",
]);

// Cache version — bump when index schema changes to force re-index
export const CACHE_VERSION = "11.0.0";

// IDF threshold for "rare" token: log(20) ≈ 3.0 — tokens appearing in < 5% of files
export const IDF_RARITY_THRESHOLD = Math.log(20);

// Incremental patch threshold: if <= this many files changed, patch in place.
// Above this, trigger a full rebuild (covers large AI agent write bursts, refactors, branch merges).
export const PATCH_THRESHOLD = 30;

// Cache TTL: 24h safety net. Primary freshness signal is now the file watcher.
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
