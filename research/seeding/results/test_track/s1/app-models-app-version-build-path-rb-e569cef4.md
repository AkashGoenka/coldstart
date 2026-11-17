---
id: app-models-app-version-build-path-rb-e569cef4
type: file
character: single
title: "app/models/app_version_build_path.rb"
anchors:
  - {"path":"app/models/app_version_build_path.rb","symbols":["app_build"],"hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.031Z
edits: 1
---

# app/models/app_version_build_path.rb

app_build is the only place a request's version and timestamp become an App::Build, and it raises when called on an invalid object, so callers must check valid? first. The timestamp regex accepts second or fractional-second precision with a Z or numeric offset; other shapes fail validation and the controller returns 422 with these errors. An unknown app_name is not a validation error: App.find_by! raises inside app_build.
