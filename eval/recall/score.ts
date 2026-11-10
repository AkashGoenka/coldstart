// Score every system on the labelled eval set and write work/results.md (plain-English tables).
//   npx tsx score.ts
// Needs: work/items.json + work/labels.jsonl (every item labelled) + work/vectors/<model>.* for each embedding model
// (missing models are skipped; BM25 needs no vectors).
// Nothing here is fitted to the set except the "fitted cutoff" column, which picks its line on half the prompts
// and is scored on the OTHER half (even/odd, both ways), so it is never scored on what it learned from.
import { existsSync, writeFileSync } from "node:fs";
import { loadItems, loadNotes, readJsonl, rightNotes, makeBm25, loadVectors, dot, sigmoid, historyText, p, type Label } from "./lib.ts";

const items = loadItems(), labels = new Map(readJsonl<Label>(p("labels.jsonl")).map((l) => [l.id, l]));
const missing = items.filter((q) => !labels.has(q.id)).map((q) => q.id);
if (missing.length) throw new Error(`${missing.length} items have no label yet (${missing.slice(0, 5).join(", ")}…) — finish LABELLING.md first`);
const Qs = items.map((q) => ({ ...q, right: rightNotes(q, labels.get(q.id)!) })), N = Qs.length;
const need = Qs.map((q) => q.right.length > 0), NEED = need.filter(Boolean).length;
const notes = loadNotes(), noteIds = notes.map((n) => n.id), bm25 = makeBm25(notes);
const cands = (q: (typeof Qs)[number]) => { const ex = new Set(q.exclude); return noteIds.filter((id) => !ex.has(id)); };

type Ranked = [string, number][];
type Sys = { name: string; RP: Ranked[]; RH: Ranked[]; gates: { name: string; v: { P: number[]; H: number[] }; fixed?: { P: boolean[]; H: boolean[] } }[] };
const systems: Sys[] = [];
{ const RP = Qs.map((q) => bm25(cands(q), q.prompt)), RH = Qs.map((q) => bm25(cands(q), historyText(q)));
  const lead = (R: Ranked[]) => R.map((r) => (r[0]?.[1] ?? 0) - (r[1]?.[1] ?? 0)), nNotes = Qs.map((q) => cands(q).length);
  // the shipped hook rule: show when the best note leads the 2nd by ≥ 1 BM25 point; notebooks under 30 notes always show
  const shipped = (R: Ranked[]) => { const m = lead(R); return R.map((r, i) => (r[0]?.[1] ?? 0) > 0 && (nNotes[i] < 30 || m[i] >= 1)); };
  systems.push({ name: "BM25 (what ships today)", RP, RH, gates: [
    { name: "best note clearly beats the 2nd (shipped rule)", v: { P: lead(RP), H: lead(RH) }, fixed: { P: shipped(RP), H: shipped(RH) } },
    { name: "how well the best note matches", v: { P: RP.map((r) => r[0]?.[1] ?? 0), H: RH.map((r) => r[0]?.[1] ?? 0) } }] }); }
for (const [name, file] of [["granite-small (48M)", "granite-s"], ["EmbeddingGemma 1 (308M)", "gemma"], ["EmbeddingGemma 2 (Apache)", "gemma2"]]) {
  if (!existsSync(p("vectors", `${file}.json`))) { console.error(`skip ${file}: no vectors (run: npx tsx embed.ts ${file})`); continue; }
  const V = loadVectors(file), T = V.get("CRIT|true")!, F = V.get("CRIT|false")!;
  const rank = (q: (typeof Qs)[number], qv: Float32Array): Ranked => cands(q).map((id) => [id, dot(qv, V.get(`doc|${id}`)!)] as [string, number]).sort((a, b) => b[1] - a[1]);
  const RP = Qs.map((q) => rank(q, V.get(`P|${q.id}`)!)), RH = Qs.map((q) => rank(q, V.get(`H|${q.id}`)!));
  const crit = (k: "P" | "H") => Qs.map((q) => { const v = V.get(`${k}|${q.id}`)!; return sigmoid(10 * (dot(v, T) - dot(v, F))); });
  const cP = crit("P"), cH = crit("H");
  systems.push({ name, RP, RH, gates: [
    { name: "how close the best note is", v: { P: RP.map((r) => r[0][1]), H: RH.map((r) => r[0][1]) } },
    { name: '"about code" vs "chat"', v: { P: cP, H: cH }, fixed: { P: cP.map((x) => x >= 0.5), H: cH.map((x) => x >= 0.5) } }] });
}

