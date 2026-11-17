---
id: server-tuf-tasks-task-go-c9fa038c
type: file
character: single
title: "server/tuf/tasks/task.go"
anchors:
  - {"path":"server/tuf/tasks/task.go","symbols":["GetTask","SaveTaskStatus","taskTTL"],"hash":"sha256:c2de38c5ba2e","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.511Z
edits: 2
---

# server/tuf/tasks/task.go

GET /tuf/v1/task answers 200 state PENDING for an unknown task_id (not 404), does not compare the task's owner with the caller, and reports a stored SUCCESS whose result.status is false as ERRORED. Active task records live 24h, terminal ones 7 days.
