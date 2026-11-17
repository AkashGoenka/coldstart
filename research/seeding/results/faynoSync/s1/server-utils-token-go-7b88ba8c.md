---
id: server-utils-token-go-7b88ba8c
type: file
character: single
title: "server/utils/token.go"
anchors:
  - {"path":"server/utils/token.go","symbols":["GenerateAPIToken","HashAPIToken","IsAPIToken"],"hash":"sha256:98956db93c22","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:47.924Z
edits: 3
---

# server/utils/token.go

An API token is fns_ followed by 64 hex characters (32 random bytes). Only its SHA-256 hash is stored (token_hash), along with a prefix of fns_ plus 8 hex characters for display. AuthMiddleware finds the document by that hash, so the raw value exists only in the CreateToken response. The download-token prefix fnd_ shares the generator but is not accepted by IsAPIToken.
