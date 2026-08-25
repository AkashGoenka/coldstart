/**
 * cochange-nudge.mjs — "you edited A and B; history says C moves with them."
 *
 * A PostToolUse detector that fires on the EDIT EVENT — an edit TOOL or a shell
 * command that writes a file — not on a pause. Rationale:
 * a Stop fires whenever the agent finishes answering ANYTHING, so a settle-timed
 * version would surface suggestions from earlier work during an unrelated later
 * question. Firing on the edit also means the agent is still working and can act
 * without being pulled back for an extra turn.
 *
 * THREE RULES (measured on django/arches/kafka/mastodon, strict time split):
 *   1. The edit list is cleared on every new user message (resetEditTrack, called
 *      from the UserPromptSubmit recall hooks). A new prompt = a new task — NOT a
 *      new session, which survives a resume days later. This is the ONLY clearing
 *      signal: elapsed time is the wrong shape for a task boundary (a long
 *      auto-mode run edits for hours with no prompt, and a resume after a break
 *      lands on a prompt anyway), so there is deliberately no TTL.
 *   2. Nothing fires until a 2nd DISTINCT file is edited. Not correctness — a
 *      filter for trivial one-file jobs (typo, config bump).
 *   3. After that, fire whenever there is a file worth naming that has not already
 *      been edited and has not already been named. Those two exclusions are what
 *      keep it quiet; no per-session cap is needed (uncapped this measured
 *      1.07 fires/session, 2.77 suggestions, 34% of sessions silent).
 *
 * GATE: ratio >= 0.3 of the seed's own commits, >= 2 shared commits, top 5. This is
 * LOOSE on purpose — "what am I forgetting" is a RECALL question, the opposite of
 * the precision-tuned gate `gs` renders. Test files are excluded from both sides
 * (a co-edited test is what CI is for).
 *
 * DATA: the keeper's `cochange.json` sidecar, read directly. Hooks never import
 * from dist/, so the cache-dir derivation below MIRRORS getCacheDir/cacheKey in
 * src/cache/disk-cache.ts and coldstartHome() in src/constants.ts. If either
 * changes, this breaks silently — tests/cochange-nudge.test.ts pins them together.
 * Cost measured: 43 KB / 0.8 ms (coldstart) to 2.7 MB / 8 ms (kafka).
 *
 * STATE is a SEPARATE file from the find-nudge state on purpose: that state is
 * load-bearing for the search detectors and the preguard's deny-key, and this
 * feature clears itself every turn. Separate concerns, no regression surface.
 *
 * Fail-open everywhere: any error → no suggestion.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { bashEditTargets } from "./evidence.mjs";

// ---- gate (see the measurement record before retuning) ----
const MIN_RATIO = 0.3;  // shared / commits that touched the seed
const MIN_SHARED = 2;   // a single shared commit is coincidence
const TOP_K = 5;        // suggestions per firing
const MIN_FILES = 2;    // rule 2: distinct edited files before anything fires

/** Garbage collection ONLY — never a task boundary. A session that never gets
 *  another prompt leaves its file behind and nothing else would collect it. Set
 *  far beyond any plausible task so it can never cut a live one short: elapsed
 *  time does NOT bound a task (an auto-mode run edits for hours with no prompt),
 *  which is why UserPromptSubmit is the only clearing signal. */
const ORPHAN_MS = 7 * 24 * 60 * 60 * 1000;

/** Edit tools across the three hosts. Cursor adds SearchReplace, which Claude and
 *  Codex have no equivalent of — miss it and Cursor edits silently never count. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "SearchReplace"]);

/** ...and the shell, which is NOT a marginal edit path. An agent instructed to
 *  "make file changes with sed, heredocs, or short scripts" — the auto-mode
 *  default — never touches an edit TOOL, so a gate keyed on tool names alone
 *  goes completely silent for that agent. Exactly the failure this nudge exists
 *  to prevent: it edits several related files and is never asked what it forgot.
 *  Cursor's Shell is renamed to Bash upstream by adaptCursorInput; the raw names
 *  are accepted anyway so a host that skips adaptation still counts. */
const SHELL_TOOLS = new Set(["Bash", "Shell", "shell", "exec"]);

/** Claude keys the path `file_path`; Cursor's records key it `path` (verified on
 *  real Cursor transcripts, hooks/evidence.mjs). Accept every shape — the cost of
 *  being wrong is a silent dead feature on one host. */
