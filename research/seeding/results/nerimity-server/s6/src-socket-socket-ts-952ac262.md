---
id: src-socket-socket-ts-952ac262
type: file
character: single
title: "src/socket/socket.ts"
anchors:
  - {"path":"src/socket/socket.ts","symbols":["createIO","emitToAll"],"hash":"sha256:0cde49834e8c","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.843Z
edits: 2
---

# src/socket/socket.ts

createIO installs the redis-streams adapter and websocket-only transport; it is called without an http server in the primary (emit-only) and with the server in each worker, which is what lets an emit in one process reach a socket in another. emitToAll addresses [...serverIds, ...friendIds, userId] after two prisma lookups per call; the code comment warns an empty room array broadcasts to everyone, but userId is always appended so that case is not reachable through it. excludeSelf and excludeSocketId add except() clauses.
