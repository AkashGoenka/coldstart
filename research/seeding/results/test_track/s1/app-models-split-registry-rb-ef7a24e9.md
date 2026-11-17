---
id: app-models-split-registry-rb-ef7a24e9
type: file
character: single
title: "app/models/split_registry.rb"
anchors:
  - {"path":"app/models/split_registry.rb","symbols":["splits","experience_sampling_weight"],"hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.385Z
edits: 1
---

# app/models/split_registry.rb

splits is Split.active(as_of:) and nothing else: it does not go through for_app_build, so feature-gate and remote-kill knockouts never reach registry responses. as_of must match an ISO-8601 pattern with optional fractional seconds and an explicit offset or Z, and blank fails the presence check. experience_sampling_weight only forwards Rails.configuration, so it is process-wide and identical across every registry response.
