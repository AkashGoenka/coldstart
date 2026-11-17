---
id: app-models-arbitrary-assignment-creation-rb-284775b4
type: file
character: single
title: "app/models/arbitrary_assignment_creation.rb"
anchors:
  - {"path":"app/models/arbitrary_assignment_creation.rb","symbols":["ArbitraryAssignmentCreation","save!","supersede!","individual_override?","save_new_assignment!"],"hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:38.513Z
edits: 3
---

# app/models/arbitrary_assignment_creation.rb

In the bulk flow only the insert branch is reached: BulkAssignmentCreation passes visitors with no assignment row, so `superseding?` is false and `save_new_assignment!` runs. The supersede branch (previous assignment plus individually_overridden) runs only after a RecordNotUnique race, because `save_new_assignment!` rescues it and calls `save!` again. The API override controllers call `create!` with force: true, so supersessions with history go through this branch there.