function editedPath(toolInput) {
  const t = toolInput && typeof toolInput === "object" ? toolInput : {};
  for (const k of ["file_path", "path", "notebook_path", "target_file"]) {
    if (typeof t[k] === "string" && t[k].trim()) return t[k];
  }
  return "";
}

/** Every repo file THIS event edited: one path for an edit tool, and possibly
 *  several for a shell command (`sed -i a.ts && cat > b.ts <<EOF`). Returns []
 *  for any event that edited nothing, which is the silence path. */
function editedFiles(input, root) {
  const tool = String((input && input.tool_name) || "");
  if (EDIT_TOOLS.has(tool)) {
    const p = relPath(root, editedPath(input && input.tool_input));
    return p ? [p] : [];
  }
  if (SHELL_TOOLS.has(tool)) {
    const t = input && input.tool_input;
    const cmd = t && typeof t === "object" ? t.command || t.cmd || "" : "";
    return bashEditTargets(cmd).map((p) => relPath(root, p)).filter(Boolean);
  }
  return [];
}

const TEST_RE = [
  /(^|\/)(tests?|specs?)\//i, /(^|\/)test_[^/]*$/, /_(test|spec)\.[^.]+$/,
  /(Test|Tests|IT)\.java$/, /\.(test|spec)\.[jt]sx?$/, /(^|\/)tests?\.py$/,
];
const isTest = (p) => TEST_RE.some((re) => re.test(p));

