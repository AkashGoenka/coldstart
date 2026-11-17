---
id: app-models-app-version-rb-f2b1cfcf
type: file
character: single
title: "app/models/app_version.rb"
anchors:
  - {"path":"app/models/app_version.rb","symbols":["AppVersion","VERSION_REGEX","initialize","from_pg_array"],"hash":"sha256:777d872220bd","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.979Z
edits: 1
---

# app/models/app_version.rb

Versions are dotted integers with at most three components, no leading zeros (`07` is invalid), and at most 18 characters, per Apple's iOS rules; they compare numerically per component via `to_a`, so `1.0.20` sorts after `1.0.3`. `1.0` and `1.0.0` are valid and distinct (`!=`), as the spec asserts. Bad input raises RuntimeError, not ArgumentError, and only String, Integer or AppVersion are accepted, so a Float like 1.0 raises. The header comment is a contract: validation may be relaxed but never tightened, so every currently legal version keeps its order. `from_pg_array` takes every digit run from the Postgres array text, and app/types/app_version_type.rb is the round-trip caller.
