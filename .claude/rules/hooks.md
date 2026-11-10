---
paths:
  - "hooks/**"
  - "tests/*hook*.test.ts"
  - "tests/*nudge*.test.ts"
  - "tests/*capture*.test.ts"
  - "tests/*evidence*.test.ts"
  - "tests/*trigger*.test.ts"
---

# Hooks: capture, recall, nudges

Hooks never import from `dist/`. Every hook script `init` wires must import `hooks/regex-engine.mjs` FIRST. Platform hook entrypoints stay separate per host; Cursor/Codex/Claude share the protocol-neutral detector core — only input adaptation, the transcript walk, and the output envelope differ. Note-shape rules: `.claude/rules/notebook.md`. Full capture incident history: the notebook flow note `how-notebook-capture-fires-v5-trigger-timed`.

## Capture (`hooks/kb-elicit.mjs`, Stop/SubagentStop; v5 TRIGGER-TIMED)

- **Evidence** — per-file records in `hooks/evidence.mjs` (edit/read/gs tiers, mentions never count, `.coldstartignore` filtered at the root via `hooks/ignore.mjs`).
- **Reading through the SHELL is reading** — `cat`/`head`/`sed -n`/`jq` by verb, plus inline scripts in ANY language (`node -e`, `python3 -c`, `php -r`, heredocs) matched on the file-open call in their body, since the source is in the command string. A script FILE stays a mention — its body is invisible, and a guess is a mention. Inline scripts are classified BEFORE the segment split, whose `;`/`|` are the script's own syntax.
- **INTENT and ATTRIBUTION are separate:** `bashContentRead` (exported for the nudge handlers) asks only whether content was surfaced, while the tiers attribute a read solely to the path named INSIDE the read call — measured on 2961 local transcripts, 50.6% of inline reads carry unrelated path tokens, and 58% name no literal path at all. Output VOLUME is deliberately NOT a criterion: `cat`'s median is 18 lines vs an inline script's 10, so the distributions do not separate.
- **Trigger** — `hooks/trigger.mjs`: score=reads+2×settled-edits+active-stops, fresh-noted=0; arm@10, fire on descent (1 quiet stop) or cap→non-blocking pending file, .git-HEAD drift→blocking; NO first-stop/time/classification.
- **Payload** — `hooks/capture-payload.mjs` v5 checklist (worklist-is-scope, product-level flow gate, graph-blind-spot usage rule via `coldstart consumers`), written DURABLY to `.coldstart/notebook/.worklist-<sid>-<aid>.{md,json}` (gitignored; contract twin `src/kb/durable-worklist.ts`; keyed per agent stream so main + subagents never clobber) so the agent can re-Read the whole checklist + contract after compaction, not just the one-shot delivery. SubagentStop stays one-shot blocking, derives `<transcript-stem>/subagents/agent-<aid>.jsonl`.

## On-demand capture (`/capture-notes`)

