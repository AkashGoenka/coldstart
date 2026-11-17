---
id: no-read-only-or-per-action-scope-on-fns-api-tokens
type: lesson
kind: absence
title: "no read-only or per-action scope on fns_ API tokens"
scope: {"terms":["allowed_apps","fns_","CheckPermission","CreateToken"]}
status: active
updated: 2026-11-17T03:28:54.542Z
edits: 1
---

# no read-only or per-action scope on fns_ API tokens

A token stores only name, token_hash, owner, allowed_apps and expires_at (CreateToken). It passes CheckPermission only for upload on apps; read access to its apps is limited only by ValidateAPITokenAppScope on /search. There is no read-only token.

## Scope (absence — freshness = re-run this search)

- terms: `allowed_apps`, `fns_`, `CheckPermission`, `CreateToken`
