---
id: how-the-app-boots-processes-run-and-which-env-vars-matter
type: flow
title: "how the app boots, processes run and which env vars matter"
anchors:
  - {"path":"config/application.rb","hash":"sha256:55ec8e883c9c","head":"435fea8235b5"}
  - {"path":"config/puma.rb","hash":"sha256:6f16b4fd8ac3","head":"435fea8235b5"}
  - {"path":"config/database.yml","hash":"sha256:847101d33737","head":"435fea8235b5"}
  - {"path":"Procfile","hash":"sha256:82fa384146f1","head":"435fea8235b5"}
  - {"path":"Procfile.dev","hash":"sha256:07d283a48ce2","head":"435fea8235b5"}
  - {"path":"config/initializers/rack_timeout.rb","hash":"sha256:13d8bf5aabc7","head":"435fea8235b5"}
  - {"path":"app.json","hash":"sha256:bd43c6643d88","head":"435fea8235b5"}
  - {"path":"config/environments/production.rb","hash":"sha256:ca8bf5a3decb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.886Z
edits: 1
---

# how the app boots, processes run and which env vars matter

Two processes: `web` (puma via config/puma.rb) and `worker` (delayed_job via `rake jobs:work`); bin/dev uses Procfile.dev (rails server + pnpm css watcher, no worker, so bulk assignment jobs sit unprocessed locally unless you run the worker). Env that changes behavior: DATABASE_URL, WHITELIST_CORS_HOSTS (required by CORS endpoints), BROWSER_EXTENSION_SHARED_SECRET, SAML_ISSUER (admin auth mode), EXPERIENCE_SAMPLING_WEIGHT (int >=0, default 1, exposed in v3/v4 responses; 0 disables), ATTACHMENT_STORAGE=s3|local plus S3 vars for variant screenshots, RACK_SERVICE_TIMEOUT (10s prod, 120s dev/test), PUMA_WORKER_COUNT/PUMA_THREAD_COUNT (also sizes the DB pool in database.yml), SEMANTIC_LOGGER_ENABLED. Production forces SSL. Rails 7.2 with sprockets, Primer view components, simple_form for the admin UI; tests are rspec with Postgres (uuid-ossp primary keys).

## Steps

1. `config/application.rb` (`experience_sampling_weight`, `queue_adapter`) — global config incl. delayed_job adapter
2. `config/puma.rb` (`workers`) — socket binding in production unless PORT set
3. `config/database.yml` (`pool`) — pool derived from puma env
4. `Procfile` (`worker`) — worker process

## Invariants

- Postgres only (array columns for versions, uuid_generate_v4 defaults)
