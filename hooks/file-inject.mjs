/**
 * Prompt-time file injection (embedder build step 4): a few file POINTERS for the user's prompt, so the agent starts
 * oriented. user prompt → reducer (hooks/prompt-terms.mjs: identifiers + nouns) → `coldstart find --json` on those
 * terms, re-ranked inside find against the FULL prompt (src/embedder/rerank.ts, w = 1.5) → top 3 code/doc files.
 *
 * Silent when: the embedder isn't opted in (COLDSTART_EMBEDDER=1 / `init --embedder` — the one switch until the
 * step-5 eval decides the default), the reducer keeps < 2 terms ("go ahead", "yes"), the prompt is a slash command
 * (its expansion is hook text, never a user prompt — separation rule), find finds nothing, or anything fails.
 * Measured on v-prompt1 DEV (59 real prompts): the skip silences 14/37 "no file needed" prompts and loses 0 of the
 * 22 that need one; nothing cheaper (top cosine, coverage, first-prompt) separated the rest, so every other prompt
 * gets pointers and step 5 measures that cost. Right file in the top 3: 13/22 fused vs 11/22 lexical.
 *
 * A library, not a wired entry point: kb-recall.mjs (which imports regex-engine first) calls it.
 */
import { execFile } from "node:child_process";
import { reducePrompt } from "./prompt-terms.mjs";
import { embedderDisabled } from "./embed-client.mjs";

export const INJECT_TOP = 3;
// ids first, then nouns (reducePrompt's order). A 20k-char paste reduced to 566 terms = 2.9 s of find on a 481-file
// repo, near the timeout (B3, verifier); dev prompts reduce to a median of ~6, the pilot's to ~16.
export const MAX_TERMS = 40;
const MAX_BLOCK = 1500; // the files block rides after the 8.5 KB notes cap; keep the whole payload under the host's 10 KB
const FIND_TIMEOUT_MS = 4000;
// find's --json rows include tests; the page doesn't, and neither do pointers (gold is source unless asked)
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z0-9]+$|_test\.[a-z0-9]+$|(^|\/)test_[^/]+$/i;

/** Skip reason (null = go) + the reduced terms. Pure, cheap — no process spawned; the reducer runs once. */
function plan(prompt) {
  if (embedderDisabled()) return { why: "embedder-off" };
  const p = String(prompt ?? "").trim();
  if (!p) return { why: "empty" };
  if (/^\/[\w:-]+(\s|$)/.test(p)) return { why: "slash-command" }; // "/Users/x/foo.ts is broken" is a prompt, not a command
  const r = reducePrompt(p);
  if (r.skip) return { why: "few-terms" };
  return { why: null, terms: r.terms.slice(0, MAX_TERMS) };
}
/** Why injection would stay silent for this prompt (null = go). */
export const injectSkipReason = (prompt) => plan(prompt).why;

function runFind(cli, root, terms, prompt) {
  return new Promise((done) => {
    const child = execFile("node", [cli, "find", ...terms, "--json", "--embed-stdin", "--rerank-budget-ms", "800"],
      { cwd: root, encoding: "utf8", timeout: FIND_TIMEOUT_MS, maxBuffer: 16 << 20, windowsHide: true },
      (err, stdout) => { if (err) return done({ err: String(err).split("\n")[0] }); try { done({ j: JSON.parse(stdout) }); } catch { done({ err: "bad json" }); } });
    child.stdin?.on("error", () => {});
    child.stdin?.end(prompt);
  });
}

const tick = (s) => `\`${s}\``;

/**
 * @returns {Promise<{ status: "skip"|"none"|"ok"|"error", reason?: string, files?: string[], block?: string, rerank?: any, ms: number, terms?: number }>}
 */
export async function fileInjection({ cli, root, prompt, log }) {
  const t0 = Date.now();
  const { why, terms } = plan(prompt);
  if (why) return { status: "skip", reason: why, ms: Date.now() - t0 };
  const r = await runFind(cli, root, terms, prompt);
  if (r.err) { log?.(`file-inject: find failed: ${r.err}`); return { status: "error", reason: r.err, ms: Date.now() - t0, terms: terms.length }; }
  const rows = (r.j.ranked ?? []).filter((x) => !x.vendor && !TEST_PATH.test(x.path)).slice(0, INJECT_TOP);
  if (rows.length === 0) return { status: "none", reason: "no-match", ms: Date.now() - t0, terms: terms.length };
  const lines = rows.map((x) => {
    const why = [x.defines?.length ? `defines ${x.defines.slice(0, 4).map(tick).join(", ")}` : "",
                 x.inPath?.length ? `named for ${x.inPath.slice(0, 3).map(tick).join(", ")}` : ""].filter(Boolean).join("; ");
    return `- ${String(x.path).slice(0, 200)}${why ? ` — ${why.slice(0, 200)}` : ""}`;
  });
  let block =
    `Files that may be relevant to this request (coldstart \`find\` on the prompt's key terms, ranked by meaning — ` +
    `a starting point, not an answer; ignore them if the request isn't about code):\n` + lines.join("\n") +
    `\n\`coldstart gs <file>\` shows a file's shape and who uses it.`;
  if (block.length > MAX_BLOCK) block = block.slice(0, MAX_BLOCK) + "…";
  return { status: "ok", files: rows.map((x) => x.path), block, rerank: r.j.rerank ?? null, ms: Date.now() - t0, terms: terms.length };
}
