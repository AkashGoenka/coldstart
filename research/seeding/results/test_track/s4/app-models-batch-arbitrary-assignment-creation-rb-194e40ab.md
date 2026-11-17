---
id: app-models-batch-arbitrary-assignment-creation-rb-194e40ab
type: file
character: single
title: "app/models/batch_arbitrary_assignment_creation.rb"
anchors:
  - {"path":"app/models/batch_arbitrary_assignment_creation.rb","symbols":["save!","create!"],"hash":"sha256:4bda65f2376a","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:27.921Z
edits: 1
---

# app/models/batch_arbitrary_assignment_creation.rb

save! wraps every item in one ActiveRecord transaction, so an exception on any item rolls back the earlier ones: an unknown split_name raises from ArbitraryAssignmentCreation's Split.find_by! and the caller sees the exception, never a partial result. The class does no validation of its own, and mixpanel_result is hard-coded to 'success' for every item regardless of input. An empty assignments array is a no-op that never reaches Visitor.from_id, because the visitor is only looked up per item.
