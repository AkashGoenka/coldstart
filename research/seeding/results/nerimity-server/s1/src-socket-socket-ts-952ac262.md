---
id: src-socket-socket-ts-952ac262
type: file
character: single
title: "src/socket/socket.ts"
anchors:
  - {"path":"src/socket/socket.ts","symbols":["createIO","markMembersFetched","hasFetchedMembers","clearMembersFetched"],"hash":"sha256:0cde49834e8c","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:05.487Z
edits: 1
---

# src/socket/socket.ts

createIO sets websocket-only transport and the redis-streams adapter, so room emits are relayed through Redis. markMembersFetched keeps up to 10 server ids per socket in an in-process object, evicting the oldest insertion past 10, and clearMembersFetched is called from onDisconnect. It is called only on the partial login path in onAuthenticate, so a full login does not record anything here.
