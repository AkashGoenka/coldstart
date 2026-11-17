---
id: app-models-app-rb-b9767b41
type: file
character: hub
title: "app/models/app.rb"
anchors:
  - {"path":"app/models/app.rb","symbols":["define_build","auth_secret_must_be_sufficiently_strong"],"hash":"sha256:6b6a97614e0d","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.625Z
edits: 1
---

# app/models/app.rb

## Facets

- **define_build** — Returns App::Build with this record's id. The Build constructor runs AppVersion.new on the version, so a malformed version raises there, and a String built_at is parsed with Time.zone.parse.
- **auth_secret_must_be_sufficiently_strong** — auth_secret must be at least 43 characters, the length of 32 bytes in Base64. AuthenticatedApiController compares this exact value with the HTTP basic-auth secret.
