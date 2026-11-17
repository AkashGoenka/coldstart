---
id: app-models-visitor-supersession-rb-20cb2e58
type: file
character: single
title: "app/models/visitor_supersession.rb"
anchors:
  - {"path":"app/models/visitor_supersession.rb","symbols":["merge_assignments!","create_or_ignore_duplicate"],"hash":"sha256:a51b85426367","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:22.547Z
edits: 1
---

# app/models/visitor_supersession.rb

after_create merge_assignments! copies; it never moves or deletes. The superseded visitor keeps its rows, and the superseding visitor gets new rows with context 'visitor_supersession', visitor_supersession set, and mixpanel_result nil, so they read as unsynced. Both sides are read through the Visitor#assignments association, which applies for_presentation (active splits only, decision-overridden rows hidden), so a row that the scope hides on the target does not stop a copy. The resulting unique violation is rescued per row inside a requires_new savepoint and ignored. Feature-gate assignments are never copied (except_feature_gates), which the spec gives as the reason: a claimed identity must not reach a closed gate.
