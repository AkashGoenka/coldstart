---
id: app-models-batch-arbitrary-assignment-creation-rb-194e40ab
type: file
character: single
title: "app/models/batch_arbitrary_assignment_creation.rb"
anchors:
  - {"path":"app/models/batch_arbitrary_assignment_creation.rb","symbols":["BatchArbitraryAssignmentCreation","save!"],"hash":"sha256:4bda65f2376a","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:10.097Z
edits: 1
---

# app/models/batch_arbitrary_assignment_creation.rb

The whole v2 batch runs in one ActiveRecord transaction, so an exception on any item rolls back items already superseded earlier in the batch. Each item is merged with visitor_id, force and mixpanel_result: 'success' before ArbitraryAssignmentCreation.create!, and because the merge comes last, a client cannot set mixpanel_result or force per item.
