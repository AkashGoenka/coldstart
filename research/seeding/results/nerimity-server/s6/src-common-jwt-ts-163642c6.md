---
id: src-common-jwt-ts-163642c6
type: file
character: single
title: "src/common/JWT.ts"
anchors:
  - {"path":"src/common/JWT.ts","symbols":["generateToken","decryptToken"],"hash":"sha256:5e9702085f2b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.828Z
edits: 2
---

# src/common/JWT.ts

Tokens are HS256 JWTs with the fixed header segment stripped; decryptToken re-adds 'eyJhbGciOiJIUzI1NiJ9.' before verifying. The payload is the string '<id>-<passwordVersion>' split on '-'; for sessions the id is a session id and the version is 1, and no file in src reads passwordVersion. generateToken sets no expiry, so tokens never expire by claim. Webhook tokens pass env.JWT_WEBHOOK_SECRET as the secret argument; failures return null.
