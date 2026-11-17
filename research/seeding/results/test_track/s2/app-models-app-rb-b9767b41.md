---
id: app-models-app-rb-b9767b41
type: file
character: single
title: "app/models/app.rb"
anchors:
  - {"path":"app/models/app.rb","symbols":["auth_secret_must_be_sufficiently_strong","define_build","App::Build"],"hash":"sha256:6b6a97614e0d","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.362Z
edits: 1
---

# app/models/app.rb

auth_secret is the HTTP Basic password that AuthenticatedApiController checks against App.find_by(name:). The validation checks auth_secret.size >= 43 characters, although its error message says 32 bytes, Base64 encoded. define_build returns the nested ::App::Build value object, not an ActiveRecord build; built_at may be a String (parsed with Time.zone.parse) or a Time, and version is wrapped in AppVersion. has_many :splits is dependent: :nullify, a bulk update that skips Split's required owner_app validation, so destroying an App can leave its splits with a NULL owner_app_id.
