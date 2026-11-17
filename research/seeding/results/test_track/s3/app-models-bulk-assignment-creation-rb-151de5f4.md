---
id: app-models-bulk-assignment-creation-rb-151de5f4
type: file
character: single
title: "app/models/bulk_assignment_creation.rb"
anchors:
  - {"path":"app/models/bulk_assignment_creation.rb","symbols":["save","most_identifiers_must_exist","existing_assignments","persist_new_identifier!"],"hash":"sha256:c33166c887cc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.605Z
edits: 1
---

# app/models/bulk_assignment_creation.rb

Blocks, not warns, a bulk when more than 2% of the listed identifiers would be new: most_identifiers_must_exist adds an error unless force_identifier_creation is set (threshold NEW_IDENTIFIER_CREATION_RATIO_WARNING_THRESHOLD). save returns false on invalid input and save! raises RecordInvalid, while self.create never raises on validation failure. Unknown identifiers get a new Visitor inside the transaction through persist_new_identifier!, and rows already at the same variant and force are excluded from the superseded set, so re-running a bulk does not supersede itself.
