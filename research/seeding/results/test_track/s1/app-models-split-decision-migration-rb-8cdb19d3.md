---
id: app-models-split-decision-migration-rb-8cdb19d3
type: file
character: single
title: "app/models/split_decision_migration.rb"
anchors:
  - {"path":"app/models/split_decision_migration.rb","symbols":["SplitDecisionMigration","split_model","variant_must_exist"],"hash":"sha256:dfcc0b079c87","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:46.760Z
edits: 1
---

# app/models/split_decision_migration.rb

Validates that the split belongs to the calling app (Split.find_by(owner_app:, name:)) and that the variant exists, then calls split.create_decision!, which sets the variant to 100 and stamps decided_at. Unlike the remote-kill and feature-completion wrappers, this lookup is app-scoped. Deciding a split that is already retired succeeds and clears finished_at, as spec/models/split_decision_migration_spec.rb asserts.
