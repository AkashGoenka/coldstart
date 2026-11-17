---
id: how-the-admin-split-population-count-reaches-the-assignments
type: flow
title: "how the admin split population count reaches the assignments list and its cap"
anchors:
  - {"path":"app/views/admin/splits/_details.html.erb","hash":"sha256:b23efe1e2444","head":"435fea8235b5"}
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/admin/split_assignments_controller.rb","hash":"sha256:b83d64361cc6","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/views/admin/split_assignments/index.html.erb","hash":"sha256:6cd2f9cb03c7","head":"435fea8235b5"}
  - {"path":"app/components/flash_component.rb","hash":"sha256:22db2159edc4","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:33.839Z
edits: 1
---

# how the admin split population count reaches the assignments list and its cap

The 1000-row cap applies to assignments, but the table renders one row per identifier of each shown visitor, so the page can show more rows than the cap and a visitor with no identifiers adds none. The population count on the split page and the total in the cap warning both come from Split#assignments, which goes through the for_presentation scope, so the two numbers use the same filter. The split page only links the count; the filtering and banner live in the controller.

## Steps

1. `app/views/admin/splits/_details.html.erb` (`admin_split_assignments_path`) — renders the population count as the link text; the link target is this split's assignments index
2. `config/routes.rb` (`assignments`) — nests an index-only assignments route under admin splits, served by the split_assignments controller
3. `app/controllers/admin/split_assignments_controller.rb` (`index`, `VIEW_LIMIT`) — loads the split, limits its assignments to VIEW_LIMIT, and sets the flash.now warning when the total exceeds it
4. `app/models/assignment.rb` (`for_presentation`) — the scope both the count and the list go through; it filters decision overrides before the active-split or app-build variant
5. `app/views/admin/split_assignments/index.html.erb` (`identifiers`) — expands each visitor's identifiers into table rows, grouped by variant then identifier type
6. `app/components/flash_component.rb` (`flash_types`) — renders flash[:warning] as a banner only because warning is listed in flash_types

## Invariants

- The count on the split page and the warning total are computed from the same Split#assignments scope.
- Table rows equal the identifiers of the displayed visitors, not the number of assignments shown.
- The limit is applied before identifier expansion, so the rendered row count is not capped at VIEW_LIMIT.
