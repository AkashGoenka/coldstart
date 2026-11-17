---
id: server-tuf-tasks-task-go-c9fa038c
type: file
character: single
title: "server/tuf/tasks/task.go"
anchors:
  - {"path":"server/tuf/tasks/task.go","symbols":["GetTask","SaveTaskStatus","taskTTL"],"hash":"sha256:c2de38c5ba2e","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:58.606Z
edits: 1
---

# server/tuf/tasks/task.go

Task state is JSON at the Redis key task:<id>, kept 24 hours while active and 7 days once in a terminal state (taskTTL). GET /tuf/v1/task answers 200 with PENDING for any id whose key is missing, including ids whose key expired, so a poller cannot tell an expired task from one not yet written. A stored SUCCESS whose result.status is false is reported as ERRORED on read, while the stored value stays SUCCESS. With a nil Redis client SaveTaskStatus and UpdateTaskState return nil and write nothing, and GetTask returns 503.
