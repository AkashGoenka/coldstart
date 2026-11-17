---
id: app-models-assignment-rb-aea791e3
type: file
character: single
title: "app/models/assignment.rb"
anchors:
  - {"path":"app/models/assignment.rb","symbols":["for_presentation","excluding_decision_overrides","unsynced?","to_hash","variant_must_exist"],"hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.904Z
edits: 1
---

# app/models/assignment.rb

Assignment.for_presentation hides rows where the split was decided AFTER the assignment was last updated (assignments.updated_at <= splits.decided_at), so decided splits only show re-assigned rows; the has_many :assignments on Visitor and Split already apply this default scope. Assignment.to_hash keys by split name symbol and is what visitor assignment_registry returns. `unsynced?` (mixpanel_result nil/'failure') is how clients learn which assignments still need to report analytics events.
