---
id: src-services-userauthentication-ts-aec8e706
type: file
character: single
title: "src/services/UserAuthentication.ts"
anchors:
  - {"path":"src/services/UserAuthentication.ts","symbols":["registerUser","loginUser","loginUserWithEmail","loginWithUsernameAndTag","loginWithGoogleUserId"],"hash":"sha256:540cbfe6b16b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.945Z
edits: 2
---

# src/services/UserAuthentication.ts

registerUser hashes password.trim() while loginUser compares the raw input without trim. Email lookups are case-insensitive; username login is an exact match on username and tag; registration's username duplicate check is case-insensitive and includes the tag. A random-tag collision is not retried ('This username is used too often.'), and a Prisma error on account create is replaced by a generic error. loginWithGoogleUserId finds the account by Google connection and checks no password. No suspension or IP-ban check happens in any login function.
