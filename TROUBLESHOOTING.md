# Troubleshooting

Most coldstart issues come from the daemon — either it didn't start, isn't responding, or is holding a stale index. This guide walks through the common cases.

If a fix below references the daemon directory or cache, those live at:

- `~/.coldstart/daemon/` — lockfiles + log files, one set of `<basename>-<hash>.{json,log,log.prev}` per project root
- `~/.coldstart/indexes/<basename>-<hash>/` — cached `meta.json`, `graph.json`, and `files-N.json` chunks

`<basename>` is your project's directory name; `<hash>` is the first 16 chars of `sha256(absolute_path)`.

---

## First step for any daemon problem: `doctor`, `status`, or just restart it

As of v1.4.3 the bridge tails the daemon log to its own stderr, so daemon output (build progress, parse errors, watcher events) appears in your AI client's Output panel in real time. You usually won't need to chase log files. If something still looks wrong:

**Quick health check for the current project's daemon:**

```bash
coldstart-mcp doctor
```

Exits 0 + prints `PASS` if the daemon for your `cwd` is alive, HTTP-responding, and finished indexing. Exits 1 + prints `FAIL` with the reason otherwise (no daemon, stale PID, unreachable HTTP, build failure).

**See every daemon across all projects:**

```bash
coldstart-mcp status
```

Output shows one row per daemon: root path, PID, port, state (`ok` / `alive, http unreachable` / `dead (stale lock)`), log size, and the log path.

**Force a clean restart when you suspect anything wrong:**

```bash
coldstart-mcp restart        # current project's daemon
coldstart-mcp restart --all  # every running daemon
```

Sends SIGTERM (5 s grace) then SIGKILL fallback, and removes the lockfile. The next time your AI client makes a tool call, a fresh daemon spawns from your installed version. This is the right answer for _almost every_ "something feels off" situation — version upgrades, suspected stale index, weird tool output.

**Tail the log directly for a deep investigation:**

```bash
tail -f ~/.coldstart/daemon/<basename>-<hash>.log
```

Logs rotate at 1 MB. The most recent run is in `.log`; the previous run is preserved in `.log.prev` — read this when a daemon has crashed and respawned.

---

## Tool calls hang on first invocation

The bridge waits for the daemon to finish its initial index build, up to 180 seconds. On large repos (10k+ files, slow disks, or first run with no cache) this can take a while.

**Check progress.** The bridge logs `[coldstart] Daemon spawned` to the AI client's stderr when it starts a new daemon. The daemon itself logs parse progress every 500 files into its log file — `tail -f` it (path from `coldstart-mcp status`) to confirm forward motion.

**Confirm the daemon is alive:**

```bash
coldstart-mcp status
# or, by hand:
cat ~/.coldstart/daemon/<basename>-<hash>.json
ps -p <pid>
```

If the PID is gone but the lockfile remains, that's a stale lockfile — see below.

**Workaround for very slow first builds:** run once with `--no-daemon` from the terminal so you can see the build output and confirm it completes:

```bash
coldstart-mcp --root . --no-daemon
```

This builds the cache. Subsequent daemon-mode starts will reuse it.

---

## "Daemon did not become ready within 180s"

The bridge timed out waiting on the daemon. Possible causes:

- **Index is genuinely still building** on a very large repo. Re-run; the cache from the partial build (if it got far enough to write) will speed up the second attempt.
- **Daemon crashed silently.** Run `coldstart-mcp status` to see whether the daemon process is still alive. Then read the daemon log (`~/.coldstart/daemon/<basename>-<hash>.log`) for any `[coldstart] Fatal` or error lines — if the daemon respawned after a crash, the previous run's output is in the corresponding `.log.prev`. Remove the lockfile and retry.
- **Port is bound but unresponsive.** Rare. `curl http://127.0.0.1:<port>/mcp` to probe; if it doesn't respond, kill the daemon PID and remove the lockfile.

---

## Stale lockfile (daemon crashed but lock remains)

Symptom: bridge logs nothing, or gets stuck. `coldstart-mcp status` reports `dead (stale lock)` — the JSON file exists but the PID inside is dead.

The bridge _should_ detect this automatically (`process.kill(pid, 0)` returns false → respawn), but if you're hitting an edge case, force a clean state:

```bash
rm ~/.coldstart/daemon/<basename>-<hash>.json
rm ~/.coldstart/daemon/<basename>-<hash>.spawn   # if present
```

The `.log` and `.log.prev` files stay where they are — useful for postmortem. Restart your AI client; the next tool call will spawn a fresh daemon.

---

## Index seems out of date

