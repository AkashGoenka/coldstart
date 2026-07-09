#!/usr/bin/env node
/**
 * cursor-kb-elicit.mjs — Cursor stop + subagentStop notebook capture.
 *
 * ALWAYS FIRES when the agent touched ANY repo file this turn (mechanical
 * extraction only; THE AGENT decides what's worth writing). Same policy as
 * codex-kb-elicit.mjs — see it for the full rationale. The shared helpers
 * (buildCapturePrompt, filesBlock, noteAnnotations, the path scan, normRel) are
 * copied verbatim; only three things are Cursor-specific:
 *
 *   1. TRANSCRIPT WALK — Cursor's transcript is JSONL of
 *        {role, message:{content:[{type:"tool_use", input}]}}   (+ {type:"turn_ended"})
 *      not Codex's response_item rollout. We stringify each tool_use.input and run
 *      the SAME path-token scan (Read → input.path, Shell → input.command, MCP →
 *      tool-specific), so detection stays tool-agnostic. Scoped to the CURRENT
 *      turn via the free `turn_ended` boundary.
 *   2. RE-ENTRANCY GUARD — Cursor's followup_message re-fires `stop` on a NEW
 *      generation, so a per-generation marker alone can't stop the loop. But
 *      loop_count increments (0 = the user's own turn, >0 = a hook-continued
 *      turn), so we capture ONLY when loop_count === 0. Proven empirically
 *      2026-07-08. The generation_id marker is a belt-and-suspenders against a
 *      double-fire within one turn.
 *   3. OUTPUT — Cursor's stop/subagentStop "continue" channel is
 *      `{followup_message}` (auto-submits the next turn), not Codex's
 *      `{decision:"block", reason}`.
 *
 * Hooks never author or parse markdown — all facts come from `coldstart kb`.
 * Self-contained + fail-open: ANY error → exit 0 → the stop is allowed.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, appendFileSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { cursorRoot } from "./cursor-input.mjs";

// hooks/ sits beside dist/ in both the repo and the published package.
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// --- Logging -----------------------------------------------------------------
let LOG_FILE = join(tmpdir(), "coldstart-kb-hook.log");
function setLogRoot(root) { if (root) LOG_FILE = join(root, ".coldstart", "kb-hook.log"); }
function log(msg) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] elicit: ${msg}\n`); } catch { /* never fail logging */ }
}

