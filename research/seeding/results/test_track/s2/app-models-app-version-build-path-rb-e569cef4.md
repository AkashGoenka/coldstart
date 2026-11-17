---
id: app-models-app-version-build-path-rb-e569cef4
type: file
character: single
title: "app/models/app_version_build_path.rb"
anchors:
  - {"path":"app/models/app_version_build_path.rb","symbols":["AppVersionBuildPath","app_build","version_number_must_be_parseable"],"hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:55.156Z
edits: 1
---

# app/models/app_version_build_path.rb

Validation only checks the shape of the input; the app itself is not checked here. build_timestamp accepts ISO 8601 with second or fractional-second precision, but the separator before fractional seconds is an unescaped `.` in the regex, so any single character there passes. version_number is checked by constructing AppVersion.new and adding an error if that raises. `app_build` raises a plain RuntimeError if called on an invalid object, and an unknown app_name makes it raise ActiveRecord::RecordNotFound through `App.find_by!`, so callers must check `valid?` first and expect the lookup to raise. The result is memoized only on success.