The file watcher should keep the in-memory index current — but if it missed an event (rare; happens on some network filesystems or when files change while the daemon is paused/suspended):

```bash
coldstart-mcp restart
```

The next tool call spawns a fresh daemon, which loads from disk cache (if valid) or rebuilds.

**To force a full rebuild** (not just a daemon restart), also remove the cache directory's `meta.json` — the running daemon will detect this within 200 ms and rebuild in place:

```bash
rm ~/.coldstart/indexes/<basename>-<hash>/meta.json
```

If you've changed branches or pulled a large diff, the file watcher's git-HEAD check should trigger a rebuild automatically. If it hasn't (you can see this from the `_indexStatus` field on tool responses), `coldstart-mcp restart`.

## After upgrading coldstart-mcp

Upgrades are two commands — they must both run, or the upgrade has no effect:

```bash
npm install -g coldstart-mcp@latest --legacy-peer-deps
coldstart-mcp init
```

The `init` step rewrites `.mcp.json` to point at the new versioned path under `~/.coldstart/versions/`. Without it, `.mcp.json` still references the old version's path, and your AI client keeps running the old binary even though the global install is up to date.

Per-project: run `init` separately inside each project that uses coldstart-mcp — each project's `.mcp.json` is independent, and the upgrade only takes effect after init runs there.

After both commands run, the daemon-side handover is automatic: the bridge stamps its version into the daemon lockfile and refuses to attach to an older-version daemon — on the next tool call the old daemon is SIGTERM'd and a fresh one spawns. If for any reason that doesn't happen, `coldstart-mcp restart` fixes it explicitly.

---

## `~/.coldstart/versions/` — don't delete this

Every `coldstart-mcp init` copies the global install into `~/.coldstart/versions/<version>/` and writes the absolute path into `.mcp.json`. That directory is **persistent runtime state** — every project's `.mcp.json` resolves to a specific subdir there.

If you delete `~/.coldstart/versions/` (or a specific version subdir):

- Projects whose `.mcp.json` points at the deleted version will fail to start the bridge — the AI client logs `ENOENT` on `node <path>/dist/index.js`.
- Fix: re-run `coldstart-mcp init` inside each affected project to rewrite its `.mcp.json` against the currently-installed version.

The directory grows by ~50 MB per kept version (most of it is tree-sitter prebuilds). It's safe to delete *old* versions you're sure no project references — but easier to just re-run `init` in each project after upgrade and let unused versions linger.

---

## Cache appears corrupt or incompatible

Symptom: daemon errors out at startup with cache parse errors, or `_indexStatus` shows weird state across restarts.

**Wipe the cache for one project:**

```bash
rm -rf ~/.coldstart/indexes/<basename>-<hash>
```

**Wipe just the cache + daemon state (safe — keeps version installs):**

```bash
rm -rf ~/.coldstart/indexes ~/.coldstart/daemon
```

**Wipe everything, including the version installs (you'll need to re-run `coldstart-mcp init` in every project after):**

```bash
rm -rf ~/.coldstart/
```

This deletes `~/.coldstart/versions/` along with the caches, which breaks every project's `.mcp.json` until you re-run `init` in each. Prefer the targeted wipe above unless you specifically need to reset version installs too.

Coldstart bumps `CACHE_VERSION` (in `src/constants.ts`) when the index schema changes, which auto-invalidates old caches on the next run. If you've upgraded coldstart and old caches are still being read, that's a bug — please file an issue with the version you upgraded from.

To force a single run without cache:

```bash
coldstart-mcp --root . --no-cache
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

Each cached index directory holds `meta.json`, `graph.json`, and one or more `files-N.json` chunks (5,000 files per chunk). The `files-*.json` chunks carry the per-file metadata and typically account for most of the disk usage. To inspect:

```bash
du -sh ~/.coldstart/indexes/*/
```

To skip disk persistence entirely (fresh build every run):

```bash
coldstart-mcp --root . --no-cache
```

---

## Falling back to single-process mode

If the daemon misbehaves and you need to ship a feature _now_, force single-process mode by passing `--no-daemon` in your MCP config:

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

- Coldstart version (`coldstart-mcp --version` or your `package.json` entry)
- OS and Node.js version
- Whether you can reproduce with `--no-daemon` (helps isolate daemon vs. indexer bugs)
- Output of `coldstart-mcp status`
- Last 100 lines of the daemon log (`~/.coldstart/daemon/<basename>-<hash>.log`) and, if relevant, `.log.prev`
- Stderr from the AI client / bridge
- Approximate repo size (file count) and language mix

Issues: https://github.com/akashgoenka/coldstart/issues
