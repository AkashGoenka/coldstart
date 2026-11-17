---
id: app-types-app-version-type-rb-c187ea06
type: file
character: single
title: "app/types/app_version_type.rb"
anchors:
  - {"path":"app/types/app_version_type.rb","symbols":["cast","serialize","deserialize"],"hash":"sha256:052273fe285b","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.615Z
edits: 1
---

# app/types/app_version_type.rb

Registered as the :app_version attribute type in config/initializers/types.rb and used by AppFeatureCompletion and AppRemoteKill. cast swallows every error and returns nil, so a malformed version becomes nil and fails presence validation rather than raising. serialize calls AppVersion.new without a rescue, so bad input raises there. Values are stored as Postgres integer arrays such as {1,10,0} and read back through from_pg_array.
