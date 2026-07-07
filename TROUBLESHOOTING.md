# Troubleshooting

Almost every coldstart issue is the **keeper** — the background process that keeps the on-disk index fresh — either not running, holding a stale index, or leaving a stale lockfile. The keeper serves nothing, so there's no port, HTTP, or bridge to debug; it just watches and writes the cache that the readers (`find`/`gs`/MCP) read.

State lives in two independent places:

- `~/.coldstart/daemon/` — one set of `<basename>-<hash>.{json,log,log.prev}` per repo root (lockfile + logs).
- `~/.coldstart/indexes/<basename>-<hash>/` — the cache: `meta.json` (commit marker, names the current generation), gzipped `g<N>-…` segments (file table, core chunks, graph, callgraph, build data), `fingerprints.json`, plus two observability files: `keeper-state.json` (last reconcile/patch/rebuild/save) and `repair.jsonl` (failure log).

`<basename>` is your repo's directory name; `<hash>` is the first 16 chars of `sha256(absolute_path)`.

---

## First move for almost anything: `status`, then `restart`

```bash
coldstart status
```

Lists every keeper on the machine — root path, PID, alive/dead, version, **index freshness** (file count + age, from the cache `meta.json` mtime), the keeper's last **reconcile / patch / rebuild / save** stamps, and the tail of the **repair log** if anything has failed. No network probe. This answers both "is my index fresh?" and "why / why not?".

```bash
coldstart restart              # current repo's keeper — respawns on next lookup
coldstart restart --root DIR   # a specific repo's keeper, from anywhere
coldstart restart --all        # every keeper
```

`restart` SIGTERMs (5 s grace, then SIGKILL) and clears the lockfile. The next `coldstart find` (or MCP call) spawns a fresh keeper, which **reconciles on startup** — it stat-checks every indexed file and diffs against the indexed git HEAD, then patches exactly what changed. So a restarted keeper comes back *correct*, not just alive. **This is the right answer for almost any "something feels off" situation.**

To read the keeper log directly:

```bash
tail -f ~/.coldstart/daemon/<basename>-<hash>.log
```

Logs rotate at 1 MB; the previous run is in `.log.prev` (read it after a crash + respawn). For *persistent* failure history use `repair.jsonl` beside the cache — it survives restarts and log rotation, so a keeper that silently rebuilds every hour still shows up.

---

## Index seems out of date

This should essentially not happen anymore — there are three layers catching drift:

1. The **live watcher** patches edits within ~1 s of the debounce settling.
2. **Startup reconcile** catches everything that changed while no keeper was running (branch switches, pulls, edits during downtime).
3. A **fingerprint audit** after each save re-checks a rotating sample of files and re-patches drift from watcher-missed events (rare — some network filesystems, suspend mid-edit).

If it happens anyway: `coldstart restart` (reconcile catches it), and please file an issue with `coldstart status` output and the repair log — a stale index now indicates a real bug, not a missed TTL.

One true blind spot exists by design: an edit that preserves both a file's mtime **and** its byte size is invisible to reconcile's fingerprint check (the live watcher still catches it if the keeper was running).

**To force a full rebuild without restarting**, delete the cache commit marker — the running keeper detects it and rebuilds in place:

```bash
rm ~/.coldstart/indexes/<basename>-<hash>/meta.json
```

---

## First lookup is slow

There's no inline build anymore: readers **wait for the keeper** rather than building themselves. On a fresh repo the first `find` spawns the keeper and waits for its first save (progress to stderr, up to 3 minutes on very large repos). To avoid paying that inside a query:

```bash
coldstart init     # warms the index in the background at setup
coldstart index    # build + save the cache up front, with progress to stderr
```

After either, `find`/`gs` hit a warm cache. `coldstart index` is also the **single-writer prep** step for deterministic builds (e.g. in CI). If a reader reports waiting and no keeper ever produces a cache, check the keeper log — the build itself is failing.

---

## Stale lockfile (keeper died but lock remains)

Symptom: `coldstart status` shows `dead (stale lock)` — the JSON file exists but its PID is gone. Readers detect this and respawn, but to force a clean state:

```bash
coldstart restart
# or by hand:
rm ~/.coldstart/daemon/<basename>-<hash>.json
rm ~/.coldstart/daemon/<basename>-<hash>.spawn   # if present
```

