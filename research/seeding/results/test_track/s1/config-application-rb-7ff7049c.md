---
id: config-application-rb-7ff7049c
type: file
character: single
title: "config/application.rb"
anchors:
  - {"path":"config/application.rb","symbols":["experience_sampling_weight"],"hash":"sha256:55ec8e883c9c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.428Z
edits: 1
---

# config/application.rb

config.experience_sampling_weight is read once at boot from EXPERIENCE_SAMPLING_WEIGHT (default 1) through Integer(...), so a non-integer value stops boot and a negative value raises with the message in the file. Nothing reads ENV per request; controllers and SplitRegistry read the Rails config value. The README says 0 disables experience-event reporting and a value such as 10 makes v4 clients report one in ten.
