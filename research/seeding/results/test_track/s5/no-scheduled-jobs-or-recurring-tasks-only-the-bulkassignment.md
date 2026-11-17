---
id: no-scheduled-jobs-or-recurring-tasks-only-the-bulkassignment
type: lesson
kind: absence
title: "no scheduled jobs or recurring tasks, only the BulkAssignmentJob"
scope: {"terms":["cron","schedule","whenever","sidekiq","recurring","job"]}
status: active
updated: 2026-11-16T18:22:46.961Z
edits: 1
---

# no scheduled jobs or recurring tasks, only the BulkAssignmentJob

Searched app/jobs, lib/tasks, config for cron/clockwork/whenever/recurring schedules. The only background job is BulkAssignmentJob (delayed_job). Rake tasks are dev helpers (seed_app, vendor_deps) only.

## Scope (absence — freshness = re-run this search)

- terms: `cron`, `schedule`, `whenever`, `sidekiq`, `recurring`, `job`
