---
id: no-request-specs-for-the-split-registry-endpoints
type: lesson
kind: absence
title: "no request specs for the split registry endpoints"
scope: {"terms":["split_registry","builds","requests","build_timestamp"]}
status: active
updated: 2026-11-16T18:25:38.336Z
edits: 1
---

# no request specs for the split registry endpoints

Searched spec/requests for builds/ and split_registry: spec/requests/api/v1 holds only split_details_spec.rb and visitor_details_spec.rb. The v2, v3 and v4 split registry endpoints are covered only by controller specs (spec/controllers/api/v3/split_registries_controller_spec.rb and the v4 and v2 equivalents), which pass build_timestamp directly, so nothing tests that the route segment matches the param name.

## Scope (absence — freshness = re-run this search)

- terms: `split_registry`, `builds`, `requests`, `build_timestamp`
