/**
 * capture-payload.mjs — the capture prompt (v5, finalized 2026-07-17).
 *
 * Replaces the 370-line v4 elicit prompt. Structure: purpose → decide gate →
 * worklist → per-note rules → flows → write. Decide-time rules ONLY — spec
 * shapes for the common file notes stay inline (zero-bounce path; file notes
 * are ~97% of volume), flow/lesson formats live behind `kb write` (no spec →
 * prints the guide). The arming mechanism is invisible to the agent: only its
 * consequences show (which files, their ranking, their annotations).
 *
 * Envelopes:
 *   inject   — delivered on the NEXT user prompt (UserPromptSubmit channel):
 *              handle capture, then the user's request.
 *   block    — Stop-block (HEAD-drift / cap backlog only): handle, then stop.
 *   subagent — SubagentStop block: handle, then RESTATE the deliverable last
 *              (the coordinator only sees the final message — #61).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

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

export function buildCapturePayload({ root, cli, sid, entries, envelope }) {
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
(the complete scope; never write a note for an unlisted file):\n\n${worklist}`;
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
3. The worklist below is the complete scope. Unlisted files are out — ignored \
(.coldstartignore) or already captured. Never write a note for an unlisted file.

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
"aliases" — symptoms are what a future agent will search.
8. Read a note this session that proved wrong? Correct or retract it now — you are the warm \
agent; there is no "next".
9. Firsthand only: nothing from a subagent's report you didn't verify yourself.
10. "verified" lists only files you opened this session. Never one you didn't.
11. Never copy secret VALUES (env contents, tokens, keys) into a note — notes are committed \
to git.

FLOWS — rare. While investigating you will see flows everywhere: every file connects to \
something, every feature has a chain. Those connections are not flow notes — at that rate, \
everything would be a flow.
A flow note records PRODUCT-level knowledge: how the system behaves as a whole, knowledge no \
single file owns. The test, for every candidate: is this about how the CODEBASE works, or \
about how one file works? File-level → it belongs in that file's note. Product-level → flow.
Examples that can qualify:
- how authentication works end-to-end
- how UI components get rendered under different conditions
- how a file is consumed along a path when its imports don't reveal it and the gotcha spans \
the path (a single non-obvious consumer is NOT a flow — it goes in that file's own note, rule 6)
The summary's FIRST sentence states the product-level fact — the thing a reader of all the \
file notes would still be missing.
Steps are the minimal chain, each with its role. kb write WARNS when fewer than two steps \
are files you read this session — a flow assembled from grep hits is the classic bad flow; \
take that warning seriously.
Never a flow: a feature's parts-list, a relationship the import graph already shows, a \
mechanism living in one file.
kb search first — update the existing flow, never a near-duplicate.

WRITE — one Bash block total: specs as heredocs, writes chained with &&.
  {"type":"file-single","path":"src/x.py","summary":"1-3 sentences","aliases":["symptom words"]}
  {"type":"file-hub","path":"src/y.py","facets":[{"symbol":"Fn","detail":"the non-obvious thing"}]}
  file-single is the DEFAULT. A file with one purpose gets one summary even if you worked \
with several of its symbols. file-hub is ONLY for grab-bag files that have no single purpose \
(models.py, utils, helpers) — there, knowledge lives per symbol. Touching many symbols does \
not make a file a hub; having no one purpose does.
  Update = the same spec plus "id":"<id from the worklist>".
  node ${cli} kb write /tmp/spec1.json --root ${root} --session ${sid} --force
  Flow/lesson shapes: run \`node ${cli} kb write --root ${root}\` with no spec — it prints the full guide.${tail}`;
}
