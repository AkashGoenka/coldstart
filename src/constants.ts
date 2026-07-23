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
  ".graphql": "graphql",
  ".gql": "graphql",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".gradle": "groovy",
  ".groovy": "groovy",
  ".erb": "erb",
  ".haml": "haml",
  ".slim": "slim",
  // Token-only indexing: filename + path tokens feed domainMap; no AST parsing.
  // Lets GO surface templates, stylesheets, config, and docs that name a concept
  // even though their bodies aren't indexed.
  ".htm": "html",
  ".html": "html",
  ".css": "css",
  ".scss": "css",
  ".sass": "css",
  ".less": "css",
  ".json": "json",
  ".md": "markdown",
  ".markdown": "markdown",
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
  "notebook", // coldstart knowledge-base/memory notes — surfaced via find's KB section, never indexed as code (would out-rank real source)
]);

/**
 * Mirror the walker's directory rules for a repo-relative path (forward
 * slashes): the walker never descends into hidden dirs (a segment starting
 * with `.`) or DEFAULT_EXCLUDES dirs, so anything under one is not indexed.
 * Only DIRECTORY segments count — hidden files at the root (.rubocop.yml) are
 * kept. Shared by the walker's downstream consumers (the live watcher and
 * patch) so a change to the rule can't drift between them.
 */
export function isUnderExcludedDir(relPath: string): boolean {
  const dirSegments = relPath.split('/').slice(0, -1);
  return dirSegments.some((s) => s.startsWith('.') || DEFAULT_EXCLUDES.has(s));
}

// Cache version — bump when index schema changes to force re-index
// 18.0.0: consumer-scoped gzipped segments + fileId table + fingerprints;
// TTL deleted (validity = version + git HEAD + the keeper's live watcher).
// 18.1.0: generation-prefixed segments (g<N>-*) + gen in meta.json. Bumped so
// no pre-generation cache survives — removes the mixed-format sweep window
// entirely (18.0.0 never shipped beyond dev machines).
export const CACHE_VERSION = "18.1.0";

// Incremental patch threshold: if <= this many files changed, patch in place.
// Above this, trigger a full rebuild. Relative to repo size — patching is
// ~2-5ms/file, so a flat cap punishes big repos: 30 files is 0.2% of jmri but
// a full rebuild there is 96s. Floor of 30 keeps tiny repos rebuilding early
// (patch overhead ≈ rebuild there anyway).
export const PATCH_THRESHOLD_FLOOR = 30;
export const PATCH_THRESHOLD_RATIO = 0.2;
export function patchThreshold(fileCount: number): number {
  return Math.max(PATCH_THRESHOLD_FLOOR, Math.ceil(fileCount * PATCH_THRESHOLD_RATIO));
}
