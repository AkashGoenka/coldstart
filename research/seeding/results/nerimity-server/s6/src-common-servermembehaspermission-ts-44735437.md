---
id: src-common-servermembehaspermission-ts-44735437
type: file
character: single
title: "src/common/serverMembeHasPermission.ts"
anchors:
  - {"path":"src/common/serverMembeHasPermission.ts","symbols":["serverMemberHasPermission"],"hash":"sha256:7b2957b703fd","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.873Z
edits: 2
---

# src/common/serverMembeHasPermission.ts

File name is misspelled (serverMembeHasPermission); import it by that spelling. serverMemberHasPermission has no server-owner check, so each caller (Channel.ts, emits/Server.ts, fcm/pushNotification.ts, socket onAuthenticate.ts) tests createdById first. It walks the member's role rows passed in, including the default role, and returns true on the ADMIN bit (unless ignoreAdmin; no caller passes it) or the requested bit; unlike the middleware it does not use the cached aggregate.
