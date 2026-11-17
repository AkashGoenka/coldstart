---
id: no-api-v5-in-this-repo
type: lesson
kind: absence
title: "no api v5 in this repo"
scope: {"terms":["v5","Api::V5","api/v5"]}
status: active
updated: 2026-11-16T18:23:34.087Z
edits: 1
---

# no api v5 in this repo

Searched app/, config/, spec/ and lib/ for 'v5' case-insensitively across .rb and .jbuilder files: no match. The versioned API stops at v4 (namespace :v4 in config/routes.rb with controllers under app/controllers/api/v4). A v5 endpoint would need its own namespace, controllers, views and specs; see the flow 'how a new API version is wired'.

## Scope (absence — freshness = re-run this search)

- terms: `v5`, `Api::V5`, `api/v5`
