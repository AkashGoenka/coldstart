/**
 * capture-payload.mjs — the capture prompt (v5, finalized 2026-07-17).
 *
 * Replaces the 370-line v4 elicit prompt. Structure: purpose → decide gate →
 * worklist → per-note rules → flows → write. Decide-time rules ONLY — the spec
 * shapes are rendered inline (zero-bounce path) from hooks/note-shape.mjs, the
 * single table every kb surface derives from; the prose around them lives here.
 * The arming mechanism is invisible to the agent: only its consequences show
 * (which files, their ranking, their annotations).
 *
 * Envelopes:
 *   inject   — delivered on the NEXT user prompt (UserPromptSubmit channel):
 *              handle capture, then the user's request.
 *   block    — Stop-block (HEAD-drift / cap backlog only): handle, then stop.
 *   subagent — SubagentStop block: handle, then RESTATE the deliverable last
 *              (the coordinator only sees the final message — #61).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
// The spec shapes are NOT written here any more. They come from the one table
// the write guide, the MCP tool description and `kb repair` also render from —
// the inlined copy is how "aliases" fell out of the flow shape unnoticed.
import { shapesBlock } from "./note-shape.mjs";

/**
 * Durable capture worklist — the checklist the agent can re-Read at any point.
 *
 * The old design dropped the worklist in tmpdir (keyed by session id) and let
 * `kb write --session` print a running "N of M". Two failures: the manifest was
 * scratch that no agent ever read directly, and the whole capture PAYLOAD (this
 * checklist + the write contract) was delivered one-shot and lost to compaction
 * — the agent had to re-derive the note shape from memory 80 tool-calls later.
 *
 * So the pair now lives in the repo notebook, keyed by root, and holds BOTH:
 *   .worklist.json  structured scope (the coverage source of truth)
 *   .worklist.md    the full rendered payload — worklist + write contract
 * The agent re-Reads the .md whenever this scrolls away; `kb write` credits and
 * trims/clears the pair (src/kb/durable-worklist.ts) so a stale snapshot never
 * lingers, and the next capture fire regenerates it against live freshness.
 *
 * CONTRACT TWIN: src/kb/durable-worklist.ts — keep the paths and the .json shape
 * (ts, sid, files:[{path,tier,needsNote}], wrote:[]) in step. Both gitignored
 * (src/kb/store.ts initSkeleton). One active worklist per repo (concurrent
 * sessions last-write-wins, an accepted edge). Best-effort: capture must never
 * fail because these could not be written.
 */
export function worklistJsonPath(root) {
  return join(root, ".coldstart", "notebook", ".worklist.json");
}
export function worklistMdPath(root) {
  return join(root, ".coldstart", "notebook", ".worklist.md");
}

function writeDurableWorklist(root, sid, entries, mdBody) {
  if (!root || !entries?.length) return;
  try {
    // needsNote: no note yet, or the note it has is stale. A file whose note is
    // already fresh is NOT an outstanding item — counting it would make full
    // coverage unreachable and the ratio meaningless.
    const files = entries.map((e) => ({
      path: e.path,
      tier: e.tier,
      needsNote: !e.notes?.length || e.notes.some((n) => n.state === "changed" || n.state === "missing"),
    }));
    mkdirSync(join(root, ".coldstart", "notebook"), { recursive: true });
    writeFileSync(worklistJsonPath(root), JSON.stringify({ ts: Date.now(), sid, files, wrote: [] }));
    writeFileSync(worklistMdPath(root), mdBody);
  } catch { /* best-effort */ }
}

/**
 * SPIKE (experimental, undocumented): a repo can replace the shipped checklist
 * with its own `.coldstart/checklist.md`. Placeholders {{WORKLIST}}, {{CLI}},
 * {{ROOT}}, {{SID}} are substituted. The worklist is LOAD-BEARING (it is the
 * scope rule) — an override that omits {{WORKLIST}} gets it appended anyway.
 * Trigger mechanics stay in code; only the prompt text is overridable. Merge
 * semantics when the shipped default evolves = none (the override wins
 * wholesale) — revisit before promoting past spike.
 */
function loadChecklistOverride(root) {
  try {
    const text = readFileSync(join(root, ".coldstart", "checklist.md"), "utf8");
    return text.trim() ? text : null;
  } catch { return null; }
}

/**
 * worklist entry: { path, tier, retouches, notes: [{id, type, state}], noConsumers }
 *   tier: "edited ×N" | "read" | "skimmed"
 */