- `kb-elicit.mjs --manual --session <sid> --root <dir>` fires the SAME worklist+checklist bypassing only the trigger gate. ALL THREE HOSTS run this one shared script (never a host-specific elicit script), so they all write/read the SAME `coldstart-kb-<sid>-<aid>.json` tmp marker (a host-prefixed marker would make that host's automatic evidence invisible to its manual capture; see `hooks/cursor-kb-elicit.mjs`/`hooks/codex-kb-elicit.mjs`).
- It is SCOPED to the invoking session, NOT self-discovered: Claude substitutes `${CLAUDE_SESSION_ID}` into the command markdown, which its `!` expansion runs directly. Cursor/Codex have no equivalent command-surface expansion, so `hooks/capture-sentinel.mjs`'s `CAPTURE_SENTINEL` is embedded in their command body instead — `cursor-kb-recall.mjs`/`codex-kb-recall.mjs` (which DO receive a real session id on every prompt) detect it in the submitted prompt and run `--manual --session <real sid>` themselves, injecting the result via the same `additional_context`/pending-capture channel as automatic delivery; the command body's "run this in the terminal" instruction is kept only as the fallback wording for when that hook is disabled or fails.
- `soleMarkerUnderRoot` is that fallback path's own guard: no `--session` → falls back to the ONE main-agent marker under `--root` when exactly one exists, and refuses when 2+ markers make it ambiguous — never guessing among several. READ-ONLY on the marker, so it cannot perturb automatic firing.
- A captured read-only file whose durable worklist artifact (`.worklist-<sid>-<aid>.json`) is missing — hand-deleted, or a failed write — is re-included by manual capture even though `captured=true`, since there is no other live copy of that checklist anywhere; automatic firing does not self-heal this on its own.
- `init` writes `.claude/commands/capture-notes.md` (Claude, `!`-expanded so the checklist lands in the prompt), `.cursor/commands/capture-notes.md` (Cursor, plain prompt template carrying `CAPTURE_SENTINEL`), and `.agents/skills/capture-notes/SKILL.md` (Codex: its custom prompts are global `~/.codex/prompts` AND deprecated, so skills — repo-scoped, `name`/`description` frontmatter required — are the supported surface, also carrying `CAPTURE_SENTINEL`).

## Recall (`hooks/kb-recall.mjs`, UserPromptSubmit)

Delivers any pending capture payload FIRST, then `kb search --hook` = BM25 over title + prose (aliases NOT read): when the top note beats the runner-up by ≥ 1 BM25 point (notebooks ≥ 30 notes; younger ones always show) → up to 3 notes as title+gist for the agent to pick from, else silence. Wired by `coldstart init` for Claude Code, Codex, and Cursor (the `kb init` alias re-wires just the notebook). Prompt hygiene shared by all three recall hooks: `hooks/recall-query.mjs`.

**Dedup** (`hooks/recall-seen.mjs`, shared by all three): a session is never re-shown a note it was already shown, or one it WROTE (`kb write --session` events in `.metrics/capture.jsonl`), until a compaction. The ONLY reset is the host's compaction hook, `hooks/recall-compact.mjs` (Claude `PreCompact`, Codex `PostCompact` — its PreCompact defers compaction on non-zero exit — Cursor `preCompact`, the only one it has). Never key it on the transcript: Claude transcripts are append-only (a compact appends a `compact_boundary` line), so the old shrink check never fired in 61 real compactions. Verified against a real `claude -p … /compact`.

## Co-change nudge (`hooks/cochange-nudge.mjs`)

The co-change signal delivered WITHOUT being asked for: detector (7) in the PostToolUse nudge, fired on the EDIT event — an edit TOOL (Edit/Write/MultiEdit/NotebookEdit + Cursor's `SearchReplace`) **or a shell command that writes a file** (`bashEditTargets` in `hooks/evidence.mjs`: `>`/`>>`, `tee`, `sed -i`, or a write call naming a literal path) — because agents do not reliably run `gs` before editing, and an agent told to edit with sed/heredocs/scripts never touches an edit tool at all, so a tool-name gate goes silent for exactly the agent that needs this most. A write to a COMPUTED path claims nothing (a variable holding a literal, `p='x.json'` then `open(p,'w')`, is NOT computed: `inlineCalls` in `hooks/evidence.mjs` resolves it one hop to the last literal assignment and tiers each open call on its own, #176): the deterministic rules cover 89.2% of real shell writes and inferring the rest from "the one source path in the script" added 5.8% while making it possible to name a file the script only read — measured, rejected.

Three rules: the edit list clears on every new user message (`resetEditTrack`, called from the three UserPromptSubmit recall hooks) — **that is the ONLY clearing signal, elapsed time is the wrong shape for a task boundary** (an auto-mode run edits for hours with no prompt, and a session id survives a resume days later; the 7-day sweep is garbage collection, never a boundary); nothing fires until a 2nd DISTINCT file is edited (trivial one-file jobs); then it fires for any file not already edited and not already named. Gate is LOOSE (ratio ≥ 0.3 of the seed's own commits, shared ≥ 2, top 5, tests excluded both sides) because "what am I forgetting" is a RECALL question — the opposite of the precision-tuned cut `gs` renders.

Needs NO `init` wiring: PostToolUse is already registered on all three hosts with a match-everything matcher, and Cursor delegates to the Codex handler. Its state is a SEPARATE tmp file from the find-nudge state, which the search detectors and the preguard's deny-key depend on. Reads `cochange.json` directly, MIRRORING `getCacheDir`/`cacheKey` (hooks never import from `dist/`) — `tests/cochange-nudge.test.ts` pins the two together.
