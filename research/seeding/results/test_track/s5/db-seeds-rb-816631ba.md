---
id: db-seeds-rb-816631ba
type: file
character: single
title: "db/seeds.rb"
anchors:
  - {"path":"db/seeds.rb","symbols":["seed_apps_filename"],"hash":"sha256:d484438382e0","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.952Z
edits: 1
---

# db/seeds.rb

Seeds always create an App named 'TestTrack' with a random auth_secret and an 'app_id' IdentifierType owned by it. In development only, db/seed_apps.yml (written by `rake seed_app[name]`, which prints the TEST_TRACK_API_URL basic-auth URL to give the client) is loaded to upsert apps with fixed secrets. README setup uses `rake db:setup` which runs these.
