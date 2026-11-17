---
id: app-models-deterministic-assignment-creation-rb-b18784bc
type: file
character: single
title: "app/models/deterministic_assignment_creation.rb"
anchors:
  - {"path":"app/models/deterministic_assignment_creation.rb","symbols":["save!","existing_assignment","variant_calculator"],"hash":"sha256:915c6ddf264d","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:19.922Z
edits: 1
---

# app/models/deterministic_assignment_creation.rb

save! returns early for feature gates, and for an existing assignment it touches nothing except mixpanel_result, and only when the row is unsynced (nil or failure); the variant of an existing row is never recomputed or changed. Only when no row exists does it call ArbitraryAssignmentCreation.create! with the calculated variant. The sync write uses save!(touch: false) so a sync does not count as an override of a decided split (see excluding_decision_overrides in assignment.rb). An unknown split_name raises from Split.find_by! and nothing is written.
