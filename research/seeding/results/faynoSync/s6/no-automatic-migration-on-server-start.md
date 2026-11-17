---
id: no-automatic-migration-on-server-start
type: lesson
kind: absence
title: "no automatic migration on server start"
scope: {"terms":["RunMigrationsUp","StartServer","migrate"]}
status: active
updated: 2026-11-17T03:28:54.568Z
edits: 1
---

# no automatic migration on server start

Only the migrate subcommand in faynoSync.go calls RunMigrationsUp/Down; StartServer only connects to Mongo.

## Scope (absence — freshness = re-run this search)

- terms: `RunMigrationsUp`, `StartServer`, `migrate`
