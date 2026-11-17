---
id: src-routes-channels-channelmessagecreate-ts-a9b07fdc
type: file
character: single
title: "src/routes/channels/channelMessageCreate.ts"
anchors:
  - {"path":"src/routes/channels/channelMessageCreate.ts","symbols":["channelMessageCreate","route","queueRoute"],"hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.900Z
edits: 2
---

# src/routes/channels/channelMessageCreate.ts

Chain: authenticate({allowBot:true}), channelVerification, channelPermissions(SEND_MESSAGE), memberHasRolePermissionMiddleware(SEND_MESSAGE), body() validators, rateLimit('create_message', 20 per 20s, itterId = channel id), queueRoute. The validators only collect errors; route() returns the 400 from customExpressValidatorResult after the mute check (403) and the slow-mode check (429, skipped for the owner and ADMIN members), so invalid bodies still spend rate-limit quota. queueRoute calls route() directly; the mimiqueue path is commented out. Hitting the rate limit 3 times in 3 minutes in a SERVER_TEXT channel runs banServerMember(..., true) on the sender unless they own the server (spec only covers the 429). A shadow-banned sender gets a fabricated 200 message and createMessage is never called. @everyone is honoured only when MENTION_EVERYONE passes; posting needs account.emailConfirmed for non-application users, and local CDN attachments are deleted if createMessage errors.
