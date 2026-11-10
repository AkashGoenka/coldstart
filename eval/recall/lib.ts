// Shared pieces for the recall eval. Every rule here was fixed on the coldstart v2 eval (2026-11-09/10) and is kept
// byte-for-byte so a run on another repo is comparable. Do NOT tune these on the set you are scoring.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const WORK = process.env.WORK ?? new URL("./work/", import.meta.url).pathname;
export const p = (...xs: string[]) => join(WORK, ...xs);

// ---------- eval-set files (written by build.ts, labelled by hand / by Claude) ----------
export type Item = { id: string; ts: string; session: string; prompt: string; history: { prompt: string; reply: string }[];
  exclude: string[]; writtenThisSession: { id: string; compactedSince: boolean }[] };
export type Label = { id: string; needed: string[]; useful: string[]; sameSession: string[]; unsure?: boolean; why?: string };
export const loadItems = (): Item[] => JSON.parse(readFileSync(p("items.json"), "utf8"));
export const readJsonl = <T>(f: string): T[] => existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];

/** right = needed ∪ useful ∪ {same-session note the agent LOST to a compaction}. A same-session note it still has is not right. */
export const rightNotes = (q: Item, l: Label) => { const lost = new Map(q.writtenThisSession.map((n) => [n.id, n.compactedSince]));
  return [...new Set([...l.needed, ...l.useful, ...l.sameSession.filter((i) => lost.get(i))])]; };

// ---------- notes ----------
export type Note = { id: string; title: string; body: string };
/** Notes as frozen into work/notes/*.md (rendered markdown with frontmatter). body keeps the "# title" line, as in v2. */
export const loadNotes = (): Note[] => readdirSync(p("notes")).filter((f) => f.endsWith(".md") && f !== "_index.md").map((f) => {
  const md = readFileSync(p("notes", f), "utf8"), fm = md.match(/^---\n([\s\S]*?)\n---\n/)!, body = md.slice(fm[0].length).trim();
  return { id: fm[1].match(/^id: (.+)$/m)![1].trim(), title: body.match(/^# (.+)$/m)?.[1] ?? "", body }; });

/** Text a dense model sees for a note: whole body minus links to other notes and backticked file paths. */
export const cleanBody = (body: string) => body
  .replace(/\n## Part of\n[\s\S]*?(?=\n## |$)/g, "\n")
  .replace(/\[\[[^\]]+\]\]/g, "")
  .replace(/`[^`\s]*\/[^`\s]*`\s*(—|-)?\s*/g, "")
  .replace(/\n{3,}/g, "\n\n").trim();

// ---------- the text a gate/ranker sees ----------
const sq = (x: string) => x.replace(/\s+/g, " ").trim();
/** head + " […] " + tail clipping, the same the labelling packets use. */
export const clip = (x: string, h: number, t: number) => { x = sq(x); return x.length <= h + t ? x : x.slice(0, h) + " […] " + x.slice(-t); };
/** "history" input = exactly the dialogue the labeller saw: last 3 exchanges (dev 200+80, agent 80+170) + prompt (600+200). */
export const historyText = (q: Item) => [...q.history.slice(-3).flatMap((h) => [`dev: ${clip(h.prompt, 200, 80)}`, `agent: ${clip(h.reply, 80, 170)}`]),
  `dev: ${clip(q.prompt, 600, 200)}`].join("\n");

/** "code-work vs chat" criteria (JevEmbed-style decision template), written before any v2 gate result. */
export const CRITERIA = {
  true: "true: The developer is asking the agent to work on specific code in this repository: find, explain, change, debug or test a file, function, hook, command or flow.",
  false: "false: The developer is chatting, giving feedback, approving, discussing plans, research, careers or writing, or asking about something outside this codebase's code.",
};

// ---------- BM25 (the shipped core's parameters: k1 1.2, b .75; title + body; identifier splitting) ----------
const IDENT = /[A-Za-z0-9_$~][A-Za-z0-9_$.\/\-~]*[A-Za-z0-9_$]|[A-Za-z0-9]/g;
const splitWord = (w: string) => w.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[_$.\/\-~]+/g, " ").trim();
export const splitIdentifiers = (text: string) => text.replace(IDENT, (w) => /[a-z][A-Z]|[A-Z]{2,}[a-z]|[_$\/~]|\w[.\-]\w/.test(w) ? splitWord(w) : w);
const STOP = new Set("the a an and or of to in on for is it this that be with as at by from are was we i you do does not can if so what how why when which there their they them our my me pls please just".split(" "));
export const tok = (s: string) => splitIdentifiers(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));

export function makeBm25(notes: Note[]) {
  const D = new Map(notes.map((n) => [n.id, tok(`${n.title}\n${n.body}`)]));
  const TF = new Map([...D].map(([id, d]) => { const m = new Map<string, number>(); for (const w of d) m.set(w, (m.get(w) ?? 0) + 1); return [id, m] as const; }));
  /** candidates = the notes that existed at the prompt; df/avgdl computed over them (= what the live hook would search). */
  return (cands: string[], text: string): [string, number][] => {
    const av = cands.reduce((a, id) => a + D.get(id)!.length, 0) / cands.length, df = new Map<string, number>();
    for (const id of cands) for (const w of TF.get(id)!.keys()) df.set(w, (df.get(w) ?? 0) + 1);
    const idf = (w: string) => Math.log(1 + (cands.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5)), qs = [...new Set(tok(text))];
    return cands.map((id) => [id, qs.reduce((s, w) => { const f = TF.get(id)!.get(w); return f ? s + idf(w) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * D.get(id)!.length / av)) : s; }, 0)] as [string, number])
      .sort((a, b) => b[1] - a[1]); };
}

// ---------- vectors ----------
export function loadVectors(model: string) {
  const info = JSON.parse(readFileSync(p("vectors", `${model}.json`), "utf8")), buf = readFileSync(p("vectors", `${model}.f32`));
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return new Map<string, Float32Array>(info.keys.map((k: string, i: number) => [k, all.subarray(i * info.dim, (i + 1) * info.dim)]));
}
export const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