function worklistLines(entries) {
  const lines = [];
  for (const e of entries) {
    const ann = [];
    ann.push(`[${e.tier}]`);
    if (!e.notes?.length) {
      ann.push("no note yet");
    } else {
      for (const n of e.notes) {
        if (n.state === "fresh") {
          ann.push(`note ${n.id} (fresh) → update ONLY if this session taught something the note lacks (.coldstart/notebook/notes/${n.id}.md)`);
        } else if (n.state === "changed" || n.state === "missing") {
          ann.push(`note ${n.id} (STALE) → fix or re-stamp; list the path in "verified" (.coldstart/notebook/notes/${n.id}.md)`);
        } else {
          ann.push(`note ${n.id} → read it first, update by its "id" (.coldstart/notebook/notes/${n.id}.md)`);
        }
      }
    }
    if (e.noConsumers) ann.push("no consumers in import graph");
    lines.push(`- ${e.path}   ${ann.join(" · ")}`);
  }
  return lines.join("\n");
}

export function buildCapturePayload(args) {
  const payload = renderCapturePayload(args);
  // Persist the WHOLE payload durably so the agent can re-Read it later, and the
  // structured scope for `kb write` coverage. Best-effort; never blocks capture.
  writeDurableWorklist(args.root, args.sid, args.entries, payload);
  return payload;
}

