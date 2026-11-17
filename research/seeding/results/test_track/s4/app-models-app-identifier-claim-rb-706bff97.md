---
id: app-models-app-identifier-claim-rb-706bff97
type: file
character: single
title: "app/models/app_identifier_claim.rb"
anchors:
  - {"path":"app/models/app_identifier_claim.rb","symbols":["save","build_path"],"hash":"sha256:b2ed95375b4a","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.449Z
edits: 1
---

# app/models/app_identifier_claim.rb

save writes the identifier claim before it resolves the app: valid? && identifier_claim.save! persists the Identifier and any supersession, and only then does build_path.app_build run App.find_by!(name:). The model never checks that the app exists, so an unknown app_name passes validation, leaves the claim saved, and raises RecordNotFound. The visitor it exposes is identifier_claim.identifier.visitor, the identifier's owner, not the posted visitor_id.
