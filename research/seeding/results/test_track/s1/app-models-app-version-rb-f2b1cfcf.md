---
id: app-models-app-version-rb-f2b1cfcf
type: file
character: single
title: "app/models/app_version.rb"
anchors:
  - {"path":"app/models/app_version.rb","symbols":["to_pg_array","to_a","<=>"],"hash":"sha256:777d872220bd","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.026Z
edits: 1
---

# app/models/app_version.rb

Versions are compared as integer arrays, not strings: to_pg_array (used when AppVersionType serializes) writes e.g. '{1,10,0}' and <=> compares to_a, so 1.10 sorts after 1.9. Validation allows up to three dot-separated decimal integers and at most 18 characters, and the header comment requires that any relaxation keep currently legal versions collating the same. Any SQL comparison against first_bad_version, fixed_version or feature completion version depends on this array form.
