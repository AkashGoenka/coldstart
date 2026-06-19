/**
 * canonical-find-key.mjs — the ONE canonical key for a `coldstart find` term-set.
 *
 * SHARED, byte-identical contract between the PreToolUse guard (find-preguard)
 * and the PostToolUse nudge (find-nudge): the guard DENIES a re-run of a key the
 * nudge REGISTERED. If the two computed different keys, the guard would block the
 * wrong calls (or none). Keep this the single source of truth — never inline a
 * second copy.
 *
 * `coldstart find` is a PURE function of its term-SET: reordering terms, changing
 * case, or repeating a term yields byte-identical output (every ranking stage is
 * set/sum based, sort is deterministic). So the key normalizes term order, case,
 * and dups, and folds in the significant flags (scope changes the result).
 *
 * Ported 1:1 from the Python `canonical_find_key` (find-nudge.py / find-preguard.py).
 */

const FIND_RE = /coldstart\s+find\b|index\.js\s+find\b/;
const TERM_SPLIT_RE = /[\s[\]|,()'".]+/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const FLAGS_WITH_VALUE = new Set(["--path", "--max", "-p", "-m"]);

/**
 * Stable key for a `coldstart find` term-set (+ significant flags), or null if
 * `cmd` is not a coldstart-find command (or carries no usable terms).
 * @param {string} cmd
 * @returns {string|null}
 */
export function canonicalFindKey(cmd) {
  const m = FIND_RE.exec(cmd);
  if (!m) return null;
  // everything after the `find` keyword (strip a trailing pipe/redirect)
  let tail = cmd.slice(m.index + m[0].length);
  tail = tail.split(/[|;&><]/)[0];
  const toks = tail.trim() ? tail.trim().split(/\s+/) : [];

  const terms = [];
  const flags = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t.startsWith("-")) {
      // --json / --tests are valueless; --path / --max take the next token
      flags.push(t);
      if (FLAGS_WITH_VALUE.has(t) && i + 1 < toks.length) {
        flags.push(toks[i + 1]);
        i += 1;
      }
    } else {
      // parseTerms: identifiers >= 3 chars, lowercased, deduped
      for (const w of t.split(TERM_SPLIT_RE)) {
        if (w.length >= 3 && IDENT_RE.test(w)) terms.push(w.toLowerCase());
      }
    }
    i += 1;
  }

  const seen = new Set();
  const dedup = [];
  for (const w of terms) {
    if (!seen.has(w)) {
      seen.add(w);
      dedup.push(w);
    }
  }
  if (dedup.length === 0) return null;
  return "T:" + dedup.slice().sort().join(",") + "|F:" + flags.slice().sort().join(",");
}
