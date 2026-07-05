#!/usr/bin/env node
/**
 * kb-elicit.mjs — Stop + SubagentStop hook. Notebook capture, task-shaped.
 *
 * When an agent that did REAL reads tries to stop, block once and hand it the
 * capture prompt: the gate ("capture what avoids a future read or wrong turn —
 * not because a file was touched"), the latency discriminator ("needs a read
 * you haven't done? then don't"), per-file existing-note annotations from
 * `coldstart kb status --json`, and the exact `kb write` invocation.
 *
 * FAST-EXIT (the fix over the old prototype): zero deep reads in the
 * transcript → exit 0 WITHOUT blocking. Orchestrators and skimmers pass
 * through silently; only agents that got warm pay the one capture turn.
 *
 * SubagentStop fires too (subagents often do the only real reads); duplication
 * is guarded by disjoint transcripts + firsthand-only + SubagentStop preceding
 * Stop (the sub's notes are on disk when the main agent's two-phase write
 * runs, so they surface as "candidates → reconcile, don't duplicate").
 *
 * Hooks never author or parse markdown — all facts come from `coldstart kb`.
 * Self-contained + fail-open: ANY error → exit 0 → the stop is allowed.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, appendFileSync, readFileSync, mkdirSync } from "node:fs";

// hooks/ sits beside dist/ in both the repo and the published package.
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// --- Logging -----------------------------------------------------------------
let LOG_FILE = join(tmpdir(), "coldstart-kb-hook.log");
function setLogRoot(root) { if (root) LOG_FILE = join(root, ".coldstart", "kb-hook.log"); }
function log(msg) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] elicit: ${msg}\n`); } catch { /* never fail logging */ }
}

