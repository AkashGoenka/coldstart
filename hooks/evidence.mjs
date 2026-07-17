/**
 * evidence.mjs — per-file evidence records from a session transcript.
 *
 * The primitive under both the capture worklist and the (pending) trigger
 * score: for every repo file the session touched, WHAT KIND of contact was it?
 *
 *   edit     — Edit/Write/NotebookEdit (Edit's old_string proves content
 *              knowledge), or `sed -i`-style in-place bash edits
 *   read     — Read tool (any window), or a bash command whose JOB is to
 *              print file content (cat/head/tail/sed -n/awk/…)
 *   gs       — `coldstart gs <path>` (structure summary; skims count —
 *              the aim is file summaries)
 *   mention  — the path appeared anywhere else: grep/rg output, ls, mv,
 *              an argument to a script, a token in some command. NOT a read.
 *
 * DEFAULT-DENY: an unknown bash verb contributes at most a mention. A missed
 * read only drops a file from ONE worklist — it returns next session — while
 * a mention promoted to "read" pollutes every worklist. The asymmetry is why
 * this is winnable where the old deep-read gate (which FAST-EXITed whole
 * sessions on its false negatives) was not.
 *
 * Bash-derived evidence is confirmed against the tool_result: a command whose
 * result never arrived or errored (file not found, interrupt) contributes
 * nothing. Read/Edit tool calls are confirmed the same way.
 *
 * Pure parser: no fs writes, no coldstart CLI calls. Disk existence checks
 * for bash-derived path guesses are the only I/O.
 */

import { join } from "node:path";
import { statSync } from "node:fs";

// Path-like tokens inside a shell command (same shape kb-elicit used):
// anything with an extension. Existence on disk is verified before a bash
// token becomes evidence — shell tokens are guesses.
const BASH_PATH_RE = /(?:^|[\s"'`=(:;|])((?:\.{1,2}\/|\/)?[A-Za-z0-9_][A-Za-z0-9_.\/-]*\.[A-Za-z0-9]{1,8})(?=$|[\s"'`):;,|>])/g;

// Verbs whose job is printing file content. Everything not listed here is a
// mention — including grep/rg (matched LINES are not the file) and
// interpreter invocations (`node x.js` runs a file, it doesn't read one).
const READ_VERBS = new Set(["cat", "head", "tail", "bat", "less", "more", "nl", "tac"]);

const TIER = { mention: 0, gs: 1, read: 2, edit: 3 };

function normRel(root, p) {
  let s = String(p || "").trim();
  if (!s) return "";
  if (s.startsWith("/")) {
    if (root && s.startsWith(root + "/")) return s.slice(root.length + 1);
    return "";
  }
  return s.replace(/^\.\//, "");
}

// Split a compound command into simple segments and classify each segment's
// path tokens by its leading verb. Best-effort shell reading — anything the
// parse can't place stays a mention.
function classifyBash(cmd) {
  const out = []; // [{rel-candidate, tier}]
  // coldstart gs is cross-segment-safe to grab globally
  for (const g of String(cmd).matchAll(/coldstart\s+gs\s+(\S+)/g)) {
    out.push({ token: g[1], tier: TIER.gs });
  }
  const segments = String(cmd).split(/\|\||&&|;|\|/);
  for (const seg of segments) {
    // strip leading env assignments (FOO=1 cmd …) and sudo/command wrappers
    const words = seg.trim().split(/\s+/);
    let vi = 0;
    while (vi < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[vi]) || words[vi] === "sudo" || words[vi] === "command")) vi++;
    const verb = (words[vi] || "").replace(/^.*\//, ""); // basename of the verb
    let tier = TIER.mention;
    if (READ_VERBS.has(verb)) tier = TIER.read;
    else if (verb === "sed") tier = /(^|\s)-i\b/.test(seg) ? TIER.edit : TIER.read; // sed -n '1,80p' = windowed read; sed -i = in-place edit
    else if (verb === "awk") tier = TIER.read;
    let n = 0;
    for (const m of seg.matchAll(BASH_PATH_RE)) {
      if (++n > 12) break; // a single huge command must not dominate
      out.push({ token: m[1], tier });
    }
  }
  return out;
}

// Shared per-file record collector — the same record shape for every host walker.
function makeCollector(root) {
  const evidence = new Map();
  const state = { ordinal: 0 };
  const commit = (rel, tier, mustExist) => {
    if (!rel || rel.startsWith(".coldstart/") || rel.includes("..")) return;
    if (mustExist) {
      try { if (!statSync(join(root, rel)).isFile()) return; } catch { return; }
    }
    let rec = evidence.get(rel);
    if (!rec) {
      rec = { reads: 0, edits: 0, gs: 0, mentions: 0, events: 0, firstEvent: state.ordinal, lastEvent: state.ordinal };
      evidence.set(rel, rec);
    }
    if (tier === TIER.edit) rec.edits++;
    else if (tier === TIER.read) rec.reads++;
    else if (tier === TIER.gs) rec.gs++;
    else rec.mentions++;
    rec.events++;
    rec.lastEvent = state.ordinal;
  };
  return { evidence, state, commit };
}

/**
 * extractEvidence(transcriptText, root) → Map<relPath, record>
 * record = { reads, edits, gs, mentions, events, firstEvent, lastEvent }
 *   events/firstEvent/lastEvent are tool-call ordinals (for retouch ranking).
 * Worklist eligibility = reads + edits + gs > 0 (contentRead); mentions never qualify.
 */
export function extractEvidence(transcriptText, root) {
  const { evidence, state, commit } = makeCollector(root);
  const pending = new Map(); // tool_use_id → [{rel, tier, mustExist}]

  for (const line of transcriptText.split("\n")) {
    if (!line.trim() || line[0] !== "{") continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }

    if (rec.type === "assistant") {
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (!b || b.type !== "tool_use") continue;
        const inp = b.input || {};
        const claims = [];
        if (b.name === "Read") {
          claims.push({ rel: normRel(root, inp.file_path), tier: TIER.read, mustExist: false });
        } else if (b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit" || b.name === "MultiEdit") {
          claims.push({ rel: normRel(root, inp.file_path || inp.notebook_path), tier: TIER.edit, mustExist: false });
        } else if (b.name === "Bash") {
          for (const c of classifyBash(String(inp.command || ""))) {
            claims.push({ rel: normRel(root, c.token), tier: c.tier, mustExist: true });
          }
        } else if (b.name === "Grep" || b.name === "Glob") {
          // native search tools: results are matches, not reads
          const p = inp.path ? normRel(root, inp.path) : "";
          if (p) claims.push({ rel: p, tier: TIER.mention, mustExist: true });
        }
        const kept = claims.filter((c) => c.rel);
        if (kept.length) pending.set(b.id, kept);
      }
    } else if (rec.type === "user") {
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (!b || b.type !== "tool_result" || !pending.has(b.tool_use_id)) continue;
        const claims = pending.get(b.tool_use_id);
        pending.delete(b.tool_use_id);
        if (b.is_error === true) continue; // errored call: the content never arrived
        state.ordinal++;
        for (const c of claims) commit(c.rel, c.tier, c.mustExist);
      }
    }
  }
  return evidence;
}

