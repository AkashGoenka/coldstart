---
id: server-tuf-metadata-resign-verify-go-73721244
type: file
character: single
title: "server/tuf/metadata/resign_verify.go"
anchors:
  - {"path":"server/tuf/metadata/resign_verify.go","symbols":["VerifyForResign","recordRotatedRoleDigests","RetireRotatedRoleDigest"],"hash":"sha256:3cf5b32addee","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.496Z
edits: 2
---

# server/tuf/metadata/resign_verify.go

VerifyForResign accepts stored metadata that verifies under the current root, or under an earlier anchored root only if its canonical digest equals the one recorded at rotation (ROTATED_ROLE_DIGESTS_<admin>_<app>); expiry is deliberately not checked because re-signing expired metadata is the point. recordRotatedRoleDigests runs before a new root is persisted, and a role that does not verify under the trusted root is not recorded and stays refused after rotation.
