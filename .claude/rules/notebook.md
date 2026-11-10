---
paths:
  - "src/kb/**"
  - "hooks/note-shape.mjs"
  - "hooks/kb-*.mjs"
  - "hooks/*-kb-*.mjs"
  - "hooks/capture-*.mjs"
  - "src/server/mcp.ts"
  - "tests/kb-*.test.ts"
---

# Notebook (`src/kb/`)

Contract: `docs/notebook-kb-design.md` (local only). Capture-hook rules: `.claude/rules/hooks.md`.

**Commands.** `coldstart kb search|lookup|write|commit|status|lint|repair|render|view|init|migrate`. `view` = single-file self-contained HTML browser of the notebook, generate-and-open, freshness stamped at generation time; `src/kb/view.ts` + `view-template.ts`, human-only — never an MCP tool; its note graph draws hand-typed `[[wikilinks]]` **plus** derived shared-anchor links — `linkByAnchor`, capped at 8/note — because agents write almost no wikilinks and the graph was 9 nodes out of 101 notes without them. The read/write surface is ALSO exposed as MCP tools with identical output — `kb_search`/`kb_lookup`/`kb_write`/`kb_status`/`kb_repair` in `src/server/mcp.ts` (the MCP server is a *writer* for `kb_write`) — for no-shell clients; `kb commit` is CLI/human-only, never an MCP tool.

**The note shape is FROZEN in ONE table, `hooks/note-shape.mjs`** (it lives in `hooks/` because the capture hooks never import from `dist/`; the TS side reaches into `hooks/`, as `lint.ts` already does with `ignore.mjs`). Every surface renders from it — the `kb write` guide, the capture prompt's inline shapes, the MCP `kb_write` description, `missingFieldsWarning` at write time, and `kb repair`'s detection — because three hand-kept copies is exactly how `aliases` fell out of the flow shape and why the MCP description never mentioned it at all. Adding a requirement = appending one `NOTE_CHECKS` entry (two predicates: `missingInSpec` on the JSON just written, `missingInNote` on the folded note); `tests/kb-shape-parity.test.ts` fails if a consumer stops deriving. Never delete a shipped `check` id — `kb repair --json` consumers filter by it; retire one by making its predicate always false.

**Notes carry no search aliases** (retired with the BM25 search core): the shape, capture prompt and MCP description never ask for them, the fold drops `aliases`/`identityAliases`/`incidentAliases`/`aliasesVerified` keys still sitting in older `.raw` records (history is never rewritten), and `missing-aliases`/`missing-identity-aliases` are retired checks. `init` deletes the old `/repair-aliases` command files (`removeRetiredCommand`) and `unwire` still strips them.

**A flow's anchors come from `verified` (+ explicit `anchors`), NOT from its `steps`** (`src/kb/raw-log.ts` stamps verified paths; `fold.ts` keeps steps as a separate whole-array LWW story) — a step path left out of `verified` is invisible to `kb lookup` and never freshness-stamped, which is what `flow-steps-unanchored` catches.

**`kb repair` (`src/kb/repair.ts`) SURFACES, never fixes:** detection runs inside the command, no cap (all notes at once), clean → `Nothing to repair here.` and no agent prompt; fixing is agent work through the ordinary `kb write`/`kb_write` update path, because every gap needs a judgement about the code (an earlier mechanical filler proposed anchoring notes to `root`/`out`/`opts`). Surfaced as `/repair-notes`, wired by `init` for all three hosts alongside `/capture-notes` (`USER_COMMANDS` + `wireClaudeCommand`/`wireCursorCommand`/`wireCodexSkill`) and stripped by `unwire`.

**Storage.** `.coldstart/notebook/` holds per-note append-only `.raw/<id>.jsonl` logs (source of truth, committed; a note = pure fold of its log) + derived md notes. kb readers NEVER load the code index — the keeper derives a `kb-notes.json` sidecar (anchor freshness stamps) single-flight at watch start / `.raw` batches / post-save. Two-phase `kb write` (exit 3 = candidates → `--into <id>` or `--new`). `kb commit` is the one sanctioned git path (pathspec-commits only `.raw/` + skeleton — notes never ride in feature commits).

**Batch write is the capture path** (`src/kb/write-batch.ts`, shared by CLI `kb write <array.json>` + MCP `kb_write` `specs`): the agent authors ALL notes as one JSON array written in ONE call — malformed notes are reported together (write-valid/report-invalid, never atomic), and the single call boundary is where coverage is finalized once and the keeper coalesces to one index refresh. A single object stays a batch of one. `op:"retract"` infers `type` from the target note (and skips the file-note `path` demand), so the documented `{"op":"retract","id","target":{"kind":"note"}}` form works without restating type/path.

**The durable worklist is keyed by `<sid>-<aid>` (the tmpdir marker identity), NOT by root or sid alone** — a subagent shares its parent's session id, so a sid-only key would let a subagent's capture clobber the main agent's list and its `kb write` clear the main agent's coverage. `kb write --session <sid> --agent <aid>` (both printed in the capture payload; `--session` stays the bare sid so `flowEvidenceCount`'s cross-agent marker union is unaffected) finalizes against `.worklist-<sid>-<aid>.json`, aid defaulting to `main`; `finalizeBatchCoverage` with no sid touches NO worklist (returns null — a session-less write is outside capture, so guessing "the freshest" and clearing/downgrading another agent's checklist is wrong). Stale sibling worklists (json `ts` > 3 days) are pruned on each fire. Contract twin of the hook side: `src/kb/durable-worklist.ts` reads/trims/clears.

**Concurrency-safe multi-session writes:** freshly-coined ids created O_EXCL (coin race → EEXIST → re-coin; never a silent merge), the fold UNIONS anchor symbols, derived md is temp+rename atomic, `kb write -` reads stdin as a stream (regressions: `tests/kb-store-atomic.test.ts`, `tests/kb-concurrent-create.test.ts`).
