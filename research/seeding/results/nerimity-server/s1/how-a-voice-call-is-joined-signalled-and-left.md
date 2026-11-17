---
id: how-a-voice-call-is-joined-signalled-and-left
type: flow
title: "how a voice call is joined, signalled and left"
anchors:
  - {"path":"src/routes/channels/channelVoiceJoin.ts","hash":"sha256:db5e52be489b","head":"feb30ff9ac54"}
  - {"path":"src/services/Voice.ts","hash":"sha256:91045b3802ea","head":"feb30ff9ac54"}
  - {"path":"src/cache/UserCache.ts","hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
  - {"path":"src/cache/VoiceCache.ts","hash":"sha256:4b357c5cf50e","head":"feb30ff9ac54"}
  - {"path":"src/emits/Voice.ts","hash":"sha256:9c2da45a654d","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onConnection.ts","hash":"sha256:f1c7a9691ac0","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onVoiceSignal.ts","hash":"sha256:3fe7028d1ce7","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onDisconnect.ts","hash":"sha256:f1faaf463fff","head":"feb30ff9ac54"}
  - {"path":"src/routes/channels/channelVoiceLeave.ts","hash":"sha256:46a707077569","head":"feb30ff9ac54"}
  - {"path":"src/routes/channels/channelVoiceGenerateCredentials.ts","hash":"sha256:5054c8aef01a","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:41.894Z
edits: 1
---

# how a voice call is joined, signalled and left

Voice membership is pinned to one socket: the HTTP join stores the caller-supplied socketId in VoiceCache, and both the signal relay and the disconnect cleanup act only when the socket they see equals that stored socketId. The join checks only that the supplied socketId maps to the same user in Redis, so any socket the user has connected can be designated at join time. Joining calls leaveVoiceChannel on any current call before the target channel is validated, so a join that then fails has already ended the previous call.

## Steps

1. `src/routes/channels/channelVoiceJoin.ts` (`channelVoiceJoin`) — HTTP gate: authenticate, channel JOIN_VOICE permission, rate limit, socketId validation; a shadow-banned caller gets success without joining
2. `src/services/Voice.ts` (`joinVoiceChannel`) — checks socketId maps to the caller, leaves any current call, validates the channel and DM block, starts the call message, then writes membership and emits joined
3. `src/cache/UserCache.ts` (`getUserIdBySocketId`, `socketDisconnect`) — the socket-to-user Redis mapping that the join gate reads and that disconnect removes
4. `src/cache/VoiceCache.ts` (`addUserToVoice`) — writes the user-to-channel key and the channel hash entry (socketId, serverId) in one MULTI
5. `src/emits/Voice.ts` (`emitServerVoiceUserJoined`, `emitDMVoiceUserJoined`) — broadcasts the joined event to the channel room, or to the two DM user ids
6. `src/socket/events/onConnection.ts` (`onConnection`) — registers voice:signal_send and the socket disconnect handler on every socket
7. `src/socket/events/onVoiceSignal.ts` (`onVoiceSignal`) — relays a signal to the recipient's stored socketId when the sender's socket is the voice socket and both are in the same channel
8. `src/socket/events/onDisconnect.ts` (`onDisconnect`) — leaves voice if the disconnecting socket is the stored voice socket
9. `src/routes/channels/channelVoiceLeave.ts` (`channelVoiceLeave`) — HTTP leave; passes only the caller id to leaveVoiceChannel, not the URL channel
10. `src/services/Voice.ts` (`leaveVoiceChannel`) — removes the user's entry and emits left; also reached from server leave, DM close and disconnect
11. `src/routes/channels/channelVoiceGenerateCredentials.ts` (`voiceGenerateCredentials`) — TURN credential route, separate from call membership; it asks Cloudflare via generateTurnCredentials

## Invariants

- A user has at most one voice entry: the user-to-channel key names the channel and the channel hash holds that user's socketId and serverId.
- joinVoiceChannel accepts a socketId only when getUserIdBySocketId returns the caller's id.
- onVoiceSignal and the disconnect cleanup require socket.id to equal the socketId stored in VoiceCache at join time.
- The joined emit carries the membership record from addUserToVoice, which has no socketId.