// --- Touched-file detection ----------------------------------------------------
function normRel(root, p) {
  let s = String(p || "").trim();
  if (!s) return "";
  if (s.startsWith("/")) {
    if (root && s.startsWith(root + "/")) return s.slice(root.length + 1);
    return "";
  }
  return s.replace(/^\.\//, "");
}

// Path-like tokens inside any tool input. Existence under root is checked by the
// caller, so structured paths (Read input.path), shell command strings (Shell
// input.command), and MCP JSON can all be scanned without depending on a
// particular tool implementation.
const BASH_PATH_RE = /(?:^|[\s"'`=(:;|])((?:\.{1,2}\/|\/)?[A-Za-z0-9_][A-Za-z0-9_.\/-]*\.[A-Za-z0-9]{1,8})(?=$|[\s"'`):;,|>])/gm;

// The transcript accumulates the whole conversation; capture only the CURRENT
// turn. Turns are delimited by {type:"turn_ended"}; the final such record is
// this turn's own terminator, so scope to records AFTER the previous one.
function currentTurnLines(lines) {
  let boundary = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes('"turn_ended"')) boundary = i;
  }
  return lines.slice(boundary + 1);
}

function touchedFiles(transcriptPath, root) {
  const out = [];
  const seen = new Set();
  const add = (rel, mustExist) => {
    if (!rel || seen.has(rel) || rel.startsWith(".coldstart/")) return;
    if (mustExist) {
      try { if (!statSync(join(root, rel)).isFile()) return; } catch { return; }
    }
    seen.add(rel);
    out.push(rel);
  };
  let text = "";
  try { text = readFileSync(transcriptPath, "utf8"); } catch { return out; }
  const lines = text.split("\n").filter((l) => l.trim() && l[0] === "{");
  for (const line of currentTurnLines(lines)) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const content = rec && rec.message && rec.message.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || item.type !== "tool_use") continue;
      const source =
        item.input && typeof item.input === "object" ? JSON.stringify(item.input) : String(item.input || "");
      if (!source) continue;
      for (const g of source.matchAll(/coldstart\s+gs\s+([^\s"'`]+)/g)) add(normRel(root, g[1]), true);
      let n = 0;
      for (const m of source.matchAll(BASH_PATH_RE)) {
        if (++n > 40) break;
        add(normRel(root, m[1]), true);
      }
    }
  }
  return out;
}

// --- Per-file annotations from the core (hooks never parse md) -----------------
function noteAnnotations(root, files) {
  try {
    const raw = execFileSync(
      "node", [CLI, "kb", "status", "--json", "--paths", files.join(","), "--root", root],
      { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const parsed = JSON.parse(raw);
    const byPath = new Map();
    for (const entry of parsed.paths || []) byPath.set(entry.path, entry.notes || []);
    return byPath;
  } catch (e) {
    log(`kb status unavailable (${String(e).split("\n")[0]}) — annotating as no-notes`);
    return new Map();
  }
}

const MAX_PROMPT_FILES = 30;

function filesBlock(root, files) {
  const notes = noteAnnotations(root, files);
  let listed = files;
  if (files.length > MAX_PROMPT_FILES) {
    const noted = files.filter((f) => (notes.get(f) || []).length);
    const bare = files.filter((f) => !(notes.get(f) || []).length);
    listed = [...noted, ...bare].slice(0, MAX_PROMPT_FILES);
  }
  const lines = [];
  for (const rel of listed) {
    const anchored = notes.get(rel) || [];
    if (!anchored.length) { lines.push(`- ${rel}   [no notes yet]`); continue; }
    const parts = anchored.map((n) => {
      const flag = n.state === "changed" || n.state === "missing"
        ? ` — FLAGGED STALE: you just read this file, so fix or re-stamp it (list the path in "verified")`
        : "";
      return `${n.id} [${n.type} · ${n.state}]${flag} (.coldstart/notebook/notes/${n.id}.md)`;
    });
    lines.push(`- ${rel}   has notes: ${parts.join("; ")}`);
  }
  if (listed.length < files.length) lines.push(`- …and ${files.length - listed.length} more touched files`);
  return lines.join("\n");
}

// --- The capture prompt (kept identical to the Codex/Claude capture prompt) ----
function buildCapturePrompt(root, block, sid) {
  return `You have completed a task now and have gathered knowledge as a part of that task or \
process — knowledge another agent in future could make use of.

But before writing any notes, we need to decide whether the task you completed deserves a note. \
If you were investigating on an older branch or doing a PR review, we may not need to save notes \
because that code is not in the present — it's in the past or it's in the future. The notes that \
we write are backed by the code in the present. This was an example to explain to you. As an \
agent who worked on the current task, you know its exact intent and are best suited to decide \
whether this task deserves a note. And if nothing about the current code is worth recording, \
then no note is the right answer.

Once you decide the task does deserve a note, we store it in a notebook format, and this \
notebook has to be backed by the codebase you are working on.

We need to save only the working knowledge of the codebase in a specific format so that it can \
be searched and served to future cold agents. We don't need to store any general interaction you \
had, just the knowledge about the codebase. As a part of your task, you must have done some \
investigation, file reading, new file/feature addition or updated existing files or features. It \
could have been a bug fix or any other operation on the codebase. We need to store it in the \
below format —

THE NOTEBOOK HAS THREE CONTAINERS. Put each piece of knowledge in its one home:

1. FILE notes (if you decided to write a note for the entire task) — write one for EVERY file \
you actually read and understood this session. No judgment call about whether it seems obvious. \
First decide the file's CHARACTER:
   - hub    = the file has no single purpose (models.py, helpers, utils). Knowledge lives per \
SYMBOL, as facets: one facet for each symbol you worked with this session. Only symbols you \
have firsthand knowledge of — never enumerate the rest.
   - single = the file has one purpose. One summary, 1-3 sentences.
   The best facet/summary says: what it does that the name doesn't tell you, what to watch out \
for when changing it, and which tests or checks matter.

2. FLOW notes — when your task traced how something works ACROSS files: the ordered story. Each \
step points at a file (path + symbols) with its role in the story. A step never restates what a \
file note already says — the detail lives in the file's facet; the flow links to it.

3. LESSON notes — rare. Only one thing qualifies:
   - a confirmed ABSENCE ("there is no X in this repo"), with the search terms that proved it.
   If it is about one file or one symbol, it is a facet, not a lesson. Repo-wide rules and \
conventions are the human's to define (CLAUDE.md / coldstart.md / AGENTS.md) — do not mint them here.

Fixed a bug? The actual cause goes into the culpable file's facet, and the SYMPTOM words go \
into that file note's "aliases" — the symptom is what a future agent will search. If the cause \
spans files, the story is a flow.

Read a note this session that turned out WRONG? Correct it now — same spec with its "id" \
(fields merge; yours win), or op "retract" for a wrong claim. You are the warm agent; there is \
no "next".

RULES:
- Codebase knowledge only — never the interaction, the user, or your own process.
- Firsthand only: if it arrived secondhand (e.g. a subagent's report) and you did not verify it \
yourself, do not store it.
- If a future agent would not act differently for knowing it, do not store it.
- SEARCH BEFORE YOU WRITE a flow or lesson: run \`node ${CLI} kb search "<your task words>" \
--root ${root}\` once. If an existing flow already tells this mechanism's story, UPDATE it \
(same spec with its "id") instead of writing a near-duplicate.
- Note ids are never composed by you. In facet "flows" backlinks, reference a flow by its \
EXACT title (as written in your flow spec) or by an id copied from kb search output — the \
tool resolves titles to ids at write time. A typo prints a WARNING (the ref is kept but \
dangling) — fix any warning the write prints, in this session. Never guess an id.
- "verified": list every anchor path you actually read THIS session — that re-stamps its \
freshness. Never list a file you did not open.
- Paths are join keys: always repo-relative, exactly as they appear in the repo. Fix any path \
warning the write prints — a wrong path is a silently dangling link.

Files you touched this run, with their existing notes (read one before writing if you need to \
see what it already says — never create a second note for the same file):

${block}

HOW TO WRITE — ONE terminal block TOTAL: author every spec with a heredoc and
chain every write in the SAME block, flows before the file notes that
reference them. Never author specs one-per-message with a file-editing tool —
that is the single biggest waste of turns here.

  cat > /tmp/spec-1.json <<'SPEC'
  { ...flow... }
SPEC
  cat > /tmp/spec-2.json <<'SPEC'
  { ...file note; facets reference the flow by its EXACT title... }
SPEC
  node ${CLI} kb write /tmp/spec-1.json --root ${root} --session ${sid} --force && \\
  node ${CLI} kb write /tmp/spec-2.json --root ${root} --session ${sid} --force
Chain the writes with && — if a flow write fails, its dependent file notes
must not run. Never write the same note id twice.

Spec shapes (only include fields you actually have):
  file (hub):    {"type":"file-hub","path":"src/x.py","aliases":["symptom or search words"],
                  "facets":[{"symbol":"ClassOrFn","detail":"the non-obvious thing about THIS symbol",
                             "flows":["<flow-note-id or the flow's exact title>"]}]}
  file (single): {"type":"file-single","path":"src/x.py",
                  "summary":"its one purpose + how (1-3 sentences)"}
  flow:          {"type":"flow","title":"how X happens","aliases":["other words for X"],
                  "summary":"one paragraph",
                  "steps":[{"path":"src/a.py","symbols":["entry"],"role":"receives the request"}],
                  "invariants":["what must hold"],"verified":["src/a.py"]}
  lesson:        {"type":"lesson","kind":"absence","title":"the absence, e.g. no retry logic",
                  "body":"what you looked for + that it is not there",
                  "scope":{"terms":["search","terms"]}}          (the search that proved it)

When your notes are written, stop.`;
}

// --- stdin + guards -------------------------------------------------------------
function readStdin() {
  return new Promise((res) => {
    let data = "";
    let settled = false;
    const done = () => { if (!settled) { settled = true; res(data); } };
    try {
      if (process.stdin.isTTY) return done();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", done);
      process.stdin.on("error", done);
      setTimeout(done, 2000).unref?.();
    } catch { done(); }
  });
}

function logCaptureEvent(root, event) {
  try {
    const dir = join(root, ".coldstart", "notebook", ".metrics");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "capture.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
  } catch { /* metrics never wedge a stop */ }
}

process.on("uncaughtException", (e) => { log(`uncaught ${e?.stack || e}`); process.exit(0); });
process.on("unhandledRejection", (e) => { log(`unhandled ${e?.stack || e}`); process.exit(0); });

(async () => {
  let input = {};
  try {
    const raw = await readStdin();
    if (raw && raw.trim()) input = JSON.parse(raw);
  } catch (e) { log(`bad stdin ${e}`); }

  try {
    const root = String(cursorRoot(input) || "");
    setLogRoot(root);
    if (!root) { log("SKIP no-root"); process.exit(0); }

    // Re-entrancy guard (see header): capture only on the user's own turn.
    const lc = typeof input.loop_count === "number" ? input.loop_count : 0;
    if (lc > 0) { log(`SKIP hook-continuation loop_count=${lc}`); process.exit(0); }

    const sid = String(input.session_id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!sid) { log("SKIP no-session-id"); process.exit(0); }
    // generation_id is unique per turn; dedupe a double-fire within one turn.
    const tid = String(input.generation_id || sid).replace(/[^A-Za-z0-9_-]/g, "") || sid;

    const event = String(input.hook_event_name || "");
    const aid = String(input.subagent_id || input.agent_id || "main").replace(/[^A-Za-z0-9_-]/g, "") || "main";
    const marker = join(tmpdir(), `coldstart-cursor-kb-${tid}-${aid}.done`);
    if (existsSync(marker)) { log(`SKIP already-elicited session=${sid} agent=${aid}`); process.exit(0); }
    try { writeFileSync(marker, String(Date.now())); } catch { /* best effort */ }

    // subagentStop supplies the child's own transcript as agent_transcript_path;
    // stop's transcript_path is the main conversation JSONL.
    let transcriptPath = String(input.transcript_path || "");
    if (event === "subagentStop") {
      const own = String(input.agent_transcript_path || "");
      if (!own || !existsSync(own)) {
        log(`SKIP subagent-transcript-missing session=${sid} agent=${aid} tried=${own || "n/a"}`);
        process.exit(0);
      }
      transcriptPath = own;
    }
    // transcript_path is null on a brand-new conversation's first events. Fail
    // open: nav/recall still work, capture just has no evidence this turn.
    const files = transcriptPath && existsSync(transcriptPath) ? touchedFiles(transcriptPath, root) : [];

    // FAST-EXIT only when the turn touched NO repo file (pure Q&A / orchestration).
    if (!files.length) {
      log(`FAST-EXIT zero touched files session=${sid} agent=${aid} event=${event || "?"}`);
      process.exit(0);
    }

    const prompt = buildCapturePrompt(root, filesBlock(root, files), sid);
    logCaptureEvent(root, { event: "elicit", session: sid, agent: aid, touched: files.length, hook: event });
    log(`ELICIT session=${sid} agent=${aid} touched=${files.length} promptBytes=${prompt.length} event=${event || "?"}`);
    process.stdout.write(JSON.stringify({ followup_message: prompt }));
  } catch (e) {
    log(`handler ${e?.stack || e}`); // fail-open: no stdout → stop allowed
  }
  process.exit(0);
})();
