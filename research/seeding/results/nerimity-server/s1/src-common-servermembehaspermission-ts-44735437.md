---
id: src-common-servermembehaspermission-ts-44735437
type: file
character: single
title: "src/common/serverMembeHasPermission.ts"
anchors:
  - {"path":"src/common/serverMembeHasPermission.ts","symbols":["serverMemberHasPermission"],"hash":"sha256:7b2957b703fd","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:07.345Z
edits: 2
---

# src/common/serverMembeHasPermission.ts

A role-only test (never reads channel rows) that returns true if any of the member's role masks, including the default role, has the requested bit; the ADMIN bit short-circuits unless ignoreAdmin is set, and no caller passes ignoreAdmin. Callers pass ROLE_PERMISSIONS.ADMIN, so in practice it is an admin test: the socket room join fallback in onAuthenticate.ts for channels the member cannot see through PUBLIC_CHANNEL, emits/Server.ts, services/Channel.ts, fcm/pushNotification.ts and routes/servers/serverSearchMessages.ts. It is not a request gate.
