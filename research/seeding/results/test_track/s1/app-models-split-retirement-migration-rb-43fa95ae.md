---
id: app-models-split-retirement-migration-rb-43fa95ae
type: file
character: single
title: "app/models/split_retirement_migration.rb"
anchors:
  - {"path":"app/models/split_retirement_migration.rb","symbols":["SplitRetirementMigration","split_model","decision_must_exist"],"hash":"sha256:f1ab7ab023a4","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:46.766Z
edits: 1
---

# app/models/split_retirement_migration.rb

Retirement is a decision plus finish: it calls split.reconfigure! with weighting {decision=>100} and one timestamp for both decided_at and finished_at, so a retired split has decided_at equal to finished_at (asserted by spec/models/split_retirement_migration_spec.rb). It does not reject an already-finished split, it rewrites the timestamps. Of the four endpoints in this family it is the only one that sets finished_at.