// --- Deep-read detection (kept from the validated prototype) ------------------
function normRel(root, p) {
  let s = String(p || "").trim();
  if (!s) return "";
  if (s.startsWith("/")) {
    if (root && s.startsWith(root + "/")) return s.slice(root.length + 1);
    return "";
  }
  return s.replace(/^\.\//, "");
}

// Files the agent read CLOSELY this run: a Read with no offset/limit (whole
// body) or a `coldstart gs <file>`. Peeks (windowed Reads) don't count.
function deepReadFiles(transcriptPath, root) {
  const out = [];
  const seen = new Set();
  const add = (rel) => {
    if (rel && !seen.has(rel) && !rel.startsWith(".coldstart/")) { seen.add(rel); out.push(rel); }
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
      if (b.name === "Read") {
        if (inp.offset == null && inp.limit == null) add(normRel(root, inp.file_path));
      } else if (b.name === "Bash") {
        for (const g of String(inp.command || "").matchAll(/coldstart\s+gs\s+(\S+)/g)) {
          add(normRel(root, g[1]));
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

function filesBlock(root, files) {
  const notes = noteAnnotations(root, files);
  const lines = [];
  for (const rel of files) {
    const anchored = notes.get(rel) || [];
    if (!anchored.length) { lines.push(`- ${rel}   [no notes yet]`); continue; }
    const parts = anchored.map((n) => {
      const flag = n.state === "changed" || n.state === "missing"
        ? ` — FLAGGED STALE: you just read this file, so fix or re-stamp it (list the path in "verified")`
        : "";
      return `${n.id} [${n.type} · ${n.state}]${flag}`;
    });
    lines.push(`- ${rel}   has notes: ${parts.join("; ")}`);
  }
  return lines.join("\n");
}

// --- The capture prompt --------------------------------------------------------
function buildCapturePrompt(root, block, sid) {
  return `You just finished a task in this repo, which keeps a NOTEBOOK — durable notes from past \
agents. One short pass now, using ONLY what is already in your head from this session.

THE GATE: capture knowledge because it avoids a future read or wrong turn — NOT because a file was \
touched. If writing something would need any read you have NOT already done this session, do not \
write it. Only firsthand knowledge counts: never write claims that arrived secondhand (e.g. from a \
subagent's report) without having verified them yourself.

Write NOTHING when: the change was trivial or mechanical · a file's purpose is obvious from its \
name and symbols · everything you used came from existing notes and nothing changed · you only \
orchestrated other agents. Silence is correct — just stop.

Worth writing (judge by your task):
- fixed a bug → a "lesson": the actual cause, titled by what it LOOKED like before you found it \
(the symptom is what a future agent will search).
- traced how something works across files → a "flow": the ordered story — which file hands to \
which, and what must hold.
- built something new → notes on what the code cannot say: the WHY, the trap, the constraint.
- investigated a question → the conclusion; a confirmed ABSENCE ("there is no X") is a note too — \
include the search terms that proved it.
- a note you read this session is WRONG → correct it NOW. You are the warm agent; there is no "next".
- you changed behavior in a file that has a note → update that note to the new reality.

Rule of thumb: create a NEW note only for a distinct thing you'd reference from elsewhere; \
otherwise edit the existing note (a detail is an edit, not a page).

Files you read closely this run, with their existing notes:

${block}

HOW TO WRITE — author a JSON spec, save it to a temp file, then run:
  node ${CLI} kb write /tmp/spec.json --root ${root} --session ${sid}

Spec shapes (one call per note; only include fields you actually have):
  file:   {"type":"file","path":"src/x.py","summary":"what it's for + how (1-3 sentences)",
           "behaviors":[{"concept_id":"short-key","symbols":["fn_name"],"detail":"the non-obvious thing"}],
           "features":[{"concept_id":"<flow-note-id>","role":"this file's part"}]}
  flow:   {"type":"flow","title":"how X happens","aliases":["other words for X"],"summary":"one paragraph",
           "steps":[{"path":"src/a.py","symbols":["entry"],"role":"receives the request"}],
           "invariants":["what must hold"],"verified":["src/a.py"]}
  lesson: {"type":"lesson","kind":"trap|rule|bug-cause|rationale|absence",
           "title":"the symptom or rule","aliases":["words a confused future agent would use"],
           "body":"when it applies + the actual truth","anchors":[{"path":"src/x.py","symbols":["fn"]}],
           "verified":["src/x.py"],"scope":{"terms":["search","terms"]}}   (scope: absence only)

- "aliases": include error messages, observed behavior, and search terms BEFORE diagnosis (never title synonyms).
- "verified": list every anchor path you actually read THIS session — that re-stamps its freshness. \
Never list a file you didn't open.
- Correct an existing note: same spec + "id":"<its-id>" (fields merge; yours win).
- Remove a wrong claim: {"type":"...","op":"retract","id":"<note-id>","target":{"kind":"behavior|feature|anchor|invariant|alias|note","key":"<concept_id|path|text>"}}
- If kb write answers "candidates": one of them IS your concept → re-run with --into <id>; \
truly new → re-run with --new. Reconcile first, then add.

When your notes are written (or nothing qualified), stop.`;
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
    const files = transcriptPath ? deepReadFiles(transcriptPath, root) : [];

    // FAST-EXIT: no deep reads → this agent never got warm → no capture turn.
    if (!files.length) {
      log(`FAST-EXIT zero deep reads session=${sid} agent=${aid} event=${input.hook_event_name || "?"}`);
      process.exit(0);
    }

    const prompt = buildCapturePrompt(root, filesBlock(root, files), sid);
    logCaptureEvent(root, { event: "elicit", session: sid, agent: aid, deepReads: files.length, hook: input.hook_event_name });
    log(`ELICIT session=${sid} agent=${aid} deepReads=${files.length} promptBytes=${prompt.length} event=${input.hook_event_name || "?"}`);
    process.stdout.write(JSON.stringify({ decision: "block", reason: prompt }));
  } catch (e) {
    log(`handler ${e?.stack || e}`); // fail-open: no stdout → stop allowed
  }
  process.exit(0);
})();
