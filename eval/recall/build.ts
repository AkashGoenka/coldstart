// Build an UNBIASED recall eval set from this machine's Claude Code transcripts + the repo's notebook.
//   npx tsx build.ts --repo /abs/path/to/repo [--transcripts dir1,dir2] [--n 150] [--seed 20261109]
// Writes (all under work/, gitignored — never commit it):
//   items.json            prompts + 5 prior exchanges + notes-not-yet-written (exclude) + same-session notes (compactedSince)
//   notes/<id>.md         the notebook frozen NOW (rendered from .raw, so it does not depend on a stale notes/ dir)
//   catalog.md            every note: id, type/status, created time, title, anchors, summary  (what the labeller reads)
//   packets/batch-NN.md   20 prompts each: last 3 exchanges, files in context, prompt, hindsight
//   labels.jsonl          empty; the labeller fills it (see LABELLING.md)
// Population = every human-typed prompt in the repo's sessions since the first note was written, deduped by session+text.
// Uniform seeded sample. NO retriever is used to choose prompts or shortlist notes (that would bias the eval).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadAll } from "../../src/kb/store.ts";
import { renderNote } from "../../src/kb/render.ts";
import { rawDir } from "../../src/kb/raw-log.ts";
import { WORK, p, clip } from "./lib.ts";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const REPO = (arg("repo") ?? process.cwd()).replace(/\/$/, ""), N = Number(arg("n") ?? 150), SEED = Number(arg("seed") ?? 20261109);
// Claude Code stores a project's sessions under ~/.claude/projects/<repo path with every non-alphanumeric char → "-">
const TDIRS = (arg("transcripts") ?? join(homedir(), ".claude/projects", REPO.replace(/[^a-zA-Z0-9]/g, "-"))).split(",");
for (const d of TDIRS) if (!existsSync(d)) throw new Error(`no transcript dir ${d} — pass --transcripts`);
if (existsSync(p("items.json")) && process.env.REBUILD !== "1") throw new Error(`${WORK}items.json exists — labels would stop matching. Delete work/ (or REBUILD=1) only if nothing is labelled yet.`);

// ---------- 1. transcripts → turns (the typed prompt, the agent's text reply, the files it touched) ----------
type Turn = { session: string; idx: number; ts: string; prompt: string; reply: string; touched: string[] };
const stripNoise = (s: string) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
  .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "").trim();
const notHuman = (s: string) => !s || /^<(command-|local-command|bash-|task-notification)/.test(s) || s.startsWith("Caveat:") ||
  s.startsWith("[Request interrupted") || s.startsWith("This session is being continued from a previous conversation");
const rel = (x: string) => (x.startsWith(REPO + "/") ? x.slice(REPO.length + 1) : x);
const PATHLIKE = /(?:^|[\s'"`(])((?:[\w.-]+\/)+[\w.-]+\.\w+)/g;
const turns: Turn[] = [], compactions = new Map<string, string[]>();
const files = TDIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => join(d, f)))
  .map((f) => ({ f, t: statSync(f).mtimeMs })).sort((a, b) => a.t - b.t).map((x) => x.f);
for (const f of files) {
  const session = f.split("/").pop()!.replace(/\.jsonl$/, ""), comp: string[] = [];
  let cur: Turn | null = null, idx = 0;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line) continue; let e: any; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "system" && e.subtype === "compact_boundary" && e.timestamp) comp.push(e.timestamp);
    if (e.isSidechain || e.isMeta) continue;
    const c = e.message?.content;
    if (e.type === "user") {
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") : "";
      const clean = stripNoise(text);
      if ((Array.isArray(c) && c.some((b: any) => b.type === "tool_result")) || notHuman(clean)) continue;
      if (cur) turns.push(cur);
      cur = { session, idx: idx++, ts: e.timestamp, prompt: clean, reply: "", touched: [] };
    } else if (e.type === "assistant" && cur && Array.isArray(c)) for (const b of c) {
      if (b.type === "text") cur.reply += (cur.reply ? "\n" : "") + b.text;
      if (b.type === "tool_use") { const i = b.input ?? {}, paths: string[] = [];
        if (i.file_path) paths.push(rel(i.file_path));
        if (typeof i.command === "string") for (const m of i.command.matchAll(PATHLIKE)) paths.push(rel(m[1]));
        for (const x of paths) if (!x.includes("..") && !cur.touched.includes(x)) cur.touched.push(x); } // ".." = a git range, not a file
    }
  }
  if (cur) turns.push(cur);
  compactions.set(session, comp.sort());
}

// ---------- 2. the notebook, frozen now ----------
const created = new Map<string, string>();
for (const f of readdirSync(rawDir(REPO)).filter((f) => f.endsWith(".jsonl"))) {
  try { created.set(f.replace(/\.jsonl$/, ""), JSON.parse(readFileSync(join(rawDir(REPO), f), "utf8").split("\n")[0]).ts); } catch {} }
