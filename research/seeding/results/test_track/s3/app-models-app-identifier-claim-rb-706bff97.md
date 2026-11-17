---
id: app-models-app-identifier-claim-rb-706bff97
type: file
character: single
title: "app/models/app_identifier_claim.rb"
anchors:
  - {"path":"app/models/app_identifier_claim.rb","symbols":["save","visitor"],"hash":"sha256:b2ed95375b4a","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.910Z
edits: 1
---

# app/models/app_identifier_claim.rb

visitor is not the visitor_id that was sent: after a successful save it is identifier_claim.identifier.visitor, the owner of the claimed value, so a merged claim returns the surviving visitor. app_build comes from AppVersionBuildPath, and both sub-objects' validation errors are merged into this object's errors.
