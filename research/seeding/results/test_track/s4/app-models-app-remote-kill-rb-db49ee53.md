---
id: app-models-app-remote-kill-rb-db49ee53
type: file
character: single
title: "app/models/app_remote_kill.rb"
anchors:
  - {"path":"app/models/app_remote_kill.rb","symbols":["affecting","must_not_overlap_existing","arel_fixed_version_is_null_or_greater_than"],"hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:48.757Z
edits: 1
---

# app/models/app_remote_kill.rb

Remote kills are absolute: affecting is the only predicate that decides whether a kill applies, and it compares app, first_bad_version and fixed_version, with no force or overridden_at term (ADR doc/arch/adr-002.md explains why the override was removed). fixed_version nil means the kill stays open-ended. The overlap validation is what keeps one split at one kill per build.
