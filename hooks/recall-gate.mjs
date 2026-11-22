/**
 * recall-gate.mjs — the learned "does the agent need a note NOW?" gate for the
 * Claude Code recall hook (kb-recall.mjs).
 *
 * WHY: similarity alone cannot gate recall — a high score means "same topic as
 * the conversation", not "the agent needs this" (a note the agent already read
 * scores just as high). The only candidate that beat never-inject on three
 * held-out eval sets is the RAW top similarity plus six cheap SESSION FACTS,
 * combined by a logistic regression fitted offline (coldstart-rag
 * scripts/pilot-gate/confirm-v3-q4.ts; params in recall-gate-params.json).
 * Eval (q4, centred on the notes' mean): v2 CV 212/300 (never-inject 192),
 * v1 43/80 (44), v3 145/200 (135). Promising, NOT proven — every injection
 * decision is logged to .metrics/gate-log.jsonl so live use can judge it.
 *
 * Pipeline, mirroring the pilot exactly (parity matters — the weights were fit
 * on these exact texts and features):
 *   query  = prompt + 1 prior exchange, "H1" format (dev:/agent: lines, clipped)
 *   embed  = EmbeddingGemma 2, q4 text model, mean pool, model-card prefixes
 *   rank   = cosine on vectors CENTRED on the mean of the active note vectors
 *   top    = RAW cosine of the centred-rank #1 note
 *   facts  = about that #1 note, from the transcript, events since compaction
 *   p      = sigmoid(bias + Σ w·(x−mean)/sd);  inject top 3 when p ≥ cutoffP
 *
 * Vectors come from the embedder daemon (hooks/embedder-daemon.mjs): note vectors are read straight from the
 * repo's vector store (the daemon embeds every note in the background, notified by `kb write`), and the query is
 * one `embed` request (~25 ms warm). A note without a stored vector yet, a daemon that is off or not ready within
 * the cold-start wait, or any error → status "unavailable" and the hook falls back to today's BM25 recall.
 * The gate needs no embedder opt-in (it is on by default and used to load the model in-process per prompt);
 * COLDSTART_EMBEDDER=0 / `init --no-embedder` still turn it off.
 *
 * Claude-only: the facts are read off Claude Code's transcript format. Codex
 * and Cursor keep BM25 recall.
 */

import { readFileSync, readdirSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { DIM, RECIPE, embedKey, vectorsDir } from "./embed-recipe.mjs";
import { embedTexts, embedderOff, ensureEmbedder, notifyEmbedder, repoCacheDir, waitForEmbedder } from "./embed-client.mjs";
import { openReader } from "./vector-store.mjs";

export const PARAMS = JSON.parse(readFileSync(new URL("./recall-gate-params.json", import.meta.url), "utf8"));
/** Daemon not running (first prompt after its idle exit): spawn it and wait this long for the model (design §4). */
const COLD_WAIT_MS = 2500;
/** A warm query is ~25 ms, but it queues behind one in-flight background embed (a long note: up to ~2 s). */
const QUERY_BUDGET_MS = 3000;

// ---------------------------------------------------------------- notes

/** The note text the pilot embedded ("clean"): body minus links to other
 *  notes, wikilinks and backticked file paths. Verbatim from texts-clean.ts. */
export const cleanBody = (body) => body
  .replace(/\n## Part of\n[\s\S]*?(?=\n## |$)/g, "\n")
  .replace(/\[\[[^\]]+\]\]/g, "")
  .replace(/`[^`\s]*\/[^`\s]*`\s*(—|-)?\s*/g, "")
  .replace(/\n{3,}/g, "\n\n").trim();

/** Active notes from the rendered markdown: id, file stem, anchor paths, and
 *  the hash of the exact text the model sees. */
export function readActiveNotes(root) {
  const dir = join(root, ".coldstart", "notebook", "notes");
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md") || f === "_index.md") continue;
    let md;
    try { md = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fm || !/^status: active$/m.test(fm[1])) continue;
    const id = fm[1].match(/^id: (.+)$/m)?.[1]?.trim();
    if (!id) continue;
    const anchors = [];
    for (const m of fm[1].matchAll(/^\s*- (\{"path".*\})\s*$/gm)) { try { anchors.push(JSON.parse(m[1]).path); } catch { /* skip */ } }
    const text = cleanBody(md.slice(fm[0].length).trim());
    out.push({ id, file: f.slice(0, -3), anchors, text });
  }
  return out;
}

