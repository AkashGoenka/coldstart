---
id: mongod-adapter-go-640f1ff6
type: file
character: single
title: "mongod/adapter.go"
anchors:
  - {"path":"mongod/adapter.go","symbols":["ConnectToDatabase"],"hash":"sha256:9f83418c9640","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T16:11:16.542Z
edits: 1
---

# mongod/adapter.go

ConnectToDatabase returns no error. A URL that connstring.Parse rejects panics, and a failed mongo.Connect or Ping calls logrus.Fatal, which exits the process, so a caller cannot recover from an unreachable database. The URL is parsed twice (connstring.Parse for the returned ConnString, then options.Client().ApplyURI), and Connect and Ping both run on context.TODO() with no deadline set in this file.
