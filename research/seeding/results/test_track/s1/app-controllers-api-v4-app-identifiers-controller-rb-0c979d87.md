---
id: app-controllers-api-v4-app-identifiers-controller-rb-0c979d87
type: file
character: single
title: "app/controllers/api/v4/app_identifiers_controller.rb"
anchors:
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","symbols":["create"],"hash":"sha256:76aeda829de8","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:22.567Z
edits: 1
---

# app/controllers/api/v4/app_identifiers_controller.rb

create renders @visitor_id and @assignments from app_identifier_claim.visitor, which is the identifier owner after any supersession. The returned id can therefore differ from the request's visitor_id, and the assignments can include rows copied from the claimed visitor. Assignments are visitor.assignments_for(app_build) ordered by updated_at, and the active splits are Split.for_presentation(app_build:).
