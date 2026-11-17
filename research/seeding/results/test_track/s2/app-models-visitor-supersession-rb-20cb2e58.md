---
id: app-models-visitor-supersession-rb-20cb2e58
type: file
character: single
title: "app/models/visitor_supersession.rb"
anchors:
  - {"path":"app/models/visitor_supersession.rb","symbols":["VisitorSupersession","merge_assignments!","create_or_ignore_duplicate"],"hash":"sha256:a51b85426367","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:55.149Z
edits: 1
---

# app/models/visitor_supersession.rb

On create, this copies every assignment of the superseded visitor onto the superseding visitor, except those on feature-gate splits (the `except_feature_gates` scope, which joins through split). A split the superseding visitor already holds is skipped; that set is snapshotted once before the loop. Each copy is written with context 'visitor_supersession' and a link back to this record, inside its own savepoint, and a RecordNotUnique or PG::UniqueViolation on one copy is swallowed so the loop continues. The superseded visitor's own assignments are left in place. It is fired only from IdentifierClaim#supersede_visitor!, when the claimed identifier already belongs to a different visitor.
