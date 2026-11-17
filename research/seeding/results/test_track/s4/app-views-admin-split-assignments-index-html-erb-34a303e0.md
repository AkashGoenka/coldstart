---
id: app-views-admin-split-assignments-index-html-erb-34a303e0
type: file
character: single
title: "app/views/admin/split_assignments/index.html.erb"
anchors:
  - {"path":"app/views/admin/split_assignments/index.html.erb","symbols":["identifiers","identifier_type"],"hash":"sha256:6cd2f9cb03c7","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:33.870Z
edits: 1
---

# app/views/admin/split_assignments/index.html.erb

Each table row is one identifier of a visitor, grouped by variant and then by identifier type, so the row count is the identifier count of the shown visitors, not the assignment count. A visitor with no identifiers produces no row. The root element is `article.InfoCard`, and no template under app/ defines the `AdminSplitAssignments--index` class that the system page object in spec/support/pages/admin/split_assignments_page.rb selects, so that page object's selector matches nothing as the code stands.
