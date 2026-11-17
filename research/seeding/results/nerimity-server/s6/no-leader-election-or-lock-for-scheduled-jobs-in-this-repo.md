---
id: no-leader-election-or-lock-for-scheduled-jobs-in-this-repo
type: lesson
kind: absence
title: "no leader election or lock for scheduled jobs in this repo"
scope: {"terms":["redlock","leader","mutex","lock","scheduled jobs"]}
status: active
updated: 2026-11-17T03:29:05.214Z
edits: 1
---

# no leader election or lock for scheduled jobs in this repo

Grepped src for redlock, leader, mutex, NX and lock: no matches. The cron and interval jobs in src/index.ts run in every api primary process with no shared lock or Redis key guard.

## Scope (absence — freshness = re-run this search)

- terms: `redlock`, `leader`, `mutex`, `lock`, `scheduled jobs`
