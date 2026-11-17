---
id: mongod-create-go-6e71740c
type: file
character: single
title: "mongod/create.go"
anchors:
  - {"path":"mongod/create.go","symbols":["Upload","createMetaDocument","CreateDocument","updateTeamUserPermissions","IsDuplicateCheckIgnored"],"hash":"sha256:317006604766","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.459Z
edits: 2
---

# mongod/create.go

Upload writes one artifact per call: on an existing version it $push-es with an UpdateOne whose filter adds a $not $elemMatch duplicate predicate (matches on Package, but on link for nupkg/delta/blockmap), and it never changes publish/critical/changelog; a channel mismatch returns ErrVersionChannelMismatch. A new version is inserted unpublished unless publish parses true, rollout_percent defaults to 100, and a unique_app_version_owner conflict is retried once as an append. createMetaDocument replaces owner with teamUser.Owner for team callers, and updateTeamUserPermissions then $addToSets the new id into their allowed list (failure is logged only).