/**
 * extractCursorEvidence(transcriptText, root) — Cursor conversation JSONL.
 *
 * Records: {role:"assistant", message:{content:[{type:"tool_use", name, input}]}}
 * with Claude-shaped tool names (Read/Shell/Grep/Glob/Write/Edit — verified on
 * real transcripts 2026-07-17). Cursor's transcript carries NO tool_result
 * records, so result confirmation is impossible on this host; the compensating
 * control is a mustExist stat-check on EVERY claim (not just bash tokens) —
 * a Read of a path that isn't a file on disk contributes nothing.
 */
export function extractCursorEvidence(transcriptText, root) {
  const { evidence, state, commit } = makeCollector(root);
  for (const line of transcriptText.split("\n")) {
    if (!line.trim() || line[0] !== "{") continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || b.type !== "tool_use") continue;
      const inp = b.input || {};
      state.ordinal++;
      if (b.name === "Read") {
        commit(normRel(root, inp.path || inp.file_path), TIER.read, true);
      } else if (b.name === "Edit" || b.name === "Write" || b.name === "MultiEdit" || b.name === "SearchReplace") {
        // On edits mustExist stays true: Cursor supplies no results, and a
        // Write that never landed should not anchor a note. A genuinely new
        // file exists on disk by the time the Stop hook runs.
        commit(normRel(root, inp.path || inp.file_path), TIER.edit, true);
      } else if (b.name === "Shell" || b.name === "Bash") {
        for (const c of classifyBash(String(inp.command || ""))) {
          commit(normRel(root, c.token), c.tier, true);
        }
      } else if (b.name === "Grep" || b.name === "Glob") {
        const p = inp.path ? normRel(root, inp.path) : "";
        if (p) commit(p, TIER.mention, true); // search hits are not reads
      }
    }
  }
  return evidence;
}