/** Active notes with their stored vector. `missing` = notes the daemon has not embedded yet (new or edited). */
export function notesWithVectors(root, cacheDir = repoCacheDir(root)) {
  const notes = readActiveNotes(root);
  const keys = notes.map((n) => embedKey("note_doc", n.text));
  const got = openReader(vectorsDir(cacheDir), { recipe: RECIPE, dim: DIM }).get(keys);
  const ready = [], missing = [];
  notes.forEach((n, i) => { const vec = got.get(keys[i]); if (vec) ready.push({ ...n, vec }); else missing.push(n); });
  return { ready, missing };
}

/** The query vector from the daemon; a daemon that is down gets spawned and up to COLD_WAIT_MS to load. */
async function embedQuery(query, log) {
  // everything (incl. a retry) must finish inside kb-recall's 5 s race, or the BM25 fallback never gets its turn
  const deadline = Date.now() + 4500;
  const ask = (ms) => embedTexts([query], "note_query", { connectMs: 200, budgetMs: ms });
  const t0 = Date.now();
  let v = await ask(QUERY_BUDGET_MS);
  if (v) return { vec: v[0] };
  if (Date.now() - t0 > 1000) return { why: "embedder-busy" }; // it was up but slow: a retry would only lose the race
  const st = await ensureEmbedder({ optIn: false });
  log?.(`gate: embedder ${st}`);
  if (st === "disabled" || st === "cooldown" || st === "error") return { why: `embedder-${st}` };
  if (!(await waitForEmbedder(Math.min(COLD_WAIT_MS, deadline - Date.now() - 500)))) return { why: "embedder-cold" };
  const left = deadline - Date.now() - 200;
  if (left < 300) return { why: "embedder-cold" };
  v = await ask(left);
  return v ? { vec: v[0] } : { why: "embedder-no-answer" };
}

// ---------------------------------------------------------------- transcript

// Same rules as coldstart-rag scripts/extract-turns.ts: a "turn" is a prompt
// the human typed, its reply is the assistant's TEXT in that turn.
const stripNoise = (s) => s
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
  .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
  .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
  .trim();
export const notHuman = (s) => !s
  || /^<(command-|local-command|bash-|task-notification)/.test(s)
  || s.startsWith("Caveat:")
  || s.startsWith("[Request interrupted")
  || s.startsWith("This session is being continued from a previous conversation");
export const cleanPrompt = (s) => stripNoise(String(s ?? ""));

