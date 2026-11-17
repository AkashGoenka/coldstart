---
id: app-models-app-rb-b9767b41
type: file
character: single
title: "app/models/app.rb"
anchors:
  - {"path":"app/models/app.rb","symbols":["App","define_build","auth_secret_must_be_sufficiently_strong"],"hash":"sha256:6b6a97614e0d","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.930Z
edits: 1
---

# app/models/app.rb

An App is both an API credential (name + auth_secret, minimum 43 chars ~ 32 bytes base64, stored in plaintext and compared with secure_compare) and the owner of splits, identifier types and migrations. App::Build (nested at the bottom) is the value object (app_id, AppVersion, built_at) that all per-build filtering takes; define_build parses a string timestamp with Time.zone.parse.
