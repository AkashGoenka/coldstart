---
id: no-overridden-at-or-force-check-on-remote-kills-in-this-repo
type: lesson
kind: absence
title: "no overridden_at or force check on remote kills in this repo"
scope: {"terms":["overridden_at","override:","affecting","remote_kill"]}
status: active
updated: 2026-11-16T18:24:48.777Z
edits: 1
---

# no overridden_at or force check on remote kills in this repo

Searched app/ and lib/ for overridden_at and override: (the pre-ADR-002 override mechanism). Neither occurs. Remote kills are filtered only by AppRemoteKill.affecting, which is absolute (doc/arch/adr-002.md). Searched only app/ and lib/ for the first term.

## Scope (absence — freshness = re-run this search)

- terms: `overridden_at`, `override:`, `affecting`, `remote_kill`
