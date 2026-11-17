---
id: app-models-app-version-rb-f2b1cfcf
type: file
character: single
title: "app/models/app_version.rb"
anchors:
  - {"path":"app/models/app_version.rb","symbols":["AppVersion","to_pg_array","from_pg_array"],"hash":"sha256:777d872220bd","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.913Z
edits: 1
---

# app/models/app_version.rb

Versions are 1-3 dot-separated integers (iOS rules, max 18 chars) compared as integer arrays and persisted as Postgres int[] via AppVersionType ('{1,2,3}'), registered in config/initializers/types.rb as :app_version. Comparison is array <=> so '1.2' < '1.2.1'. The comment promises the format may only be relaxed, never tightened, because stored versions must stay valid. AppVersionType#cast swallows errors and returns nil, which then fails presence validations.
