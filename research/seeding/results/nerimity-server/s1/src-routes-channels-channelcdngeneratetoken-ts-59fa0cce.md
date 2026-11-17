---
id: src-routes-channels-channelcdngeneratetoken-ts-59fa0cce
type: file
character: single
title: "src/routes/channels/ChannelCdnGenerateToken.ts"
anchors:
  - {"path":"src/routes/channels/ChannelCdnGenerateToken.ts","symbols":["ChannelCdnGenerateToken","isSupporterOrModerator"],"hash":"sha256:72adc9045cb8","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:17.334Z
edits: 1
---

# src/routes/channels/ChannelCdnGenerateToken.ts

POST /api/channels/:channelId/cdn/token runs channelVerification and a 5-per-30s rate limit, then mints a token with channelId passed to generateToken. Before minting it returns the nerimitySupporterCdnMessage 400 unless the caller has the MOD badge, in two cases: the server is not public and the caller is not a supporter, founder or admin; or the channel is SERVER_TEXT, not canBePublic, and the caller is not a supporter, founder or admin. channelMessageCreate.ts repeats these checks when the message is sent.