const notes = loadAll(REPO).notes.map((n: any) => ({ ...n, created: created.get(n.id) ?? "?" })).sort((a: any, b: any) => a.created.localeCompare(b.created));
if (!notes.length) throw new Error(`no notes in ${REPO}/.coldstart/notebook`);
const firstNote = notes[0].created;

// ---------- 3. population + uniform seeded sample ----------
const seen = new Set<string>(), pop: Turn[] = [];
for (const t of turns) { if (!t.ts || t.ts < firstNote) continue; const k = t.session + "|" + t.prompt.trim(); if (seen.has(k)) continue; seen.add(k); pop.push(t); }
let s = SEED; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const sample = pop.map((t) => [rnd(), t] as const).sort((a, b) => a[0] - b[0]).slice(0, N).map((x) => x[1]).sort((a, b) => a.ts.localeCompare(b.ts));

// ---------- 4. write ----------
mkdirSync(p("notes"), { recursive: true }); mkdirSync(p("packets"), { recursive: true }); mkdirSync(p("labels-review"), { recursive: true });
for (const n of notes) writeFileSync(p("notes", `${n.id}.md`), renderNote(n));
const sq = (x: string) => x.replace(/\s+/g, " ").trim();
writeFileSync(p("catalog.md"), notes.map((n: any) =>
  `### ${n.id}\n[${n.type}${n.status && n.status !== "active" ? ", " + n.status : ""}] created ${n.created.slice(0, 16)} — ${n.title}\nanchors: ${n.anchors.slice(0, 6).map((a: any) => a.path).join(", ")}${n.anchors.length > 6 ? ` +${n.anchors.length - 6}` : ""}\n${sq(n.summary ?? n.head ?? "").slice(0, 320)}\n`).join("\n"));
const bySession = new Map<string, Turn[]>(); for (const t of turns) (bySession.get(t.session) ?? bySession.set(t.session, []).get(t.session)!).push(t);
const items: any[] = []; let md = "";
sample.forEach((t, i) => {
  const id = `V${String(i + 1).padStart(3, "0")}`, sess = bySession.get(t.session)!;
  const prior5: Turn[] = []; // dedupe replayed lines (a resume re-sends the same prompt)
  for (const x of sess.filter((x) => x.idx < t.idx).reverse()) { if (x.prompt.trim() === t.prompt.trim() || prior5.some((q) => q.prompt.trim() === x.prompt.trim())) continue; prior5.unshift(x); if (prior5.length === 5) break; }
  const prior = prior5.slice(-3), later = notes.filter((n: any) => n.created > t.ts).map((n: any) => n.id);
  const comp = (compactions.get(t.session) ?? []).filter((c) => c <= t.ts);
  const sameSession = notes.filter((n: any) => n.created >= sess[0].ts && n.created <= t.ts).map((n: any) => ({ id: n.id, compactedSince: comp.some((c) => c > n.created) }));
  const ctxFiles = [...new Set(sess.filter((x) => x.idx < t.idx).flatMap((x) => x.touched))].filter((f) => !f.startsWith("/")).slice(-8);
  items.push({ id, ts: t.ts, session: t.session, prompt: t.prompt, history: prior5.map((x) => ({ prompt: x.prompt, reply: x.reply })), exclude: later, writtenThisSession: sameSession });
  md += `## ${id} · ${t.ts.slice(0, 16)} · ${notes.length - later.length} notes existed\n`;
  if (sameSession.length) { const kept = sameSession.filter((x) => !x.compactedSince).map((x) => x.id), lost = sameSession.filter((x) => x.compactedSince).map((x) => x.id);
    if (kept.length) md += `**written earlier this session, NO compaction since (agent still has it):** ${kept.join(", ")}\n`;
    if (lost.length) md += `**written earlier this session, COMPACTED since (agent lost it):** ${lost.join(", ")}\n`; }
  for (const x of prior) md += `- **dev:** ${clip(x.prompt, 200, 80)}\n- **agent:** ${clip(x.reply, 80, 170)}\n`;
  md += `**files in context:** ${ctxFiles.join(", ") || "—"}\n\n**PROMPT:** ${clip(t.prompt, 600, 200)}\n\n`;
  md += `*hindsight — reply:* ${clip(t.reply, 120, 180) || "—"}\n*hindsight — files touched:* ${t.touched.filter((f) => !f.startsWith("/")).slice(0, 8).join(", ") || "—"}\n\n`;
});
writeFileSync(p("items.json"), JSON.stringify(items, null, 1));
const parts = md.split(/(?=^## V\d{3} )/m);
for (let b = 0; b < parts.length; b += 20) writeFileSync(p("packets", `batch-${String(b / 20 + 1).padStart(2, "0")}.md`), parts.slice(b, b + 20).join(""));
if (!existsSync(p("labels.jsonl"))) writeFileSync(p("labels.jsonl"), "");
console.log(`${files.length} sessions · ${turns.length} turns · population ${pop.length} (since first note ${firstNote.slice(0, 10)}) · sampled ${items.length}` +
  ` · notes ${notes.length} · ${Math.ceil(parts.length / 20)} packets → ${WORK}`);