// Codex embeds shell invocations inside a JS tool script:
//   tools.exec_command({"cmd":"<shell>", ...})
// The script is agent-authored JS, so the key appears both quoted ("cmd":) and
// unquoted (cmd:) across rollouts — accept either. Values are JSON-escaped.
function codexCmdStrings(input) {
  const out = [];
  for (const m of String(input).matchAll(/(?:"cmd"|\bcmd)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try { out.push(JSON.parse(`"${m[1]}"`)); } catch { /* bad escape: skip */ }
  }
  return out;
}

/**
 * extractCodexEvidence(transcriptText, root) — Codex rollout JSONL.
 *
 * Records: {type:"response_item", payload:{type:"custom_tool_call"|"function_call",
 * name, call_id, input|arguments}} paired with *_output payloads by call_id —
 * so Codex evidence IS result-confirmed, like Claude's. Tool surface (verified
 * on real rollouts 2026-07-17): name "exec" wraps shell commands in a JS
 * script (classifyBash over each extracted "cmd"); "apply_patch" carries
 * `*** Update/Add File:` headers (edit tier). Anything else: default-deny —
 * its path tokens are at most mentions.
 */
export function extractCodexEvidence(transcriptText, root) {
  const { evidence, state, commit } = makeCollector(root);
  const pending = new Map(); // call_id → [{rel, tier, mustExist}]
  for (const line of transcriptText.split("\n")) {
    if (!line.trim() || line[0] !== "{") continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== "response_item") continue;
    const p = rec.payload || {};
    if (p.type === "custom_tool_call" || p.type === "function_call") {
      const input = typeof p.input === "string" ? p.input
        : typeof p.arguments === "string" ? p.arguments
        : JSON.stringify(p.input ?? p.arguments ?? "");
      const claims = [];
      if (p.name === "apply_patch" || /^\s*\*\*\* (?:Begin Patch|Update File|Add File)/m.test(input)) {
        for (const m of input.matchAll(/\*\*\* (?:Update|Add) File:\s*([^\n\\"]+)/g)) {
          claims.push({ rel: normRel(root, m[1].trim()), tier: TIER.edit, mustExist: true });
        }
      } else {
        const cmds = codexCmdStrings(input);
        if (cmds.length) {
          for (const cmd of cmds) {
            for (const c of classifyBash(cmd)) claims.push({ rel: normRel(root, c.token), tier: c.tier, mustExist: true });
          }
        } else {
          // Unknown tool: default-deny — a `coldstart gs` stays gs (explicit
          // signature), every other path token is a mention at most.
          for (const c of classifyBash(input)) claims.push({ rel: normRel(root, c.token), tier: c.tier === TIER.gs ? TIER.gs : TIER.mention, mustExist: true });
        }
      }
      const kept = claims.filter((c) => c.rel);
      if (kept.length && p.call_id) pending.set(p.call_id, kept);
    } else if (p.type === "custom_tool_call_output" || p.type === "function_call_output") {
      const claims = pending.get(p.call_id);
      if (!claims) continue;
      pending.delete(p.call_id);
      state.ordinal++;
      for (const c of claims) commit(c.rel, c.tier, c.mustExist);
    }
  }
  return evidence;
}

/** Files eligible for the capture worklist: actual content contact only. */
export function contentReadFiles(evidence) {
  return [...evidence.entries()]
    .filter(([, r]) => r.reads + r.edits + r.gs > 0)
    .sort((a, b) => (b[1].edits - a[1].edits) || (b[1].events - a[1].events))
    .map(([rel]) => rel);
}

/**
 * segmentStats(text) — synthesis detection for a transcript slice (the lines
 * since the previous Stop). A synthesis turn is prose-heavy and tool-light:
 * the agent is explaining/summarizing, which counts as an ACTIVE stop for the
 * trigger even though it touched no new files.
 */
export function segmentStats(text) {
  let toolCalls = 0;
  let textBytes = 0;
  for (const line of text.split("\n")) {
    if (!line.trim() || line[0] !== "{") continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== "assistant") continue;
    for (const b of rec.message?.content || []) {
      if (!b) continue;
      if (b.type === "tool_use") toolCalls++;
      else if (b.type === "text") textBytes += String(b.text || "").length;
    }
  }
  return { toolCalls, textBytes, synthesis: textBytes >= 1500 && toolCalls <= 2 };
}

/** segmentStats for a Cursor transcript slice (assistant text vs tool_use items). */
export function segmentStatsCursor(text) {
  let toolCalls = 0;
  let textBytes = 0;
  for (const line of text.split("\n")) {
    if (!line.trim() || line[0] !== "{") continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.role !== "assistant") continue;
    for (const b of rec.message?.content || []) {
      if (!b) continue;
      if (b.type === "tool_use") toolCalls++;
      else if (b.type === "text") textBytes += String(b.text || "").length;
    }
  }
  return { toolCalls, textBytes, synthesis: textBytes >= 1500 && toolCalls <= 2 };
}

