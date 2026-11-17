---
id: mongod-adapter-go-640f1ff6
type: file
character: single
title: "mongod/adapter.go"
anchors:
  - {"path":"mongod/adapter.go","symbols":["ConnectToDatabase"],"hash":"sha256:9f83418c9640","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:21.349Z
edits: 1
---

# mongod/adapter.go

`ConnectToDatabase` never returns a connection error: an unparseable URL panics, and a failed `mongo.Connect` or `Ping` calls `logrus.Fatal`, which exits the process. `faynoSync migrate` reaches it first (faynoSync.go), so a bad `MONGODB_URL` ends the command before `RunMigrationsUp`'s error handling runs. The `connstring.ConnString` it returns is what callers read `Database` from; the migrate path passes that value as the database name.
