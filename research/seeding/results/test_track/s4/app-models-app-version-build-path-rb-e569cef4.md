---
id: app-models-app-version-build-path-rb-e569cef4
type: file
character: single
title: "app/models/app_version_build_path.rb"
anchors:
  - {"path":"app/models/app_version_build_path.rb","symbols":["app_build","app"],"hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.454Z
edits: 1
---

# app/models/app_version_build_path.rb

Validation checks presence and format only: build_timestamp must be ISO-8601 with seconds, an optional fraction, and an explicit Z or +/-hh:mm offset, and version_number is parsed with AppVersion.new (skipped when blank). Nothing checks that the app exists, so the App.find_by! inside app_build is the first point where an unknown app_name fails. app_build calls valid? first and raises if the path is invalid.
