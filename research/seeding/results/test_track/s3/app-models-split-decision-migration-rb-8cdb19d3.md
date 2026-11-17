---
id: app-models-split-decision-migration-rb-8cdb19d3
type: file
character: single
title: "app/models/split_decision_migration.rb"
anchors:
  - {"path":"app/models/split_decision_migration.rb","symbols":["save","split_model"],"hash":"sha256:dfcc0b079c87","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:32.803Z
edits: 1
---

# app/models/split_decision_migration.rb

The guard is the split lookup scoped to the calling app (Split.find_by owner_app and name), plus a check that the variant is a key of the split's registry; any failure returns false and the controller renders 422. A successful call does not touch assignment rows: it only calls create_decision!, which makes the chosen variant the 100% winner.
