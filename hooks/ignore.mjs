/**
 * ignore.mjs — .coldstartignore: which files never get notes.
 *
 * Enforced AT THE ROOT (the evidence/worklist layer): ignored files never
 * enter evidence records, so they never reach a worklist, never arm the
 * trigger, and the agent is told "unlisted files are out of scope". No
 * kb-write validation layer — attack the roots and the other steps aren't
 * needed. `kb lint` may REPORT ignored-anchor notes later (observability),
 * but nothing here blocks a write.
 *
 * Syntax: gitignore subset — one pattern per line, `#` comments, blank lines
 * skipped, `!` negation (later lines win), `dir/` matches the whole subtree,
 * `*` never crosses `/`, `**` does, a pattern without `/` matches at any
 * depth. Shipped DEFAULTS cover only the uncontroversial data-shaped set;
 * logic-bearing configs (vite.config.ts, workflow YAML, tsconfig via `!`)
 * are deliberately NOT defaulted — users add/negate in .coldstartignore.
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";

export const DEFAULT_IGNORES = [
  // pure data / machine-managed
  "*.json",
  "yarn.lock", "pnpm-lock.yaml", "Gemfile.lock", "Cargo.lock",
  "poetry.lock", "composer.lock", "go.sum", "*.lock",
  // generated / build output
  "dist/", "build/", "out/", "coverage/", "node_modules/", "vendor/",
  ".next/", "__snapshots__/",
  "*.min.js", "*.min.css", "*.map", "*.snap",
  // secrets — and notes must never quote env VALUES either (checklist rule)
  ".env", ".env.*",
  // binary / media
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico", "*.webp",
  "*.woff", "*.woff2", "*.ttf", "*.eot", "*.otf",
  "*.pdf", "*.zip", "*.gz", "*.tar", "*.wasm", "*.mo", "*.po",
  "*.pyc", "*.class", "*.jar", "*.o", "*.dylib", "*.so", "*.dll",
];

// gitignore-style pattern → RegExp over repo-relative paths (no leading /).
function patternToRegex(pattern) {
  let p = pattern;
  let dirOnly = false;
  if (p.endsWith("/")) { dirOnly = true; p = p.slice(0, -1); }
  const anchored = p.includes("/") && !p.startsWith("**/");
  p = p.replace(/^\//, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") { re += "(?:[^/]+(?:/[^/]+)*)?"; i++; if (p[i + 1] === "/") { re += "/?"; i++; } }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (".+^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  const body = anchored ? re : `(?:.*/)?${re}`;
  return new RegExp(`^${body}${dirOnly ? "(?:/.*)?" : ""}$`);
}

export function compileIgnore(lines) {
  const rules = [];
  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const pattern = negated ? line.slice(1) : line;
    try { rules.push({ negated, re: patternToRegex(pattern) }); } catch { /* bad pattern: skip */ }
  }
  return (rel) => {
    let ignored = false;
    for (const r of rules) if (r.re.test(rel)) ignored = !r.negated; // last match wins
    return ignored;
  };
}

/** Load .coldstart/.coldstartignore layered over the shipped defaults.
 *  The file is personal (gitignored by init's scaffold) — defaults ship in
 *  code, so every collaborator gets the same baseline without the file. */
export function loadIgnore(root) {
  let userLines = [];
  try { userLines = readFileSync(join(root, ".coldstart", ".coldstartignore"), "utf8").split("\n"); } catch { /* none: defaults only */ }
  return compileIgnore([...DEFAULT_IGNORES, ...userLines]);
}
