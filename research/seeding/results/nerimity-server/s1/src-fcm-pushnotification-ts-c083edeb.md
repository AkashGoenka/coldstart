---
id: src-fcm-pushnotification-ts-c083edeb
type: file
character: single
title: "src/fcm/pushNotification.ts"
anchors:
  - {"path":"src/fcm/pushNotification.ts","symbols":["sendServerPushMessageNotification","sendDmPushNotification","formatMessage","hasChannelPermission"],"hash":"sha256:7cae56bddfa0","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:58.484Z
edits: 1
---

# src/fcm/pushNotification.ts

Two push senders, both returning early when message.silent is set or when fcm-credentials.json did not load (module-level require in try/catch). sendServerPushMessageNotification limits recipients in private channels to users who pass hasChannelPermission (server creator, ADMIN, or PUBLIC_CHANNEL through a role); for MENTIONS_ONLY it matches only message.mentions, so role mentions do not satisfy that mode. Content is formatMessage'd (a [@:id] becomes @username only when the id is in message.mentions), cut to 200 characters, and tokens that fail are removed through removeFCMTokens.
