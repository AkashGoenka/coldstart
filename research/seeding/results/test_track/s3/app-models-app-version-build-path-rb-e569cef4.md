---
id: app-models-app-version-build-path-rb-e569cef4
type: file
character: single
title: "app/models/app_version_build_path.rb"
anchors:
  - {"path":"app/models/app_version_build_path.rb","symbols":["app_build","version_number_must_be_parseable","app"],"hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.620Z
edits: 1
---

# app/models/app_version_build_path.rb

Validates app_name, version_number and build_timestamp, but valid? never checks that the app exists: app_build runs App.find_by! and raises ActiveRecord::RecordNotFound for an unknown name. Build timestamps must match an ISO-8601 pattern that ends in Z or a ±hh:mm offset, with optional fractional seconds. The App::Build it returns takes built_at from this client timestamp, not the server clock, and split activity is compared against that value.
