---
id: app-models-assignment-rb-aea791e3
type: file
character: single
title: "app/models/assignment.rb"
anchors:
  - {"path":"app/models/assignment.rb","symbols":["excluding_decision_overrides","for_presentation","unsynced?"],"hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.150Z
edits: 2
---

# app/models/assignment.rb

Presentation reads go through for_presentation, which drops rows on decided splits whose updated_at is at or before decided_at (excluding_decision_overrides) and, without an app build, keeps only active splits. Split.has_many :assignments and Visitor#assignments_for both use it. The writers DeterministicAssignmentCreation and ArbitraryAssignmentCreation look rows up unscoped, so they see hidden rows and do not create new ones for those visitors.

## Facets

- **excluding_decision_overrides** — A row counts as presented only when its updated_at is later than split.decided_at, or the split is undecided. A decision hides earlier rows by this comparison and does not rewrite them.
- **for_presentation** — With app_build it switches to for_app_build: as_of = app_build.built_at, plus incomplete feature gates and remote kills removed unless the row has force set. Without it, only active splits count.
- **unsynced?** — True when mixpanel_result is nil or 'failure'. BulkReassignment sets mixpanel_result to NULL on every row it moves, so moved rows are unsynced.
