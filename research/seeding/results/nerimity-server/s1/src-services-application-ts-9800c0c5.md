---
id: src-services-application-ts-9800c0c5
type: file
character: hub
title: "src/services/Application.ts"
anchors:
  - {"path":"src/services/Application.ts","symbols":["getBotToken","getApplication","refreshBotToken","updateBot","deleteApplication","updateBotCommands","getServerBotCommands"],"hash":"sha256:dd60a8004745","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.485Z
edits: 2
---

# src/services/Application.ts

## Facets

- **getBotToken** — Reuses an existing userDevice sessionId of the bot user if one exists, otherwise creates one with addDeviceWithSession. The token is generateToken(sessionId, 1) signed with the default JWT_SECRET, not the webhook secret.
- **getApplication** — A read that writes: when clientSecret is null it generates one and stores it before returning. regenerateApplicationClientSecret overwrites it, and the old value stops passing the equality check in exchangeCodeForToken and refreshToken.
- **refreshBotToken** — Removes the bot user's sessions, clears its user cache and disconnects its sockets. The next getBotToken call creates a new session.
- **updateBot** — The `if (!user)` branch after `if (!user?.bot)` cannot run, because a null user already returned in the bot check.
- **deleteApplication** — Deletes the bot's account (deleteAccount with bot and deleteContent) before the application row. If that fails, the function returns before touching the application row.
- **updateBotCommands** — Replaces the whole command set in one transaction: deleteMany for the application, then createMany with skipDuplicates.
- **getServerBotCommands** — Returns commands of bots that are members of the server (memberInServers), so the list follows server membership of the bot, not ownership of the application.
