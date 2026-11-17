---
id: src-common-bitwise-ts-722186d0
type: file
character: hub
title: "src/common/Bitwise.ts"
anchors:
  - {"path":"src/common/Bitwise.ts","symbols":["ROLE_PERMISSIONS","CHANNEL_PERMISSIONS"],"hash":"sha256:58a4d72b35ea","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:07.339Z
edits: 1
---

# src/common/Bitwise.ts

## Facets

- **ROLE_PERMISSIONS** — ADMIN is bit 1 (1 << 0) and is the bypass in every role-layer check. It is a different thing from USER_BADGES.ADMIN (bit 2), a site-wide badge that only the ticket branch of channelVerification and isUserAdmin read.
- **CHANNEL_PERMISSIONS** — PUBLIC_CHANNEL (1), SEND_MESSAGE (2) and JOIN_VOICE (4) are bits of the per-member channel mask only. They are allow bits: the schema stores allow masks and the merge is OR, so there is no deny bit.