The `.log`/`.log.prev` files stay for postmortem. The next lookup spawns a fresh keeper.

The reverse problem — a keeper that *outlives* its lockfile and keeps writing the cache alongside its replacement — is fixed: the keeper polls its own lockfile (30 s backstop on top of `fs.watch`) and exits when the file is gone **or** names a different PID.

---

## Cache appears corrupt or incompatible

Symptom: a keeper errors at startup with cache parse errors, or freshness looks wrong across restarts.

```bash
# wipe one repo's cache:
rm -rf ~/.coldstart/indexes/<basename>-<hash>

# wipe all caches + keeper state (safe — independent dirs):
rm -rf ~/.coldstart/indexes ~/.coldstart/daemon
```

coldstart bumps `CACHE_VERSION` (`src/constants.ts`) when the index schema changes, auto-invalidating old caches on the next run. Saves are **generational** (a fresh `g<N>-` segment set is committed atomically by `meta.json`, and the previous generation is kept), so a torn or mixed-generation read is structurally impossible — if you upgraded and an old cache is still being read, that's a bug; please file an issue with the version you came from.

After a wipe, the next lookup spawns the keeper, which rebuilds; the reader waits for that first save. (`--no-cache` is a flag for the keeper / MCP-server invocation, not for `find`/`gs`.)

---

## Recovering after deleting the cache

Automatic. The keeper watches the cache directory and rebuilds if `meta.json` disappears (it stands down while its own rebuild/save is in flight, so it never chases its own writes); a reader arriving at a cache miss waits for that rebuild. The next `find`/`gs` works — just slower for that one call. `coldstart index` is the manual pre-warm.

---

## Notebook (kb) issues

- `kb search` returns nothing for a note you can see in `.coldstart/notebook/` → run `coldstart kb lint` (structure problems) and check `kb status`.
- Freshness marks are all missing (`anchors [unverified]`) right after a keeper spawn → expected; the keeper derives the `kb-notes.json` sidecar on its first save. Query again after a few seconds.
- A note's Markdown edits vanished → expected: `.md` files are *derived* from the `.raw` log and re-rendered; contribute via `kb write` (or an appended `.raw` record), not by editing the Markdown.
- Two near-duplicate notes, the second with a `-2` id suffix → two sessions captured the same concept at the same moment. This is by design (a visible duplicate beats a silent merge); reconcile with `kb write --into <survivor-id>` + a retract of the other.

---

## Multiple projects, monorepos, worktrees

- **One keeper per absolute root path.** Two projects → two keepers, no sharing.
- **Git worktrees** are different absolute paths → different keepers (correct — they may be on different branches).
- **Symlinks:** paths are resolved to absolute, so two paths resolving to the same directory share a keeper.
- **Monorepo subdir:** point coldstart at a subdirectory (`--root packages/web`) to index only that subtree, or at the root to walk everything. Pick the scope your agent needs to navigate.

---

## The keeper and `--no-daemon`

The CLI readers (`find`/`gs`) always call `ensureKeeper` first — a cheap no-op when a keeper is already alive — so uncommitted edits stay live between calls. There's no per-`find` flag to suppress that; the spawn is a detached background process that costs nothing once running, and `coldstart restart` clears it if you need to.

`--no-daemon` applies to the **MCP-server invocation**, not to `find`/`gs`. It runs a single self-contained stdio MCP server that builds, watches, and serves in one process — no separate keeper. Use it for debugging the server or in environments where spawning a detached process is awkward:

```bash
coldstart --root . --no-daemon          # in-process MCP server, no background keeper
```

---

## Filing an issue

Include:

- coldstart version (`coldstart --version`)
- OS and Node.js version
- Whether it reproduces with `--no-daemon` (isolates keeper vs. indexer bugs)
- Output of `coldstart status` (includes the keeper stamps + repair tail)
- Last 100 lines of the keeper log (`~/.coldstart/daemon/<basename>-<hash>.log`) and `.log.prev` if relevant
- `~/.coldstart/indexes/<basename>-<hash>/repair.jsonl` if it exists
- Approximate repo size (file count) and language mix

Issues: https://github.com/AkashGoenka/coldstart/issues
