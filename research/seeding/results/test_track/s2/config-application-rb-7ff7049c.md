---
id: config-application-rb-7ff7049c
type: file
character: single
title: "config/application.rb"
anchors:
  - {"path":"config/application.rb","symbols":["TestTrack::Application"],"hash":"sha256:55ec8e883c9c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:33.996Z
edits: 1
---

# config/application.rb

Overrides the Rails 7.2 default with `config.active_job.enqueue_after_transaction_commit = :never`, so a job enqueued inside an open transaction is not held until commit; the line's TODO ties its removal to the Rails 8 upgrade. Jobs run on the `:delayed_job` adapter. `config.add_autoload_paths_to_load_path = false` means autoloaded app constants cannot be loaded by a manual `require`. `EXPERIENCE_SAMPLING_WEIGHT` is read at boot and must be a non-negative integer (boot raises otherwise), with 0 turning off experience events; `SEMANTIC_LOGGER_ENABLED` switches on the JSON stdout logger.
