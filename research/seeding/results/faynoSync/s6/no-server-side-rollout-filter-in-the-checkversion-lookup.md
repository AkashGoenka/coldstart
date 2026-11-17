---
id: no-server-side-rollout-filter-in-the-checkversion-lookup
type: lesson
kind: absence
title: "no server-side rollout filter in the checkVersion lookup"
scope: {"terms":["rollout_percent","RolloutPercent","CheckLatestVersion"]}
status: active
updated: 2026-11-17T03:28:54.549Z
edits: 1
---

# no server-side rollout filter in the checkVersion lookup

CheckLatestVersion (mongod/check.go) selects the newest published version without a rollout_percent condition and returns RolloutPercent/RolloutSeed as a 'rollout' field for the client to apply; only FetchLatestVersionOfApp (/apps/latest) filters rollout.

## Scope (absence — freshness = re-run this search)

- terms: `rollout_percent`, `RolloutPercent`, `CheckLatestVersion`
