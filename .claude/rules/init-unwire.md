---
paths:
  - "src/init.ts"
  - "src/unwire.ts"
  - "tests/init*.test.ts"
  - "templates/**"
---

# `init` and `unwire`

**Setup:** `coldstart init` asks two things — **experience** (`cli`/`mcp`, also via `--experience`) and **client** (`claude`/`cursor`/`codex`/`other`, also via `--client`; never auto-detected) — then writes the agent guidance (CLI- or MCP-flavored) — as `coldstart.md` for Claude Code and Other, inlined into the client's own rules file for Cursor and Codex (neither resolves `@file` refs) — and wires the chosen client (`src/init.ts`).
- **Claude Code:** `coldstart.md` + `@coldstart.md` into CLAUDE.md + Claude-specific navigation and notebook hooks in `.claude/settings.json` (mcp experience also writes `.mcp.json`).
- **Codex:** the full guidance inlined in a marked block in AGENTS.md (no separate coldstart.md) + separate Codex navigation and notebook hooks in `.codex/hooks.json`; its capture hook parses Codex rollout/subagent transcripts (mcp experience also writes `[mcp_servers.coldstart]` into `.codex/config.toml`).
- **Cursor:** `.cursor/rules/coldstart.mdc` carrying the full guidance inline (Cursor doesn't resolve `@file` refs in rules) + Cursor navigation and notebook hooks in `.cursor/hooks.json` (`preToolUse` dedup-deny, `postToolUse` nudge, `beforeSubmitPrompt` recall, `stop`/`subagentStop` capture; the capture hook parses Cursor's own conversation JSONL scoped to the current turn via `turn_ended`; recall rides `beforeSubmitPrompt.additional_context`, which Cursor honors despite its docs; capture is loop-guarded on `loop_count===0` since `followup_message` re-fires `stop`) + (mcp) `.cursor/mcp.json`.
- **Other:** coldstart.md + printed wiring directions.

All writers merge idempotently and point hooks/MCP at the running install (`installRoot()` in `src/init.ts`, derived from the module path — no `~/.coldstart/versions/` copy), so `npm update` is picked up automatically (`npm uninstall` makes the wired hooks no-op but leaves the entries/files behind; any running keepers self-reap within ~30 s once their binary is gone — see `watchOwnBinary`). User commands (`USER_COMMANDS`: `/capture-notes`, `/repair-notes`) are wired for all three hosts via `wireClaudeCommand`/`wireCursorCommand`/`wireCodexSkill`; retired commands are deleted with `removeRetiredCommand`.

**Unwire (`coldstart unwire`, `src/unwire.ts`):** the explicit reverse of `init` (npm fires no reliable pre/postuninstall, and a global uninstall has no registry of inited repos). Reuses `init`'s own idempotency detectors (`isColdstartHookEntry`/`isKbHookEntry`/`isCodexHookEntry`/`isCursorHookEntry`/`stripCodexColdstartTable`, exported from `src/init.ts`), so removal is symmetric with how `init` writes — strips only coldstart-owned markers (hook entries, `@coldstart.md` import, `AGENTS.md` block, `[mcp_servers.coldstart]` table, fully-owned files `coldstart.md` / `.cursor/rules/coldstart.mdc`), never user content in shared files. Sweeps all four clients unconditionally (init records none), prunes emptied arrays/dirs. Notebook KEPT by default (committed user data); `--purge` also deletes `.coldstart/notebook/` + its git plumbing. Idempotent (second run = all-absent, exit 0).
