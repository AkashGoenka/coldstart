---
id: no-http-caching-on-split-registry-responses-in-this-repo
type: lesson
kind: absence
title: "no HTTP caching on split registry responses in this repo"
scope: {"terms":["Cache-Control","max-age","expires_in","fresh_when","stale?","ETag","Rack::Cache","rack_cache","ConditionalGet"]}
status: active
updated: 2026-11-16T18:23:32.825Z
edits: 1
---

# no HTTP caching on split registry responses in this repo

Searched app/, config/, and lib/ for Cache-Control, max-age, expires_in, fresh_when, stale?, ETag, Rack::Cache, and ConditionalGet. The split_registries controllers (api v1 to v4) and their jbuilder views set no cache headers. The only Cache-Control hits are public_file_server headers for static files in config/environments/test.rb and development.rb; config.action_dispatch.rack_cache is commented out in config/environments/stage.rb. Clients see the current registry on every fetch unless their own code caches it.

## Scope (absence — freshness = re-run this search)

- terms: `Cache-Control`, `max-age`, `expires_in`, `fresh_when`, `stale?`, `ETag`, `Rack::Cache`, `rack_cache`, `ConditionalGet`
