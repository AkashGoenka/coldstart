---
id: server-utils-session-go-b764450b
type: file
character: single
title: "server/utils/session.go"
anchors:
  - {"path":"server/utils/session.go","symbols":["VerifySessionPrincipal","CallerTeamUser","GenerateSessionJWT"],"hash":"sha256:0936ae7a463f","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.421Z
edits: 2
---

# server/utils/session.go

Session JWTs are HS256 with sub (principal _id), typ (admin|team), ver (token_version), username and a 24h exp; VerifySessionPrincipal re-reads the admin or team_users document on every request and revokes when the doc is gone or token_version/username differ. Tests pin that password changes revoke sessions, permission changes do not, a legacy claims-only JWT is 401, and a name reused by another tenant does not revive an old token. CallerTeamUser deliberately maps mongo.ErrNoDocuments to errSessionRevoked, because a nil result means 'admin' to its callers.
