---
id: src-fcm-pushnotification-ts-c083edeb
type: file
character: single
title: "src/fcm/pushNotification.ts"
anchors:
  - {"path":"src/fcm/pushNotification.ts","symbols":["sendServerPushMessageNotification","sendDmPushNotification"],"hash":"sha256:7cae56bddfa0","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.917Z
edits: 2
---

# src/fcm/pushNotification.ts

Both push functions return immediately when message.silent is set or when fcm-credentials.json was not found at module load; silent is read nowhere else. Server push: MENTIONS_ONLY matches only direct [@:id] mentions (not role mentions, replies or @everyone); channel ping mode overrides server ping mode; private channels filter recipients by channel permission first. DM push ignores notification settings and sends to every FCM token of the recipient. Rejected sendEach is swallowed and failed tokens are removed through removeFCMTokens.
