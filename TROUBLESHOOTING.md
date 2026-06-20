# Troubleshooting

Almost every coldstart issue is the **keeper** — the background process that keeps the on-disk index fresh — either not running, holding a stale index, or leaving a stale lockfile. The keeper serves nothing, so there's no port, HTTP, or bridge to debug; it just watches and writes the cache that the readers (`find`/`gs`/MCP) read.

State lives in two independent places:

- `~/.coldstart/daemon/` — one set of `<basename>-<hash>.{json,log,log.prev}` per repo root (lockfile + logs).
- `~/.coldstart/indexes/<basename>-<hash>/` — cached `meta.json`, `graph.json`, `files-N.json`.

`<basename>` is your repo's directory name; `<hash>` is the first 16 chars of `sha256(absolute_path)`.

---

## First move for almost anything: `status`, then `restart`

```bash
coldstart status
```

Lists every keeper on the machine — root path, PID, alive/dead, version, and **index freshness** (file count + age, read from the cache `meta.json` mtime). No network probe. This is also the answer to "is my index fresh?".

```bash
coldstart restart        # current repo's keeper — respawns on next lookup
coldstart restart --all  # every keeper
```

`restart` SIGTERMs (5 s grace, then SIGKILL) and clears the lockfile. The next `coldstart find` (or MCP call) spawns a fresh keeper that reloads the cache, or rebuilds if it's missing. **This is the right answer for almost any "something feels off" situation** — suspected stale index, weird output, post-upgrade.

To read the keeper log directly:

```bash
tail -f ~/.coldstart/daemon/<basename>-<hash>.log
```

Logs rotate at 1 MB; the previous run is in `.log.prev` (read it after a crash + respawn).

---

## Index seems out of date

The watcher should keep the index current. If it missed an event (rare — happens on some network filesystems, or if the machine was suspended mid-edit):

```bash
coldstart restart
```

If you changed branches or pulled a large diff, the git-HEAD check should force a rebuild automatically. If it didn't, `restart`.

**To force a full rebuild without restarting**, delete the cache commit marker — the running keeper detects it within ~200 ms and rebuilds in place:

```bash
rm ~/.coldstart/indexes/<basename>-<hash>/meta.json
```

---

## First lookup is slow

There's no separate index step — the first reader for a fresh repo builds the cache lazily. On a large repo (10k+ files, cold cache) that first build can take a while. Two ways to avoid paying it inline:

```bash
coldstart init     # warms the index in the background at setup
coldstart index    # build + save the cache up front, with progress to stderr
```

After either, `find`/`gs` hit a warm cache. `coldstart index` is also the **single-writer prep** step if you want a deterministic, non-lazy build (e.g. in CI).

---

## Stale lockfile (keeper died but lock remains)

Symptom: `coldstart status` shows `dead (stale lock)` — the JSON file exists but its PID is gone. Readers *should* detect this and respawn, but to force a clean state:

```bash
coldstart restart
# or by hand:
rm ~/.coldstart/daemon/<basename>-<hash>.json
rm ~/.coldstart/daemon/<basename>-<hash>.spawn   # if present
```

The `.log`/`.log.prev` files stay for postmortem. The next lookup spawns a fresh keeper.

---

## Cache appears corrupt or incompatible

Symptom: a keeper errors at startup with cache parse errors, or freshness looks wrong across restarts.

```bash
# wipe one repo's cache:
rm -rf ~/.coldstart/indexes/<basename>-<hash>

# wipe all caches + keeper state (safe — independent dirs):
rm -rf ~/.coldstart/indexes ~/.coldstart/daemon
```

coldstart bumps `CACHE_VERSION` (`src/constants.ts`) when the index schema changes, auto-invalidating old caches on the next run. If you upgraded and an old cache is still being read, that's a bug — please file an issue with the version you came from.

To force a fresh build for a repo, delete its cache (or just the `meta.json` marker) and run the next lookup — the reader rebuilds on the miss:

```bash
rm -rf ~/.coldstart/indexes/<basename>-<hash>
coldstart find <terms>   # rebuilds, then reads
```

(`--no-cache` is a flag for the keeper / MCP-server invocation, not for `find`/`gs`.)

---

## Recovering after deleting the cache

Cache recovery is **automatic**. The keeper watches the cache directory and rebuilds if `meta.json` disappears; and any reader lazily rebuilds on a cache miss. You don't need to do anything — the next `find`/`gs` works, just slower for that one call while it rebuilds. `coldstart index` is the manual way to pre-warm it.

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
- Output of `coldstart status`
- Last 100 lines of the keeper log (`~/.coldstart/daemon/<basename>-<hash>.log`) and `.log.prev` if relevant
- Approximate repo size (file count) and language mix

Issues: https://github.com/AkashGoenka/coldstart/issues