const NOTE_PATH_RE = /notebook\/notes\/([^\s\\"`)]+?)\.md/g;
const EDIT_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit"]);

/**
 * Parse a Claude Code transcript into the pilot's two streams:
 *   events — compact | shown (a note path in any NON-assistant line: hook
 *            injections, tool results) | opened (agent Read/Edit of a note
 *            file) | file (agent Read/Edit/Write of a repo file, repo-relative)
 *   turns  — human prompts with their assistant text replies
 * Only lines strictly before `beforeTs` (ISO) when given — the replay/parity
 * path; live, the current prompt is not a turn yet.
 */
export function parseTranscript(text, root, beforeTs) {
  const prefix = root.endsWith("/") ? root : root + "/";
  const events = [], turns = [];
  let cur = null;
  for (const l of text.split("\n")) {
    if (!l) continue;
    // Cheap pre-filter: most lines are tool results / attachments with none
    // of the markers we need; skip JSON.parse for them.
    const isUser = l.includes('"type":"user"'), isAsst = l.includes('"type":"assistant"');
    const hasNote = l.includes("notebook/notes/"), isComp = l.includes("compact_boundary");
    if (!isUser && !isAsst && !hasNote && !isComp) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    const ts = e.timestamp;
    if (!ts || (beforeTs && ts >= beforeTs)) continue;
    if (e.type === "system" && e.subtype === "compact_boundary") { events.push({ ts, kind: "compact" }); continue; }
    if (e.type !== "assistant" && hasNote) for (const m of l.matchAll(NOTE_PATH_RE)) events.push({ ts, kind: "shown", v: m[1] });
    const c = e.message?.content;
    if (e.type === "assistant" && Array.isArray(c)) {
      for (const b of c) {
        if (b.type !== "tool_use" || !b.input?.file_path || !EDIT_TOOLS.has(b.name)) continue;
        const raw = String(b.input.file_path);
        if (!raw.startsWith(prefix)) continue;
        const p = raw.slice(prefix.length), nm = p.match(/^\.coldstart\/notebook\/notes\/(.+)\.md$/);
        events.push(nm ? { ts, kind: "opened", v: nm[1] } : { ts, kind: "file", v: p });
      }
    }
    if (e.isSidechain || e.isMeta) continue;
    if (e.type === "user") {
      const raw = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
      if (Array.isArray(c) && c.some((b) => b.type === "tool_result")) continue;
      const clean = stripNoise(raw);
      if (notHuman(clean)) continue;
      cur = { ts, prompt: clean, reply: "" };
      turns.push(cur);
    } else if (e.type === "assistant" && cur && Array.isArray(c)) {
      for (const b of c) if (b.type === "text") cur.reply += (cur.reply ? "\n" : "") + b.text;
    }
  }
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { events, turns };
}

const sq = (x) => x.replace(/\s+/g, " ").trim();
const ht = (x, h, t) => { x = sq(x); return x.length <= h + t ? x : x.slice(0, h) + " […] " + x.slice(-t); };

/** The pilot's H1 query: the latest prior exchange whose prompt differs from
 *  this one (a re-sent prompt is not context), then this prompt. */
export function buildQuery(prompt, turns) {
  const p = prompt.trim();
  const prev = [...turns].reverse().find((t) => t.prompt.trim() !== p);
  return [
    ...(prev ? [`dev: ${ht(prev.prompt, 200, 80)}`, `agent: ${ht(prev.reply, 80, 170)}`] : []),
    `dev: ${ht(prompt, 600, 200)}`,
  ].join("\n");
}

/** First-line timestamp of each note's raw log = when the note was created. */
function createdAt(root, file) {
  try {
    const fd = openSync(join(root, ".coldstart", "notebook", ".raw", `${file}.jsonl`), "r");
    try {
      const buf = Buffer.alloc(4096);
      const n = readSync(fd, buf, 0, buf.length, 0);
      return JSON.parse(buf.subarray(0, n).toString("utf8").split("\n")[0]).ts ?? null;
    } finally { closeSync(fd); }
  } catch { return null; }
}

/** The six session facts about the #1 note (+ "opened"), as the pilot
 *  computed them. `nowTs` = the prompt's time (ISO). */
export function sessionFacts({ events, turns }, note, root, nowTs) {
  const comps = events.filter((e) => e.kind === "compact");
  const lastC = comps.at(-1)?.ts ?? "";
  const since = events.filter((e) => e.ts > lastC);
  // Pilot quirk kept for parity: "session start" = the first EVENT, not the
  // first transcript line.
  const start = events[0]?.ts ?? nowTs;
  const prior = turns.filter((t) => t.ts > lastC).length;
  const prevTurn = turns.at(-1)?.ts ?? "";
  const match = (e) => e.v === note.file || e.v === note.id;
  const cr = createdAt(root, note.file) ?? createdAt(root, note.id);
  return {
    shown: +since.some((e) => e.kind === "shown" && match(e)),
    opened: +since.some((e) => e.kind === "opened" && match(e)),
    written: +(!!cr && cr >= start && cr < nowTs && !comps.some((c) => c.ts > cr)),
    since: Math.log1p(prior),
    justComp: +(comps.length > 0 && lastC > prevTurn),
    files: +since.some((e) => e.kind === "file" && note.anchors.includes(e.v)),
  };
}

// ---------------------------------------------------------------- scoring

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function centerer(vecs) {
  const dim = vecs[0].length, mu = new Float64Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) mu[i] += v[i] / vecs.length;
  return (v) => { const c = Float64Array.from(v, (x, i) => x - mu[i]); const n = Math.hypot(...c) || 1; return c.map((x) => x / n); };
}

/** Rank notes for a query vector: centred cosine for the order, raw cosine
 *  kept for the gate's `top` feature. */
export function rankNotes(qv, notes) {
  const ctr = centerer(notes.map((n) => n.vec)), qc = ctr(qv);
  return notes.map((n) => ({ n, c: dot(qc, ctr(n.vec)), r: dot(qv, n.vec) })).sort((a, b) => b.c - a.c);
}

export function gateProbability(f, params = PARAMS) {
  let z = params.bias;
  params.features.forEach((k, j) => { z += params.weights[j] * ((f[k] - params.mean[j]) / params.sd[j]); });
  return 1 / (1 + Math.exp(-z));
}

/**
 * The whole gate for one prompt. Never throws.
 *   { status: "ok", p, inject, ids, top, features, ms }
 *   { status: "unavailable", reason }   → caller falls back to BM25
 */
export async function runGate({ root, prompt, transcriptPath, nowTs = new Date().toISOString(), log }) {
  const t0 = Date.now();
  try {
    const clean = cleanPrompt(prompt);
    if (notHuman(clean)) return { status: "unavailable", reason: "not-human-prompt" };
    if (embedderOff()) return { status: "unavailable", reason: "embedder-off" };
    const cacheDir = repoCacheDir(root);
    const { ready, missing } = notesWithVectors(root, cacheDir);
    if (missing.length) {
      // the daemon embeds them in the background; this prompt falls back, later ones get the gate
      await notifyEmbedder("notes-changed", root, cacheDir, {}, { optIn: false });
      return { status: "unavailable", reason: `vectors-stale(${missing.length})` };
    }
    if (!ready.length) return { status: "unavailable", reason: "no-notes" };
    // On a session's FIRST prompt Claude Code has not created the transcript
    // file yet (11/11 first prompts in the gate-test run). That is the pilot's
    // first-prompt state exactly: no turns, no events. Not a reason to fall back.
    const tx = transcriptPath && existsSync(transcriptPath)
      ? parseTranscript(readFileSync(transcriptPath, "utf8"), root)
      : { events: [], turns: [] };
    // The host may already have written THIS prompt to the transcript when the
    // hook runs. The pilot used only turns strictly before the prompt, so drop
    // it — else "since" counts one extra and "justComp" can never fire.
    const last = tx.turns.at(-1);
    if (last && !last.reply && last.prompt.trim() === clean.trim()) tx.turns.pop();
    const query = buildQuery(clean, tx.turns);
    const q = await embedQuery(query, log);
    if (!q.vec) return { status: "unavailable", reason: q.why };
    const qv = q.vec;
    const ranked = rankNotes(qv, ready);
    const top = ranked[0];
    const features = { top: top.r, ...sessionFacts(tx, top.n, root, nowTs) };
    const p = gateProbability(features);
    return {
      status: "ok", p, inject: p >= PARAMS.cutoffP,
      ids: ranked.slice(0, 3).map((x) => x.n.id),
      top: ranked.slice(0, 3).map((x) => ({ id: x.n.id, c: +x.c.toFixed(4), r: +x.r.toFixed(4) })),
      features, ms: Date.now() - t0,
    };
  } catch (e) {
    return { status: "unavailable", reason: `error: ${String(e?.message || e).split("\n")[0]}` };
  }
}
