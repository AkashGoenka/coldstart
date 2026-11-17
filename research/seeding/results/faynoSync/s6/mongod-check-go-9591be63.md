---
id: mongod-check-go-9591be63
type: file
character: single
title: "mongod/check.go"
anchors:
  - {"path":"mongod/check.go","symbols":["CheckLatestVersion","CheckRequiredMigrationStep","FetchLatestVersionOfApp","GetAppByName"],"hash":"sha256:34fd1ceea134","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.442Z
edits: 2
---

# mongod/check.go

CheckLatestVersion does not filter on rollout_percent; it returns RolloutPercent/RolloutSeed for the client to apply, whereas FetchLatestVersionOfApp (/apps/latest) filters rollout_percent >= 100. Outcomes: equal = Found false; newer than the client's version = Found false + PossibleRollback true; older = Found true. A published required_intermediate above the client's version replaces the latest in the response. No matching published version returns the error 'no matching documents found', which FindLatestVersion turns into a 400 rather than the 200 Not found body. For team callers GetAppByName filters by teamUser.Owner and Apps.Allowed; for fns_ callers the repository does no scope check.
