---
id: how-a-channel-message-is-created-saved-and-delivered
type: flow
title: "how a channel message is created, saved and delivered"
anchors:
  - {"path":"src/routes/channels/channelMessageCreate.ts","hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
  - {"path":"src/routes/webhooks/webhookExecute.ts","hash":"sha256:a453030c0955","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/Message.ts","hash":"sha256:c71a4dcfd02b","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/MessageCreate.ts","hash":"sha256:0e43ea106d0b","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/prepareMessageForDatabase.ts","hash":"sha256:106ed5ef74c5","head":"feb30ff9ac54"}
  - {"path":"src/emits/Server.ts","hash":"sha256:f580b2e966a8","head":"feb30ff9ac54"}
  - {"path":"src/emits/Channel.ts","hash":"sha256:5b5c8617efae","head":"feb30ff9ac54"}
  - {"path":"src/fcm/pushNotification.ts","hash":"sha256:7cae56bddfa0","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.032Z
edits: 1
---

# how a channel message is created, saved and delivered

createMessage is only a re-export of createMessageV2, and createMessageV2 returns the saved message to the HTTP caller before mentions, socket emits and push run, because handleMessageSideEffects is started without await. The user route and the webhook route both validate and pre-process their own input and then call the same function; all write and fan-out logic is in MessageCreate.ts. The message row and channel.lastMessagedAt are written in one prisma transaction.

## Steps

1. `src/routes/channels/channelMessageCreate.ts` (`route`) — user entry: middleware chain, rate limit, then mute check, slow mode, validation, attachments, shadow-ban short circuit, createMessage
2. `src/routes/webhooks/webhookExecute.ts` (`route`) — webhook entry: content and username checks, webhookAuthenticate, rate limit, createMessage with webhookId and no userId
3. `src/services/Message/Message.ts` (`createMessage`, `addMention`) — re-export alias and the mention writer
4. `src/services/Message/MessageCreate.ts` (`createMessageV2`, `handleMessageSideEffects`) — validates, writes in a transaction, returns, then computes mentions and fans out
5. `src/services/Message/prepareMessageForDatabase.ts` (`prepareMessageForDatabase`) — turns [@:id], [r:id], [q:id] tokens and reply ids into relation rows
6. `src/emits/Server.ts` (`emitServerMessageCreated`) — emit to the channel room, not the server room
7. `src/fcm/pushNotification.ts` (`sendServerPushMessageNotification`, `sendDmPushNotification`) — FCM push; skipped when message.silent or fcm-credentials.json is missing

## Invariants

- The sender's response is sent after the row is committed but before addMention, emits and push have run.
- message.silent suppresses only push: addMention and the socket emits never read it.
- On the server-channel path emit and push come after await addMention with no try/catch, so an addMention exception skips both; on the DM path a failed messageMention upsert returns before emitDMMessageCreated and push (the row is already saved).
- Webhook messages skip the member lookup and dismissChannelNotification; opts.serverId passed by webhookExecute is not read downstream.
