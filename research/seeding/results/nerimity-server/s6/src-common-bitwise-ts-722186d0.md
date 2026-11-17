---
id: src-common-bitwise-ts-722186d0
type: file
character: hub
title: "src/common/Bitwise.ts"
anchors:
  - {"path":"src/common/Bitwise.ts","symbols":["ROLE_PERMISSIONS","USER_BADGES","CHANNEL_PERMISSIONS"],"hash":"sha256:58a4d72b35ea","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.868Z
edits: 2
---

# src/common/Bitwise.ts

## Facets

- **ROLE_PERMISSIONS** — Nine bits, 1<<0 ADMIN through 1<<8 MENTION_ROLES. Role checks must use ROLE_PERMISSIONS.ADMIN.bit.
- **USER_BADGES** — Site-level badges also have an ADMIN (bit 2) and FOUNDER and MOD (64); isUserAdmin tests this namespace, not the server role ADMIN bit. Moderation and ticket access are decided from it.
- **CHANNEL_PERMISSIONS** — Only bits 1, 2 and 4 (PUBLIC_CHANNEL, SEND_MESSAGE, JOIN_VOICE). The descriptions say admins bypass them, but the bypass is implemented in channelPermissions, not in the bit values.
