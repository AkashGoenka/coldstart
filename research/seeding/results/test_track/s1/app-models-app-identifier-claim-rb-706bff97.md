---
id: app-models-app-identifier-claim-rb-706bff97
type: file
character: single
title: "app/models/app_identifier_claim.rb"
anchors:
  - {"path":"app/models/app_identifier_claim.rb","symbols":["save","identifier_claim"],"hash":"sha256:b2ed95375b4a","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:22.562Z
edits: 1
---

# app/models/app_identifier_claim.rb

save returns the visitor from identifier_claim.identifier.visitor, not the visitor_id the client sent. After a supersession, that is the winning visitor, and the v4 response is built from it. The build path and identifier claim validations are merged into one errors object, so a failure reports both. app_build comes from AppVersionBuildPath, not from the claim, and is only read after the claim saves.
