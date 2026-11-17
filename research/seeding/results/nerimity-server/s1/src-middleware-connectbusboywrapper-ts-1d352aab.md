---
id: src-middleware-connectbusboywrapper-ts-1d352aab
type: file
character: single
title: "src/middleware/connectBusboyWrapper.ts"
anchors:
  - {"path":"src/middleware/connectBusboyWrapper.ts","symbols":["connectBusboyWrapper"],"hash":"sha256:28d58fa1bbc3","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:17.359Z
edits: 1
---

# src/middleware/connectBusboyWrapper.ts

Express middleware that parses multipart/form-data with connect-busboy (one file, 7,840,000-byte limit): it copies text fields into req.body, parses silent, replyToMessageIds and mentionReplies, and sets req.fileInfo for the file. Nothing in the repo imports it (a grep outside node_modules finds only this file and the connect-busboy dependency entries), and the JSON attachment path used by the message and post routes does not go through it. Its error handler calls res.json with no status code.
