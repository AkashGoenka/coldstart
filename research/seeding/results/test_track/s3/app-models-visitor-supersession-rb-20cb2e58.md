---
id: app-models-visitor-supersession-rb-20cb2e58
type: file
character: single
title: "app/models/visitor_supersession.rb"
anchors:
  - {"path":"app/models/visitor_supersession.rb","symbols":["merge_assignments!","create_or_ignore_duplicate"],"hash":"sha256:a51b85426367","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.899Z
edits: 1
---

# app/models/visitor_supersession.rb

Copies only the superseded visitor's assignments whose split_id the superseding visitor lacks, and reads both sides through Visitor#assignments, which is scoped for_presentation. Feature-gate assignments are excluded by except_feature_gates. Each copy is a new assignment with context 'visitor_supersession', points back at this row, and leaves mixpanel_result nil; each copy runs in its own requires_new transaction, and a unique violation is swallowed silently.
