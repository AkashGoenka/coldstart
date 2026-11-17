---
id: app-models-assignment-rb-aea791e3
type: file
character: hub
title: "app/models/assignment.rb"
anchors:
  - {"path":"app/models/assignment.rb","symbols":["create_previous_assignment!","unsynced?","excluding_decision_overrides","for_app_build","excluding_incomplete_features_for","excluding_remote_kills_for"],"hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:46.800Z
edits: 4
---

# app/models/assignment.rb

for_app_build drops assignment rows for two reasons with different bypasses: an incomplete feature gate drops the row unless force is true, while a remote kill drops it regardless of force. The scope only removes rows; the knocked-out registry from Split is what the response carries for that split. for_presentation also calls excluding_decision_overrides, which drops rows whose updated_at is at or before the split's decided_at.

## Facets

- **create_previous_assignment!** — Archives the row as it is at call time, so it must run before the caller updates the row. previous_assignment_params copies variant, created_at (from the live updated_at), bulk_assignment_id, individually_overridden, visitor_supersession_id, context and force; superseded_at and updated_at are both the caller's now. ArbitraryAssignmentCreation#supersede! relies on this ordering.
- **excluding_decision_overrides** — Hides an assignment when its split has decided_at set and assignments.updated_at is at or before decided_at (the comparison is strict on updated_at, not created_at). Assignments updated after the decision keep showing. Split#assignments uses this via for_presentation.
