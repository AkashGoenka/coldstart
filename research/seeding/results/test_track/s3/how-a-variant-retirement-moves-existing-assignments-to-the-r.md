---
id: how-a-variant-retirement-moves-existing-assignments-to-the-r
type: flow
title: "how a variant retirement moves existing assignments to the remaining variants"
anchors:
  - {"path":"app/controllers/admin/variant_retirements_controller.rb","hash":"sha256:13e2caf1a708","head":"435fea8235b5"}
  - {"path":"app/models/variant_retirement.rb","hash":"sha256:11cc84967538","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/bulk_assignment.rb","hash":"sha256:eb9e01a3c749","head":"435fea8235b5"}
  - {"path":"app/models/bulk_reassignment.rb","hash":"sha256:85602c0845e2","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:32.782Z
edits: 1
---

# how a variant retirement moves existing assignments to the remaining variants

A retirement changes only assignment rows and never writes the split registry, so the retiring variant keeps its weight in what the API returns until someone reweights the split separately. Only rows visible through split.assignments (the for_presentation scope) are moved, so rows hidden by a decision are left alone. Each row gets a random target among the positive-weight variants, and each target gets one BulkAssignment and one BulkReassignment.

## Steps

1. `app/controllers/admin/variant_retirements_controller.rb` (`create`) — Admin POST: passes split_id, retiring_variant and the admin to VariantRetirement.create!, then redirects to the split page.
2. `app/models/variant_retirement.rb` (`save!`, `retiring_assignments`, `random_active_variant`) — Selects split.assignments where variant is the retiring one, draws a target per row, and runs every batch inside one Assignment transaction.
3. `app/models/assignment.rb` (`for_presentation`, `excluding_decision_overrides`) — Determines which rows the retirement can see.
4. `app/models/bulk_assignment.rb` (`BulkAssignment`) — One record per target variant, created with reason 'Retiring <variant>'.
5. `app/models/bulk_reassignment.rb` (`save`, `update_assignments`) — Copies the old rows into previous_assignments, then UPDATEs variant, updated_at, mixpanel_result and context on the selected ids.
6. `app/models/split.rb` (`registry_weights_must_sum_to_100`) — Validation that keeps the weight-gradient draw in variant_retirement.rb inside 0..99.

## Invariants

- Targets come only from variants with positive weight in the current registry; a weight-0 variant never receives retired rows.
- Moved rows get mixpanel_result reset to NULL, which makes Assignment#unsynced? true.
- Registry weights must sum to 100 for the random draw to be valid, and split validation enforces that.
- The retiring variant's registry entry is not changed by this path.
