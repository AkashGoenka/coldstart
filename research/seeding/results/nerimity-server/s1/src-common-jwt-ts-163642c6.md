---
id: src-common-jwt-ts-163642c6
type: file
character: single
title: "src/common/JWT.ts"
anchors:
  - {"path":"src/common/JWT.ts","symbols":["generateToken","decryptToken"],"hash":"sha256:5e9702085f2b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:27.809Z
edits: 1
---

# src/common/JWT.ts

generateToken strips the header segment from jwt.sign output and passes no expiresIn, so tokens carry no exp claim; decryptToken re-adds the constant header eyJhbGciOiJIUzI1NiJ9. before jwt.verify and returns null on any failure. The passwordVersion field is parsed and returned, but no code under src/ reads it outside this file, so nothing on the REST path compares it.
