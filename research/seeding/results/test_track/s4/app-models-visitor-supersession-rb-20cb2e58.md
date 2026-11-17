---
id: app-models-visitor-supersession-rb-20cb2e58
type: file
character: single
title: "app/models/visitor_supersession.rb"
anchors:
  - {"path":"app/models/visitor_supersession.rb","symbols":["VisitorSupersession","merge_assignments!","create_or_ignore_duplicate"],"hash":"sha256:a51b85426367","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:53.034Z
edits: 1
---

# app/models/visitor_supersession.rb

Runs once on create and copies the superseded visitor's assignments onto the superseding visitor, skipping feature gates and any split the target already has. Both sides use Visitor#assignments (for_presentation), so decision-overridden and finished-split rows are not copied and do not count as present. The copy itself is only guarded by the (split_id, visitor_id) unique index: create_or_ignore_duplicate runs each insert in a savepoint and rescues RecordNotUnique, so a target row hidden by for_presentation keeps its place. Copied rows carry context 'visitor_supersession' and no mixpanel_result.