// ---------- measures ----------
const at = (R: Ranked[], k: number) => R.map((r, i) => need[i] && (r[0]?.[1] ?? 0) > 0 && r.slice(0, k).some(([id]) => Qs[i].right.includes(id)));
const count = (b: boolean[]) => b.filter(Boolean).length;
/** score: +1 if it showed 3 notes and one was right, +1 if it stayed quiet and nothing was needed. Ranker = prompt-only top 3. */
const total = (good: boolean[], show: boolean[]) => show.reduce((s, sh, i) => s + (sh ? (good[i] ? 1 : 0) : need[i] ? 0 : 1), 0);
const fitted = (good: boolean[], v: number[]) => { const ths = [...new Set(v)].sort((a, b) => a - b).concat(Infinity), show: boolean[] = [];
  for (const k of [0, 1]) { const tr = v.map((_, i) => i).filter((i) => i % 2 !== k), ok = (t: number) => tr.filter((i) => (v[i] >= t ? good[i] : !need[i])).length;
    const best = ths.reduce((b, t) => (ok(t) > ok(b) ? t : b)); v.forEach((x, i) => { if (i % 2 === k) show[i] = x >= best; }); }
  return show; };
/** "tells apart": pick one prompt that needed a note and one that didn't — how often does the gate score the first higher? */
const apart = (v: number[], idx = v.map((_, i) => i)) => { const a = idx.filter((i) => need[i]).map((i) => v[i]), b = idx.filter((i) => !need[i]).map((i) => v[i]); let s = 0;
  for (const x of a) for (const y of b) s += x > y ? 1 : x === y ? 0.5 : 0; return s / a.length / b.length; };
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const realGain = (a: number[], b: number[]) => { const d: number[] = []; for (let k = 0; k < 2000; k++) { const idx = Qs.map(() => Math.floor(rnd() * N)); d.push(apart(b, idx) - apart(a, idx)); }
  d.sort((x, y) => x - y); return d[50] > 0 ? "yes" : d[1949] < 0 ? "real, WORSE" : "could be luck"; };
/** paired sign test: of the prompts where exactly one of two systems got it right, is the split better than a coin flip? */
const signP = (w: number, l: number) => { const n = w + l; if (!n) return 1; let c = 1, tail = 0; for (let k = 0; k <= Math.min(w, l); k++) { tail += c; c = (c * (n - k)) / (k + 1); }
  return Math.min(1, (2 * tail) / 2 ** n); };
const luck = (pv: number) => (pv < 0.05 ? `real (p=${pv.toFixed(2)})` : `could be luck (p=${pv.toFixed(2)})`);
const pc = (x: number) => `${Math.round(100 * x)}%`;

// ---------- report ----------
const best = systems.at(-1)!, ceiling = (N - NEED) + count(at(best.RP, 3));
let out = `# Recall eval results\n\n${N} labelled prompts · **${NEED} needed a note** · ${N - NEED} needed nothing · notebook ${notes.length} notes.\n\n`;
out += `## 1. Finding the right note (only the ${NEED} prompts that needed one)\n\n`;
out += `"Top 3" = the right note is among the 3 a system would show. "prompt" = the system searched with the prompt alone; "history" = the prompt plus the last 3 exchanges.\n\n`;
out += `| System | Top 1 (prompt) | Top 3 (prompt) | Top 5 (prompt) | Top 3 (history) | Top 3 vs BM25 |\n|---|---|---|---|---|---|\n`;
const b3 = at(systems[0].RP, 3);
for (const S of systems) { const t3 = at(S.RP, 3), w = t3.filter((x, i) => x && !b3[i]).length, l = t3.filter((x, i) => !x && b3[i]).length;
  out += `| ${S.name} | ${count(at(S.RP, 1))} | ${count(t3)} | ${count(at(S.RP, 5))} | ${count(at(S.RH, 3))} | ${S === systems[0] ? "—" : `${w} better, ${l} worse: ${luck(signP(w, l))}`} |\n`; }
out += `\n## 2. Deciding WHEN to show notes\n\n`;
out += `Every prompt scores 1 point if the system showed 3 notes and one was right, or stayed quiet when nothing was needed. ` +
  `**Never showing a note scores ${N - NEED}/${N}** — a gate is only useful if it beats that. A perfect gate on top of ${best.name}'s top 3 would score ${ceiling}.\n\n` +
  `- **Tells apart**: take one prompt that needed a note and one that didn't; how often does the gate rate the first higher? 50% = coin flip, 100% = perfect.\n` +
  `- **Fixed rule**: decided in advance, no fitting. **Fitted cutoff**: the best line, chosen on half the prompts and scored on the other half (the fairest best case).\n` +
  `- In every row the notes shown are that system's own top 3 from the prompt alone; only what the GATE reads changes (prompt → history).\n\n`;
out += `| System | Gate | Tells apart (prompt → history) | History gain real? | Score, fixed rule (prompt → history) | Score, fitted cutoff (prompt → history) |\n|---|---|---|---|---|---|\n`;
for (const S of systems) { const good = at(S.RP, 3).map((g, i) => g || false);
  for (const g of S.gates) out += `| ${S.name} | ${g.name} | ${pc(apart(g.v.P))} → ${pc(apart(g.v.H))} | ${realGain(g.v.P, g.v.H)} | ` +
    `${g.fixed ? `${total(good, g.fixed.P)} → ${total(good, g.fixed.H)}` : "—"} | ${total(good, fitted(good, g.v.P))} → ${total(good, fitted(good, g.v.H))} |\n`; }
out += `\nNever show: **${N - NEED}**. Perfect gate: ${ceiling}.\n`;
writeFileSync(p("results.md"), out);
console.log(out);
