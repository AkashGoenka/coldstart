# 2.0 test plan

What must be green before 2.0.0 ships. Three layers: the automated suite, the daemon-lifecycle E2E, and a live **write / edit / search** workflow E2E — the three things agents actually do in a codebase, exercised against a real keeper.

## 1. Automated (every change)

- `npm test` — full vitest suite (435 at plan time), including the freshness suite (`tests/freshness-b3b7.test.ts`), cache round-trip (`tests/disk-cache.test.ts`), hidden-dir patch rules (`tests/patch-hidden-dirs.test.ts`), and the kb suites.
- `npx tsc --noEmit` — clean.

## 2. Daemon-lifecycle E2E (any keeper / watcher / spawn / installer change)

The 8-step checklist on a real mid-size repo (markus fixture): cold start, self-heal after cache delete (exactly ONE rebuild), version-swap takeover, `status` shows stamps + repair tail, idle CPU flat over 35 s, lockfile-delete exit, `restart` clean respawn, log rotation. **Status: PASSED 2026-07-05.** Re-run if anything under `src/{keeper,daemon-lock,index-manager,watcher,restart}.ts` changes again before ship. `npm test` alone has missed every historical regression in this area — the checklist is not optional.

## 3. Write / edit / search workflow E2E (live keeper)

Freshness work is only proven by the workflows it exists for. Scratch git repo, keeper spawned by the first query, generous-but-bounded freshness window (debounce 400 ms + save ~5 s → assert within 10 s). All queries go through the CLI readers (`coldstart find` / `gs`), never `--no-daemon`.

| # | Workflow | Action | Pass condition (within 10 s unless noted) |
|---|---|---|---|
| W1 | write | create `src/newmod.ts` exporting a novel symbol | `find <symbol>` ranks the new file; `gs src/newmod.ts` returns its symbols |
| W2 | edit | rename an exported function in an existing file | `find <newName>` hits; `find <oldName>` no longer names it as a definition; `gs` on an importer reflects it |
| W3 | edit (body only) | add a rare token inside a function body, exports unchanged | `find <token>` surfaces the file via the reference/grep pass |
| W4 | delete | delete an imported file | `find` has no ghost entry; `gs` on the ex-importer drops the edge |
| W5 | rename file | `git mv a.ts b.ts` | old path gone, new path indexed, importers re-resolved |
| W6 | bulk edit | touch > patch-threshold files (script) | keeper takes the rebuild path (log); queries during the rebuild answer from the old snapshot; no reader ever builds |
| W7 | branch switch (keeper alive) | checkout a branch differing by a few dozen files | keeper log shows a **patch**, not a rebuild; `find` reflects the new branch |
| W8 | offline drift (keeper dead) | kill keeper; create + edit + delete files; query | reader waits for respawned keeper's **reconcile**; all three changes reflected; `status` shows the reconcile stamp |
| W9 | search-during-write | run `find` in a loop while a script writes files | every response is internally consistent (no crash, no mixed-generation artifacts, no empty index) |
| W10 | hidden writes | write `.coldstart/notebook/notes/x.ts` and `.claude/y.ts` | neither ever appears in `find`; file count unchanged |

Record per step: observed latency from write → visible in `find`, and the keeper-log line proving which path (patch / rebuild / reconcile) ran.

**Executed 2026-07-05 — 10/10 PASS** on a 45-file scratch repo (write→visible latencies 5.5–6.2 s, inside the debounce+save window; W7 patched both switch directions; W9 12/12 consistent responses under concurrent writes). Findings:

- **W4 caught a real bug, fixed in this release:** deleting a file that other files call left symbolEdges dangling into it; the invariant lint correctly caught it and auto-rebuilt (self-heal worked), but that made every delete-of-a-referenced-file cost a full rebuild. `patchIndex` now prunes symbolEdges pointing into a deleted file. Regression test: `tests/patch-delete-symbol-edges.test.ts`; re-verified live (no violation, gs edge dropped via patch).
- **Known tiny-repo artifact (not a bug):** in a repo under ~20 files, a term hitting 1 file exceeds `RARE_FRAC` (5%), so a unique body-token query can render zero matches with the "no discriminating term" warning. Disappears at real repo sizes.
- **Known race (accepted design):** a reader arriving within ~1–2 s of keeper spawn can serve the pre-drift cache once when the drift is *uncommitted* (no git-HEAD signal to wait on). The reconcile save lands seconds later; committed drift (HEAD moved) does make readers wait.

## 4. Notebook (kb)

- Automated suites green (search/write/fold/ids/render/freshness/watcher/notes-index).
- SubagentStop capture: replay-verified on the real lost phase-2 instance (live FAST-EXIT 0 → fixed ELICIT deepReads=8). **Done 2026-07-05.**
- **Drift test (user-run, still open):** edit a note's anchor file, confirm the recall hook serves it flagged `[evidence changed]` and a live session corrects it via `kb write`. Needs real agent sessions — run alongside the next benchmark window.

## 5. Ship gates (before `npm publish 2.0.0`)

- Privacy grep over the full diff/staged content (no private repo names or paths).
- Fresh `npm pack` + install into a clean prefix; `coldstart init` + first `find` on a scratch repo works with the published file set.
- Old-keeper swap: a 1.x keeper is replaced on first 2.0 lookup (lockfile version check).
- `npm deprecate coldstart-mcp` after publish.
