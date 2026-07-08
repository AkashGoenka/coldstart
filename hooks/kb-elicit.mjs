#!/usr/bin/env node
/**
 * kb-elicit.mjs — Stop + SubagentStop hook. Notebook capture, task-shaped.
 *
 * ALWAYS FIRES when the agent touched ANY repo file this session — the old
 * deep-read gate (whole-file Reads + `gs` only) is gone: read-modality
 * classification proved unwinnable (windowed Reads, Bash cat/sed, MCP readers
 * are all invisible to it — a q8-style session lost real knowledge to a
 * FAST-EXIT). The hook does mechanical extraction only; THE AGENT decides
 * whether anything is worth writing — the prompt's gate and "write NOTHING
 * when" list carry that decision. FAST-EXIT remains only for sessions that
 * touched zero repo files (pure orchestrators / Q&A turns).
 *
 * Merge-vs-new is agent-curated: touched files are annotated with their
 * existing notes (id + note file path, from `coldstart kb status --json`) so
 * the agent can read a candidate and pass --into/--new on its FIRST kb write
 * — the exit-3 candidates bounce is the safety net, not the mechanism.
 *
 * SubagentStop fires too (subagents often do the only real reads); duplication
 * is guarded by disjoint transcripts + firsthand-only + SubagentStop preceding
 * Stop (the sub's notes are on disk when the main agent's write runs, so they
 * surface as "candidates → reconcile, don't duplicate").
 *
 * Hooks never author or parse markdown — all facts come from `coldstart kb`.
 * Self-contained + fail-open: ANY error → exit 0 → the stop is allowed.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, appendFileSync, readFileSync, mkdirSync, statSync } from "node:fs";

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

// Path-like tokens inside a shell command: anything with an extension, plus
// whatever follows `coldstart gs`. Existence under root is checked by the
// caller — this only extracts candidates.
const BASH_PATH_RE = /(?:^|[\s"'`=(:;|])((?:\.{1,2}\/|\/)?[A-Za-z0-9_][A-Za-z0-9_.\/-]*\.[A-Za-z0-9]{1,8})(?=$|[\s"'`):;,|>])/gm;

// EVERY repo file the agent touched this run, however it got there: Read
// (windowed or not), Edit/Write, `coldstart gs`, or a path mentioned in a
// Bash command (cat/sed/grep/head — the modalities the old deep-read gate was
// blind to). Whether any of it is WORTH capturing is the agent's call.
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
  for (const line of text.split("\n")) {
    if (!line.trim() || line[0] !== "{") continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== "assistant") continue;
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || b.type !== "tool_use") continue;
      const inp = b.input || {};
      if (b.name === "Read" || b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit") {
        add(normRel(root, inp.file_path), false);
      } else if (b.name === "Bash") {
        const cmd = String(inp.command || "");
        for (const g of cmd.matchAll(/coldstart\s+gs\s+(\S+)/g)) add(normRel(root, g[1]), false);
        let n = 0;
        for (const m of cmd.matchAll(BASH_PATH_RE)) {
          if (++n > 12) break; // a single huge command must not dominate
          add(normRel(root, m[1]), true); // shell tokens are guesses — verify on disk
        }
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

// Always-fire can surface long touch lists; the prompt stays bounded. Files
// WITH existing notes always make the cut (they carry the merge decision).
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

// --- The capture prompt (v4, 2026-07-07 — user-authored opening; validation-run
// configuration: gates off via --force, capture-only) ---------------------------
function buildCapturePrompt(root, block, sid) {
  return `You have completed a task now and have gathered knowledge as a part of that task or \
process. We need to preserve the knowledge so that another agent in future can make use of your \
findings. We are storing this in a notebook format and this notebook has to be backed by the \
codebase you are working on.

We need to save only the working knowledge of the codebase in a specific format so that it can \
be searched and served to future cold agents. We don't need to store any general interaction you \
had, just the knowledge about the codebase. As a part of your task, you must have done some \
investigation, file reading, new file/feature addition or updated existing files or features. It \
could have been a bug fix or any other operation on the codebase. We need to store it in the \
below format —

THE NOTEBOOK HAS THREE CONTAINERS. Put each piece of knowledge in its one home:

1. FILE notes — write one for EVERY file you actually read and understood this session. No \
judgment call about whether it seems obvious. First decide the file's CHARACTER:
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

HOW TO WRITE — ONE Bash block TOTAL: author every spec with a heredoc and
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
    const root = String(input.cwd || "");
    setLogRoot(root);

    // Guard 1: already inside a hook-induced continuation → let it stop.
    if (input.stop_hook_active === true) { log("SKIP stop_hook_active"); process.exit(0); }

    // Guard 0: no identifiable session → fail open.
    const sid = String(input.session_id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!sid) { log("SKIP no-session-id"); process.exit(0); }

    // Guard 2: one elicitation per (session, agent) — subagents share the
    // parent session_id, so the marker is scoped by agent too.
    const aid = String(input.agent_id || "main").replace(/[^A-Za-z0-9_-]/g, "") || "main";
    const marker = join(tmpdir(), `coldstart-kb-${sid}-${aid}.done`);
    if (existsSync(marker)) { log(`SKIP already-elicited session=${sid} agent=${aid}`); process.exit(0); }
    try { writeFileSync(marker, String(Date.now())); } catch { /* best effort */ }

    // On SubagentStop, transcript_path is the PARENT's transcript (confirmed:
    // claude-code#11396) — scanning it would elicit the sub off the parent's
    // reads. The sub's own transcript lives at
    // <parent-transcript-stem>/subagents/agent-<agent_id>.jsonl (verified on
    // disk; agent_transcript_path in the payload is still unshipped, #16424).
    // No sub transcript found → exit; capture falls to the main Stop.
    let transcriptPath = String(input.transcript_path || "");
    if (input.hook_event_name === "SubagentStop") {
      const own = String(input.agent_transcript_path || "") ||
        (aid !== "main" && transcriptPath
          ? join(transcriptPath.replace(/\.jsonl$/, ""), "subagents", `agent-${aid}.jsonl`)
          : "");
      if (!own || !existsSync(own)) {
        log(`SKIP subagent-transcript-missing session=${sid} agent=${aid} tried=${own || "n/a"}`);
        process.exit(0);
      }
      transcriptPath = own;
    }
    const files = transcriptPath ? touchedFiles(transcriptPath, root) : [];

    // FAST-EXIT only when the agent touched NO repo file at all (pure
    // orchestration / Q&A). Anything touched → the agent judges what's worth
    // capturing; the hook never guesses from read modality.
    if (!files.length) {
      log(`FAST-EXIT zero touched files session=${sid} agent=${aid} event=${input.hook_event_name || "?"}`);
      process.exit(0);
    }

    const prompt = buildCapturePrompt(root, filesBlock(root, files), sid);
    logCaptureEvent(root, { event: "elicit", session: sid, agent: aid, touched: files.length, hook: input.hook_event_name });
    log(`ELICIT session=${sid} agent=${aid} touched=${files.length} promptBytes=${prompt.length} event=${input.hook_event_name || "?"}`);
    process.stdout.write(JSON.stringify({ decision: "block", reason: prompt }));
  } catch (e) {
    log(`handler ${e?.stack || e}`); // fail-open: no stdout → stop allowed
  }
  process.exit(0);
})();
