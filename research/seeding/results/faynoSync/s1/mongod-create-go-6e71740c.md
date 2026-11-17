---
id: mongod-create-go-6e71740c
type: file
character: hub
title: "mongod/create.go"
anchors:
  - {"path":"mongod/create.go","symbols":["createMetaDocument","updateTeamUserPermissions","isVersionIndexDuplicate","ErrVersionChannelMismatch","duplicateCheckIgnoredPackages","CreateDocument"],"hash":"sha256:317006604766","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:21.356Z
edits: 2
---

# mongod/create.go

## Facets

- **createMetaDocument** — When the caller is a team user, the new document's owner is set to teamUser.Owner. Team-permission grants run after the insert, and a failure there is logged, not returned, so the document is kept.
- **updateTeamUserPermissions** — Writes one $addToSet on permissions.<channels|platforms|archs|apps>.allowed for the team user's _id and nothing else. Resource types outside those four return an error. mongod/team_permissions_race_test.go asserts that a revocation made after the snapshot survives this write.
- **isVersionIndexDuplicate** — Matches a duplicate-key error whose text contains unique_app_version_owner. The upload insert retries once on that error (only when attempt == 0): the loop goes back to a FindOne on (app_id, version, owner) and appends to the document a concurrent request created. A second conflict is returned as an error.
- **ErrVersionChannelMismatch** — Returned when an upload targets a version that already exists under a different channel_id. The channel of a version cannot change, so artifacts are appended only on a channel match.
- **duplicateCheckIgnoredPackages** — Extensions nupkg, delta and blockmap are exempt from the duplicate-artifact check on upload. The map's comment gives the reason: velopack full and delta packages, several sparkle deltas, and electron-builder blockmaps legitimately repeat per version, platform and arch.
- **CreateDocument** — A Mongo 11000 error becomes '<keyType> with this name already exists' only when the error message contains the uniqueKey argument. Any other duplicate-key error is logged and returned raw.
