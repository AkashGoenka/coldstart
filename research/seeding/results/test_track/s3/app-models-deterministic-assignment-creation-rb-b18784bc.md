---
id: app-models-deterministic-assignment-creation-rb-b18784bc
type: file
character: single
title: "app/models/deterministic_assignment_creation.rb"
anchors:
  - {"path":"app/models/deterministic_assignment_creation.rb","symbols":["save!","existing_assignment","split"],"hash":"sha256:915c6ddf264d","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.126Z
edits: 2
---

# app/models/deterministic_assignment_creation.rb

Never supersedes: when a row already exists for the visitor and split it returns, and it writes only mixpanel_result, only when the row is unsynced (nil or failure), with touch: false so updated_at is not bumped. The split lookup is Split.find_by! with no active scope, so finished splits still create new rows for visitors who have none. Feature-gate splits (name ends in _enabled) return before any write.
