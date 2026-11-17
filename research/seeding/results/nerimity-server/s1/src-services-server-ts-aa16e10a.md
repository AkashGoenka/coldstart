---
id: src-services-server-ts-aa16e10a
type: file
character: hub
title: "src/services/Server.ts"
anchors:
  - {"path":"src/services/Server.ts","symbols":["getServers","getServerIds","deleteServer"],"hash":"sha256:792485ceaf54","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:20.655Z
edits: 2
---

# src/services/Server.ts

getServers loads the user's servers with channels (filtered to deleting: null), roles and customEmojis in one Prisma query; with partial it omits serverMembers from that query and uses the presence-based member lookup instead. A currentServerId the user is not in is dropped silently. Every channel carries its permissions rows (roleId, permissions), so they are emitted in the AUTHENTICATED channels array. onAuthenticate sets channels, roles and serverMembers to undefined on each server object before emitting, so the servers entries in AUTHENTICATED do not include them; they arrive as top-level channels, serverRoles and serverMembers.

## Facets

- **deleteServer** — Does not delete messages or channels. In one transaction it sets webhook.deleting and channel.deleting for the server, deletes the server row (cascading schedule_server_delete), and upserts a scheduleMessageDelete row per channel, which is what later drives the message purge. Caches are cleared afterwards and a serverLeft emit with serverDeleted true is sent. It returns an error tuple only when the server row is missing.
