# Troubleshooting

Most coldstart issues come from the daemon — either it didn't start, isn't responding, or is holding a stale index. This guide walks through the common cases.

If a fix below references the daemon directory or cache, those live at:

- `~/.coldstart/daemon/` — lockfiles + log files, one set of `<basename>-<hash>.{json,log,log.prev}` per project root
- `~/.coldstart/indexes/<basename>-<hash>/` — cached `meta.json` + `graph.json`

`<basename>` is your project's directory name; `<hash>` is the first 16 chars of `sha256(absolute_path)`.

---

## First step for any daemon problem: `status` and `log`

The daemon is auto-spawned with its stdio disconnected from the AI client, so its output doesn't appear in the client's logs. Coldstart writes every daemon log line to a file instead.

**See which daemons exist and whether they're healthy:**

```bash
npx coldstart-mcp status
```

Output shows one row per daemon: root path, PID, port, status (`ok` / `alive, http unreachable` / `dead (stale lock)`), log size, and the log path.

**Tail the log for a misbehaving daemon:**

```bash
tail -f ~/.coldstart/daemon/<basename>-<hash>.log
```

Logs rotate at 1 MB. The most recent run is in `.log`; the previous run is preserved in `.log.prev` — which is the file to read when a daemon has crashed and respawned.

---

## Tool calls hang on first invocation

The bridge waits for the daemon to finish its initial index build, up to 180 seconds. On large repos (10k+ files, slow disks, or first run with no cache) this can take a while.

**Check progress.** The bridge logs `[coldstart] Daemon spawned` to the AI client's stderr when it starts a new daemon. The daemon itself logs parse progress every 500 files into its log file — `tail -f` it (path from `coldstart-mcp status`) to confirm forward motion.

**Confirm the daemon is alive:**

```bash
npx coldstart-mcp status
# or, by hand:
cat ~/.coldstart/daemon/<basename>-<hash>.json
ps -p <pid>
```

If the PID is gone but the lockfile remains, that's a stale lockfile — see below.

**Workaround for very slow first builds:** run once with `--no-daemon` from the terminal so you can see the build output and confirm it completes:

```bash
npx coldstart-mcp@latest --root . --no-daemon
```

This builds the cache. Subsequent daemon-mode starts will reuse it.

---

## "Daemon did not become ready within 180s"

The bridge timed out waiting on the daemon. Possible causes:

- **Index is genuinely still building** on a very large repo. Re-run; the cache from the partial build (if it got far enough to write) will speed up the second attempt.
- **Daemon crashed silently.** Run `npx coldstart-mcp status` to see whether the daemon process is still alive. Then read the daemon log (`~/.coldstart/daemon/<basename>-<hash>.log`) for any `[coldstart] Fatal` or error lines — if the daemon respawned after a crash, the previous run's output is in the corresponding `.log.prev`. Remove the lockfile and retry.
- **Port is bound but unresponsive.** Rare. `curl http://127.0.0.1:<port>/mcp` to probe; if it doesn't respond, kill the daemon PID and remove the lockfile.

---

## Stale lockfile (daemon crashed but lock remains)

Symptom: bridge logs nothing, or gets stuck. `npx coldstart-mcp status` reports `dead (stale lock)` — the JSON file exists but the PID inside is dead.

The bridge *should* detect this automatically (`process.kill(pid, 0)` returns false → respawn), but if you're hitting an edge case, force a clean state:

```bash
rm ~/.coldstart/daemon/<basename>-<hash>.json
rm ~/.coldstart/daemon/<basename>-<hash>.spawn   # if present
```

The `.log` and `.log.prev` files stay where they are — useful for postmortem. Restart your AI client; the next tool call will spawn a fresh daemon.

---

## Index seems out of date

The file watcher should keep the in-memory index current — but if it missed an event (rare; happens on some network filesystems or when files change while the daemon is paused/suspended) the simplest reset is to restart the daemon:

```bash
# Find PID
cat ~/.coldstart/daemon/<basename>-<hash>.json
# Kill it
kill <pid>
```

The bridge respawns the daemon on the next tool call. The in-memory index is rebuilt from cache + incremental patches as needed.

If you've changed branches or pulled a large diff, the file watcher's git-HEAD check should trigger a rebuild automatically. If it hasn't (you can see this from the `_indexStatus` field on tool responses), restart the daemon.

---

## Cache appears corrupt or incompatible

Symptom: daemon errors out at startup with cache parse errors, or `_indexStatus` shows weird state across restarts.

**Wipe the cache for one project:**

```bash
rm -rf ~/.coldstart/indexes/<basename>-<hash>
```

**Wipe everything (cache + daemon lockfiles):**

```bash
rm -rf ~/.coldstart/
```

Coldstart bumps `CACHE_VERSION` (in `src/constants.ts`) when the index schema changes, which auto-invalidates old caches on the next run. If you've upgraded coldstart and old caches are still being read, that's a bug — please file an issue with the version you upgraded from.

To force a single run without cache:

```bash
npx coldstart-mcp --root . --no-cache
```

---

## Multiple projects, monorepos, and worktrees

- **One daemon per absolute root path.** Two projects → two daemons, no sharing.
- **Git worktrees** of the same repo are different absolute paths, so they get different daemons. This is correct — each worktree may be on a different branch.
- **Symlinks:** the daemon resolves the absolute path, so two paths that resolve to the same directory will share a daemon.
- **Monorepo subdirectories:** if you point coldstart at a subdirectory (`--root packages/web`), it indexes that subtree only. If you point at the monorepo root, it walks everything (with the configured excludes). Pick the scope that matches what your AI agent needs to navigate.

---

## Port already in use / port conflicts

The daemon binds to `127.0.0.1` on a random ephemeral port (port 0, OS-assigned), so true conflicts are very rare. If you see one, the most common cause is a previous daemon process not being properly cleaned up.

```bash
lsof -iTCP:<port> -sTCP:LISTEN     # find what's holding the port
```

If it's a coldstart daemon PID that should have exited, kill it and remove the lockfile.

---

## Disk space

Coldstart's cache is small for most repos but can grow on very large codebases:

- A 6k-file Java repo (Apache Kafka) caches at ~30–50 MB.
- A 50k-file monorepo can run into hundreds of MB.

`graph.json` holds the bulk of the data. To inspect:

```bash
du -sh ~/.coldstart/indexes/*/
```

To skip disk persistence entirely (fresh build every run):

```bash
npx coldstart-mcp --root . --no-cache
```

---

## Falling back to single-process mode

If the daemon misbehaves and you need to ship a feature *now*, force single-process mode by passing `--no-daemon` in your MCP config:

```json
{
  "mcpServers": {
    "coldstart": {
      "command": "npx",
      "args": ["coldstart-mcp@latest", "--no-daemon"]
    }
  }
}
```

You lose the cross-session index reuse, but you also lose the entire bridge/daemon machinery — every tool call hits the same in-process index.

---

## Filing an issue

When reporting a daemon-related issue, please include:

- Coldstart version (`npx coldstart-mcp --version` or your `package.json` entry)
- OS and Node.js version
- Whether you can reproduce with `--no-daemon` (helps isolate daemon vs. indexer bugs)
- Output of `npx coldstart-mcp status`
- Last 100 lines of the daemon log (`~/.coldstart/daemon/<basename>-<hash>.log`) and, if relevant, `.log.prev`
- Stderr from the AI client / bridge
- Approximate repo size (file count) and language mix

Issues: https://github.com/akashgoenka/coldstart-mcp/issues
