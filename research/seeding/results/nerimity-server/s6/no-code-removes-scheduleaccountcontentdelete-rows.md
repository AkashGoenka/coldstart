---
id: no-code-removes-scheduleaccountcontentdelete-rows
type: lesson
kind: absence
title: "no code removes ScheduleAccountContentDelete rows"
scope: {"terms":["scheduleAccountContentDelete","scheduledForContentDeletion"]}
status: active
updated: 2026-11-17T03:29:05.233Z
edits: 1
---

# no code removes ScheduleAccountContentDelete rows

Grepped src for scheduleAccountContentDelete: the only writer is the upsert in deleteAccountFromDatabase and the only reader is scheduleDeleteAccountContent in src/index.ts. Nothing deletes a row, so the job's queries for those users keep running.

## Scope (absence — freshness = re-run this search)

- terms: `scheduleAccountContentDelete`, `scheduledForContentDeletion`
