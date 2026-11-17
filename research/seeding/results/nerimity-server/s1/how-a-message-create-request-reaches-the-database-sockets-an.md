---
id: how-a-message-create-request-reaches-the-database-sockets-an
type: flow
title: "how a message create request reaches the database, sockets and push"
anchors:
  - {"path":"src/routes/channels/channelMessageCreate.ts","hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/Message.ts","hash":"sha256:c71a4dcfd02b","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/MessageCreate.ts","hash":"sha256:0e43ea106d0b","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/prepareMessageForDatabase.ts","hash":"sha256:106ed5ef74c5","head":"feb30ff9ac54"}
  - {"path":"src/emits/Server.ts","hash":"sha256:f580b2e966a8","head":"feb30ff9ac54"}
  - {"path":"src/emits/Channel.ts","hash":"sha256:5b5c8617efae","head":"feb30ff9ac54"}
  - {"path":"src/fcm/pushNotification.ts","hash":"sha256:7cae56bddfa0","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:58.451Z
edits: 1
---

# how a message create request reaches the database, sockets and push

The HTTP response does not wait for the side effects: createMessageV2 returns once the message row and channel.lastMessagedAt are committed, and handleMessageSideEffects (mention rows, socket emits, push, OG embed fetch) is started with .then and never awaited. Mentions are connected to the message from the raw content with no server-membership check, and the notification-level filters are applied later in addMention. A shadow-banned sender gets a success-shaped response from the route before createMessage runs, so nothing is stored, emitted or pushed.

## Steps

1. `src/routes/channels/channelMessageCreate.ts` (`channelMessageCreate`, `route`, `queueRoute`) — Express route: middleware chain, express-validator, mute, slow mode, ticket cap, attachment and DM rules, CDN verifyUpload, shadowban fake response; then calls createMessage with the resolved channel, server and member caches. queueRoute calls route directly because the mimiqueue createQueue is commented out.
2. `src/services/Message/Message.ts` (`createMessage`, `addMention`) — createMessage is the alias `export const createMessage = createMessageV2`, so every caller (route, webhooks, Ticket, Voice, Explore) runs MessageCreate.ts. addMention (the notification step) is called from handleMessageSideEffects and applies the membership, block, bot and MUTE filters before writing messageNotification and messageMention rows.
3. `src/services/Message/MessageCreate.ts` (`createMessageV2`, `createMessageAndChannelUpdate`, `handleMessageSideEffects`) — validateMessageOptions, then one prisma.$transaction that creates the message (with mentions, roleMentions, quotedMessages, replyMessages, buttons, attachments connects) and updates channel.lastMessagedAt; then handleMessageSideEffects is fired with .then and not awaited. Inside it, the server branch awaits addMention before emitting, the DM branch awaits the messageMention upsert before emitting.
4. `src/services/Message/prepareMessageForDatabase.ts` (`prepareMessageForDatabase`, `processUserMentions`, `processQuotes`) — Parses [@:id], [r:id], [q:id] markers and replyToMessageIds into DB lookups; the results are the connect lists used by createMessageAndChannelUpdate. Only the quote lookup has a membership or inbox filter, and only when creatorId is absent.
5. `src/emits/Server.ts` (`emitServerMessageCreated`) — Socket MESSAGE_CREATED to the channel room. With a socketId the sender's socket is excluded from the room broadcast and receives its own copy with socketId in the payload. Not conditioned on message.silent.
6. `src/emits/Channel.ts` (`emitDMMessageCreated`) — DM variant: emits MESSAGE_CREATED to the user rooms of the inbox recipient and creator, not to a channel room. Not conditioned on message.silent.
7. `src/fcm/pushNotification.ts` (`sendServerPushMessageNotification`, `sendDmPushNotification`) — Firebase push, started without await from handleMessageSideEffects. Both return early when message.silent is set or fcm-credentials.json failed to load. Invalid tokens are removed through removeFCMTokens.

## Invariants

- The message row and channel.lastMessagedAt are written in one $transaction; if it fails, createMessageV2 returns "Couldn't create message" and no side effects are started.
- The route's response is produced before handleMessageSideEffects finishes, so a client cannot rely on mention notifications or the MESSAGE_CREATED socket event having happened by the time the POST returns.
- Server-channel MESSAGE_CREATED is emitted only after addMention has resolved its notification writes.
- On the DM path, a failed messageMention upsert returns early before emitDMMessageCreated and sendDmPushNotification, so no socket event or push is sent for that message.
- silent suppresses push only; the socket emits in emitServerMessageCreated and emitDMMessageCreated do not check it.
- A shadow-banned request is answered before createMessage, so no message row, mention, notification or emit exists for it.
