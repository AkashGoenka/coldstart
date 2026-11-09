/**
 * Turn on V8's linear-time regex fallback for this whole process.
 *
 * A backtracking regex can take exponential time on a bad input, and while it
 * runs the event loop is dead: two such regexes have hung the keeper forever
 * on one ordinary file (#165, #181). With this flag V8 counts backtracks, and a
 * match that backtracks excessively is re-run on its breadth-first engine,
 * which is linear in the input: same answer, milliseconds instead of forever.
 * Regexes that engine cannot run (backreferences, lookarounds) keep the normal
 * engine; for those the parse time limit (src/indexer/parse-guard.ts) and the
 * build-time check (tests/regex-safety.test.ts) remain the safety net.
 *
 * ORDER IS THE WHOLE CONTRACT: the flag only applies to regexes created after
 * it is set, and module-level regex literals are created when their module
 * runs. So this must be the FIRST import of every process entry point
 * (src/index.ts and every wired hook script) — ES modules run in import order,
 * so everything imported after this one is covered. Verified on Node 22 + 25;
 * tests/regex-engine.test.ts pins both the effect and the import order.
 *
 * The flag is marked experimental in V8. If a Node release drops it, setting
 * it fails or does nothing, and we fall back to the time limit — never worse
 * than not having it.
 */
import { setFlagsFromString } from "node:v8";

try {
  setFlagsFromString("--enable-experimental-regexp-engine-on-excessive-backtracks");
} catch {
  /* unknown flag on some future Node: the parse time limit still applies */
}
