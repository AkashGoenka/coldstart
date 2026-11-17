---
id: app-models-bulk-assignment-creation-rb-151de5f4
type: file
character: hub
title: "app/models/bulk_assignment_creation.rb"
anchors:
  - {"path":"app/models/bulk_assignment_creation.rb","symbols":["save","most_identifiers_must_exist","force= and force_identifier_creation=","existing_assignments","ensure_identifiers","unassigned_identifiers"],"hash":"sha256:c33166c887cc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:38.495Z
edits: 1
---

# app/models/bulk_assignment_creation.rb

## Facets

- **save** — Returns false without writing if invalid; `save!` turns that into ActiveRecord::RecordInvalid. The writes (BulkAssignment, BulkReassignment, per-visitor creations) share one Assignment.transaction.
- **most_identifiers_must_exist** — The 2% guard (NEW_IDENTIFIER_CREATION_RATIO_WARNING_THRESHOLD = 0.02). It fails when more than 2% of the listed identifiers are unknown, unless force_identifier_creation is true. It only counts existing identifiers and creates none, and it does nothing when identifier_type_id matches no IdentifierType.
- **force= and force_identifier_creation=** — Two different flags. `force` is written onto the assignment rows and decides which existing rows already match. `force_identifier_creation` only bypasses the 2% guard.
- **existing_assignments** — Only visitors whose identifier already existed. Rows matching both the target variant and force are excluded, so they are not rewritten and get no previous_assignments row.
- **ensure_identifiers** — Creates a Visitor and an Identifier for each unknown value. It is first called from existing_assignments, which is evaluated inside save's transaction, so the creations roll back with it.
- **unassigned_identifiers** — Selects identifiers whose visitor has no assignment row in this split. It runs after BulkReassignment, so the rows it just updated are excluded here.