/** Repo-relative, forward-slashed — the form cochange.json is keyed by. */
function relPath(root, p) {
  if (!p) return "";
  let out = p;
  const r = resolve(root || "");
  const abs = resolve(p);
  if (r && (abs === r || abs.startsWith(r + sep))) out = abs.slice(r.length + 1);
  else if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return ""; // outside the repo
  return out.split(sep).join("/").replace(/^\.\//, "");
}

// ---------------------------------------------------------------------------
// cochange.json — MIRRORS src/cache/disk-cache.ts (cacheKey/getCacheDir) and
// src/constants.ts (coldstartHome). Kept in sync by tests, not by discipline.
// ---------------------------------------------------------------------------
function coldstartHome() {
  const o = process.env.COLDSTART_HOME;
  return o && o.trim() ? o : join(homedir(), ".coldstart");
}

export function coChangePath(rootDir) {
  const abs = resolve(rootDir);
  const key = `${basename(abs)}-${createHash("sha256").update(abs).digest("hex").slice(0, 16)}`;
  return join(coldstartHome(), "indexes", key, "cochange.json");
}

/** null when the repo was never indexed, the keeper hasn't saved yet, or the file
 *  is unreadable — all ordinary silence, never an error. */
function loadCoChange(root) {
  try {
    const p = coChangePath(root);
    if (!existsSync(p)) return null;
    const d = JSON.parse(readFileSync(p, "utf8"));
    return d && d.partners && d.touched ? d : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-(session,agent) edit list. Own file, own lifecycle.
// ---------------------------------------------------------------------------
const PREFIX = "coldstart_edits_";
const stateFile = (key) => join(tmpdir(), `${PREFIX}${key}.json`);

function loadState(key) {
  const empty = { edited: [], said: [] };
  try {
    const st = JSON.parse(readFileSync(stateFile(key), "utf8"));
    return { edited: Array.isArray(st.edited) ? st.edited : [], said: Array.isArray(st.said) ? st.said : [] };
  } catch {
    return empty;
  }
}

function saveState(key, st) {
  try {
    const f = stateFile(key);
    writeFileSync(f + ".tmp", JSON.stringify(st));
    renameSync(f + ".tmp", f);
  } catch {
    /* never fail a tool call on state */
  }
}

/**
 * Rule 1. Called from the UserPromptSubmit recall hooks.
 *
 * Sweeps by SESSION PREFIX, not the exact key: a subagent shares its parent's
 * session id and is keyed `<sid>_<aid>`, and a new user message ends that work
 * too. UserPromptSubmit only ever reaches the main agent, so an exact-key clear
 * would leave every subagent's list to outlive its task.
 */
export function resetEditTrack(sid) {
  const dir = tmpdir();
  let names;
  try { names = readdirSync(dir); } catch { return; } // no listing → nothing to clear
  const cutoff = Date.now() - ORPHAN_MS;
  for (const f of names) {
    if (!f.startsWith(PREFIX) || !f.endsWith(".json")) continue;
    // Exact key, or this session's subagent streams (`<sid>_<aid>`) — NOT a bare
    // prefix, which would also match a different session whose id starts the same.
    const mine = sid && (f === `${PREFIX}${sid}.json` || f.startsWith(`${PREFIX}${sid}_`));
    // Sweep our own streams, and any long-abandoned one — a session that never got
    // another prompt leaves its file behind, and nothing else ever collects it.
    if (!mine) {
      try { if (statSync(join(dir, f)).mtimeMs > cutoff) continue; } catch { continue; }
    }
    try { unlinkSync(join(dir, f)); } catch { /* raced with another clear */ }
  }
}

/** Files that move with the seeds, ranked by how many seeds nominate them and then
 *  by strength. Excludes the seeds themselves, anything already named, and tests. */
function suggest(data, edited, said) {
  const votes = new Map();
  for (const seed of edited) {
    const denom = data.touched[seed];
    if (!denom) continue; // unknown to history: new file, or no pair cleared min-support
    for (const entry of data.partners[seed] || []) {
      const partner = entry && entry[0];
      const shared = entry && entry[1];
      if (!partner || !shared) continue;
      if (edited.includes(partner) || said.includes(partner) || isTest(partner)) continue;
      const ratio = shared / denom;
      if (shared < MIN_SHARED || ratio < MIN_RATIO) continue;
      const cur = votes.get(partner) || { votes: 0, shared: 0, of: 0, ratio: 0, seed: "" };
      cur.votes += 1;
      if (ratio > cur.ratio) { cur.ratio = ratio; cur.shared = shared; cur.of = denom; cur.seed = seed; }
      votes.set(partner, cur);
    }
  }
  return [...votes.entries()]
    .sort((a, b) => b[1].votes - a[1].votes || b[1].ratio - a[1].ratio || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOP_K);
}

/** Deliberate wording. The count is carried so the agent can weigh it; "not a code
 *  dependency" is explicit because otherwise the agent hunts for an import that
 *  does not exist; it asks for a CHECK rather than an edit; and it says the list is
 *  incomplete so a short one never reads as "nothing else is affected". */
function render(picks, edited) {
  const lines = picks.map(([p, m]) =>
    `  - \`${p}\` — changed in the same commit as \`${m.seed}\` in ${m.shared} of its last ${m.of} commits` +
    (m.votes > 1 ? ` (and moves with ${m.votes - 1} other file you just edited)` : ""));
  return (
    `You've edited ${edited.length} files this task: ${edited.map((f) => `\`${f}\``).join(", ")}. ` +
    `In this project's git history, these tend to change alongside them:\n${lines.join("\n")}\n` +
    "This is a HABIT in the commit history, NOT a code dependency — there is no import or call edge to " +
    "find, so don't go looking for one. CHECK whether they need a matching change (a sibling " +
    "implementation, a test in another language, a doc that has to stay in sync) and edit them only if " +
    "they do. This isn't a complete list."
  );
}

/**
 * Record an edit and decide whether to suggest.
 *
 * @param {any} input parsed PostToolUse payload (neutral shape; Cursor is adapted upstream)
 * @param {string} key the `<sid>` / `<sid>_<aid>` state key the caller already derived
 * @returns {string|null} message text, or null for silence
 */
export function coChangeNudge(input, key) {
  try {
    const root = String((input && input.cwd) || "");
    if (!root) return null;
    const files = editedFiles(input, root).filter((f) => !isTest(f)); // tests are CI's problem
    if (!files.length) return null;

    const st = loadState(key);
    for (const file of files) if (!st.edited.includes(file)) st.edited.push(file);
    // Rule 2: one file in play is a trivial job. Record it, say nothing.
    if (st.edited.length < MIN_FILES) { saveState(key, st); return null; }

    const data = loadCoChange(root);
    if (!data) { saveState(key, st); return null; }

    const picks = suggest(data, st.edited, st.said);
    if (!picks.length) { saveState(key, st); return null; }

    st.said.push(...picks.map(([p]) => p)); // rule 3: never name the same file twice
    saveState(key, st);
    return render(picks, st.edited);
  } catch {
    return null;
  }
}