function renderCapturePayload({ root, cli, sid, entries, envelope }) {
  const opening = envelope === "block"
    ? "Handle capture now, then stop."
    : envelope === "manual"
    ? "You invoked this capture yourself (/capture-notes) — handle it now, then carry on."
    : "Handle capture first, then continue with the user's request.";

  const tail = envelope === "subagent"
    ? `\nOnce you have handled the notebook — whether you wrote notes or decided none were \
needed — remember you were spawned as a subagent. The coordinator that spawned you receives \
ONLY your final message, so your last message must repeat, in full, the result you produced \
for it — your findings, not the notebook decision.`
    : "";

  const override = loadChecklistOverride(root);
  if (override) {
    const worklist = worklistLines(entries);
    let body = override
      .replaceAll("{{CLI}}", String(cli))
      .replaceAll("{{ROOT}}", String(root))
      .replaceAll("{{SID}}", String(sid));
    body = body.includes("{{WORKLIST}}")
      ? body.replaceAll("{{WORKLIST}}", worklist)
      : `${body.trimEnd()}\n\nWORKLIST — files you actually read this session, most-worked first \
(your scope; if you edited or deep-read a file that isn't listed, you can note it too):\n\n${worklist}`;
    return `**Notebook capture point.** ${opening}\n\n${body.trimEnd()}${tail}`;
  }

  return `**Notebook capture point.** You have completed work and gathered knowledge as part \
of it — knowledge a future agent could use. This repo keeps that knowledge in a notebook: \
notes are searched and served to future cold agents when their task matches. ${opening}

DECIDE FIRST — as the agent who worked on this task, you know its exact intent:
1. So you, not any rule, are best suited to judge whether this work was about the code in \
the PRESENT. Notes are backed by present code only: if the task was investigating an older \
branch, reviewing a PR, or reading vendored/generated code, that knowledge is about the past \
or the future — write nothing and say so.
2. If nothing about the current code is worth recording, no note is the right answer. If a \
future agent would not act differently for knowing it, don't store it.
3. The worklist below is your scope, most-worked first. Unlisted files are out — ignored \
(.coldstartignore) or already captured. If you edited or deep-read a file this session that \
isn't listed, you can write a note for it too.
3a. Rules 1 and 2 are for files you barely touched — they are not licence to write one note \
and stop. Every file marked [edited] is a file you changed with intent: you know why it \
changed and what you had to understand to change it, and that is precisely the knowledge a \
cold agent lacks. The default for an edited file is a note. Walk the worklist top to bottom \
and decide each one explicitly; do not stop at the first two or three. If you end up writing \
notes for well under half the [edited] files, you have under-captured — say which files you \
skipped and why, so the decision is visible instead of silent. This whole checklist (worklist \
+ the write contract below) is saved at \`.coldstart/notebook/.worklist.md\` — re-Read that file \
any time this session if this scrolls out of context. Your \`kb write\` call ends with a coverage \
line naming any worked file still without a note; read it back before you finish.

WORKLIST — files you actually read this session, most-worked first:

${worklistLines(entries)}

FOR EACH NOTE:
4. Say only what you verified in THIS file, this session. A confident whole-file claim from \
a partial read is the #1 bad note.
5. One note per file, ever. Existing note → read it, update by its "id".
6. How a file is USED: the code graph already shows imports and callers — never restate \
them. But wiring the graph cannot see (string registry, template reference, DI container, \
naming convention) is exactly what to record — ONLY if you actually observed it in this \
session's work. Never guess at usage or go searching for it now. Files flagged "no consumers \
in import graph" are where an observed usage fact matters most.
7. Fixed a bug? The cause goes in the culpable file's note; the SYMPTOM words go in \
"incidentAliases" — symptoms are what a future agent will search FOR THIS BUG. incidentAliases \
are REPLACED, not unioned, the next time this note's summary is rewritten — describe only the \
symptom in front of you, don't carry old ones forward, and don't worry about them piling up. \
Stable words that don't change across writes — the file's name, role, the concept nouns \
someone would type for it regardless of which bug brought them here — go in "identityAliases" \
instead; those DO accumulate across writes, so only add ones not already there. Aliases of \
either kind are SEARCH KEYS, not sentences: each one 2-5 words, no filler ("after", "already", \
"another", "still"), because every word is an independent match chance and a long alias makes \
the note fire on prompts it has nothing to do with. 6-10 aliases total (both fields combined) \
is plenty; more surface area is not more recall.
8. Read a note this session that proved wrong? Correct or retract it now — you are the warm \
agent; there is no "next". This includes "identityAliases": if one describes something that's \
no longer true (a renamed role, a dropped responsibility), retract it — identityAliases union \
forever and nothing else will clean it up. (incidentAliases don't need this — they're replaced \
automatically whenever you rewrite the summary, rule 7.)
9. Firsthand only: nothing from a subagent's report you didn't verify yourself.
10. "verified" lists only files you opened this session. Never one you didn't.
11. Never copy secret VALUES (env contents, tokens, keys) into a note — notes are committed \
to git.

FLOWS — the product-level layer. A flow note records knowledge no single file owns: how the \
system behaves as a whole. The test, for every candidate: is this about how the CODEBASE \
works, or about how one file works? File-level → it belongs in that file's note. \
Product-level → flow.
Examples that qualify:
- how authentication works end-to-end
- how UI components get rendered under different conditions
- how a file is consumed along a path when its imports don't reveal it and the gotcha spans \
the path (a single non-obvious consumer is NOT a flow — it goes in that file's own note, rule 6)
The summary's FIRST sentence states the product-level fact — the thing a reader of all the \
file notes would still be missing. If you cannot write that sentence, there is no flow.
Steps are the minimal chain, each with its role. kb write WARNS when fewer than two steps \
are files you read this session — a flow assembled from grep hits is the classic bad flow; \
take that warning seriously.
Never a flow: a feature's parts-list, a relationship the import graph already shows, a \
mechanism living in one file.
kb search first. UPDATE an existing flow only when your missing-fact sentence is THE SAME \
fact it already leads with — new detail about a mechanism it already tells. A DIFFERENT \
missing fact is a NEW flow, even in the same subsystem, even across the same files. Folding \
an unrelated fact into a nearby flow buries it: nobody searching for your fact will find that \
title.

WRITE — ONE call: put EVERY note as an object in a JSON array and write the array \
in a single \`kb write\`. Order flows before the file notes that reference them. Malformed \
notes are reported together (a bad note never silences a good one), and the call ends with \
the coverage line. Forming an array is fewer tokens than chaining, not more — same JSON, \
without the per-note heredoc and && glue.
${shapesBlock({ compact: true })}
  "identityAliases" and "symbols" are what make a note FINDABLE and both go missing by \
default: a note without identityAliases is reachable only by its exact title, and agents \
search this notebook by identifier far more than by prose — those queries match \
the anchor channel, which holds nothing but the path until you name symbols. \
kb write prints exactly what is missing and the one-line re-put that fixes it; \
do that in the same block rather than leaving it.
  On a flow, "verified" is what FILES the note — its anchors come from "verified" \
(plus any explicit "anchors"), NOT from its steps. A step file left out of \
"verified" is invisible to \`kb lookup\` on that file and is never freshness-stamped, \
however carefully you described it. Never write a flow using the file-note shape \
(title + summary) from memory.
  file-single is the DEFAULT. A file with one purpose gets one summary even if you worked \
with several of its symbols. file-hub is ONLY for grab-bag files that have no single purpose \
(models.py, utils, helpers) — there, knowledge lives per symbol. Touching many symbols does \
not make a file a hub; having no one purpose does.
  Update = the same spec plus "id":"<id from the worklist>". Retract a note you \
found wrong: {"op":"retract","id":"<id>","target":{"kind":"note"}} (as one array element).
  cat > /tmp/notes.json <<'JSON'
  [ {…note 1…}, {…note 2…} ]
JSON
  node ${cli} kb write /tmp/notes.json --root ${root} --session ${sid} --force
  Full shapes: run \`node ${cli} kb write --root ${root}\` with no spec — it prints the guide.

FLOW DECISION — record what you decided about FLOWS (created a new one, folded into an \
existing one, or none) so the flow gate can be measured. Ride it on the SAME batch write — it \
is a flag, not a second command:
  node ${cli} kb write /tmp/notes.json --root ${root} --session ${sid} --force \\
    --decision <none|new|update> [--id <flow id>] --why "<one clause>"
Only when you wrote NO notes at all is there no write to carry it, and then run it alone:
  node ${cli} kb flow-decision --decision none --why "<one clause>" --root ${root} --session ${sid}${tail}`;
}
