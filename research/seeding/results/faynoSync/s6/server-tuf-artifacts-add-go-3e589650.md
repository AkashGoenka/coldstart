---
id: server-tuf-artifacts-add-go-3e589650
type: file
character: single
title: "server/tuf/artifacts/add.go"
anchors:
  - {"path":"server/tuf/artifacts/add.go","symbols":["AddArtifacts","addArtifactsLocked","getRoleForArtifactPath"],"hash":"sha256:953272468040","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.508Z
edits: 2
---

# server/tuf/artifacts/add.go

AddArtifacts gates only on BOOTSTRAP being absent/empty, so pre-/signing- values pass (test covers only the absent case). Each artifact goes to the first delegated role whose path glob or path-hash prefix matches; unmatched ones are skipped with a warning (details.invalid_paths) and the call fails only if none match. A failure updating delegation paths is logged and publish continues. The delegation expiry default here is 90 days, the bump path uses 365 for the same key. Snapshot and timestamp are always updated on publish.
