---
id: src-cache-voicecache-ts-68976d0a
type: file
character: single
title: "src/cache/VoiceCache.ts"
anchors:
  - {"path":"src/cache/VoiceCache.ts","hash":"sha256:4b357c5cf50e","head":"feb30ff9ac54","symbols":["VoiceCache","VoiceCacheFormatted","isUserInVoice","getVoiceUserByUserId","removeVoiceUserByUserId","addUserToVoice","countVoiceUsersInChannel","getVoiceUsersByChannelId"]}
status: active
updated: 2026-11-17T03:24:47.359Z
edits: 3
---

# src/cache/VoiceCache.ts

Membership is two Redis structures: VOICE_USER_CHANNEL_ID_SET(userId) holds the channel id as a plain string, and VOICE_USERS_KEY_HASH(channelId) maps userId to a JSON {socketId, serverId}. addUserToVoice overwrites the user's channel key but does not remove a hash entry in a previous channel, so it relies on callers leaving first, which joinVoiceChannel does. removeVoiceUserByUserId reads the channel id with a GET outside its MULTI. getVoiceUsersByChannelId sets socketId to undefined on each entry it returns, and the object addUserToVoice returns also omits socketId.
