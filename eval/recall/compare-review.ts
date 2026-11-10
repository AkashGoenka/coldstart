// Compare the main labels (work/labels.jsonl) with the blind reviewer's (work/labels-review/batch-NN.jsonl).
//   npx tsx compare-review.ts 01 02 ...      (default: every batch file present)
// Prints, for the main labeller to adjudicate one by one:
//   DISAGREE    one side says "show a note", the other says "nothing needed"
//   NO-OVERLAP  both say "show", but they share no note
//   INVALID     a label names a note written AFTER the prompt (never allowed — drop it)
// Comparison uses the scoring rule (a same-session note counts only if the agent lost it to a compaction).
import { readdirSync } from "node:fs";
import { loadItems, readJsonl, rightNotes, p, type Label } from "./lib.ts";
const it = new Map(loadItems().map((x) => [x.id, x])), A = new Map(readJsonl<Label>(p("labels.jsonl")).map((l) => [l.id, l]));
const batches = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(p("labels-review")).map((f) => f.match(/^batch-(\d+)\.jsonl$/)?.[1]).filter(Boolean) as string[];
let n = 0, agree = 0, both = 0, overlap = 0, noOverlap = 0;
for (const b of batches) for (const r of readJsonl<Label>(p("labels-review", `batch-${b}.jsonl`))) {
  const a = A.get(r.id), q = it.get(r.id); if (!q) { console.log(`UNKNOWN id ${r.id} in batch ${b}`); continue; }
  if (!a) { console.log(`MISSING main label for ${r.id}`); continue; } n++;
  const ex = new Set(q.exclude);
  for (const [who, l] of [["main", a], ["reviewer", r]] as const) for (const x of [...l.needed, ...l.useful, ...l.sameSession]) if (ex.has(x)) console.log(`INVALID ${r.id} ${who} labelled not-yet-written note ${x}`);
  const ra = new Set(rightNotes(q, a)), rb = new Set(rightNotes(q, r));
  if ((ra.size > 0) === (rb.size > 0)) agree++; else console.log(`DISAGREE ${r.id}  main:[${[...ra]}]  reviewer:[${[...rb]}]  reviewer-why: ${r.why}`);
  if (ra.size && rb.size) { both++; const i = [...ra].filter((x) => rb.has(x)).length; overlap += i / new Set([...ra, ...rb]).size;
    if (!i) { noOverlap++; console.log(`NO-OVERLAP ${r.id}  main:[${[...ra]}]  reviewer:[${[...rb]}]`); } } }
console.log(`\n${n} prompts · agree show-or-quiet ${agree}/${n} · both say show ${both} · share ≥1 note ${both - noOverlap}/${both} · mean overlap ${(overlap / (both || 1)).toFixed(2)}`);
