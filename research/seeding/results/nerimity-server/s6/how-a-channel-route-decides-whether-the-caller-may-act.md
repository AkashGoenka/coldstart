---
id: how-a-channel-route-decides-whether-the-caller-may-act
type: flow
title: "how a channel route decides whether the caller may act"
anchors:
  - {"path":"src/middleware/channelVerification.ts","hash":"sha256:a4fa97aa5bd6","head":"feb30ff9ac54"}
  - {"path":"src/middleware/channelPermissions.ts","hash":"sha256:f495e5496f26","head":"feb30ff9ac54"}
  - {"path":"src/middleware/memberHasRolePermission.ts","hash":"sha256:64d9209e9c76","head":"feb30ff9ac54"}
  - {"path":"src/cache/ChannelCache.ts","hash":"sha256:0ed495573d75","head":"feb30ff9ac54"}
  - {"path":"src/cache/ServerMemberCache.ts","hash":"sha256:d6fb169d0335","head":"feb30ff9ac54"}
  - {"path":"src/common/Bitwise.ts","hash":"sha256:58a4d72b35ea","head":"feb30ff9ac54"}
  - {"path":"src/common/serverMembeHasPermission.ts","hash":"sha256:7b2957b703fd","head":"feb30ff9ac54"}
  - {"path":"src/routes/channels/channelMessageCreate.ts","hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
  - {"path":"src/services/ServerRole.ts","hash":"sha256:4409d191c09f","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.025Z
edits: 1
---

# how a channel route decides whether the caller may act

Channel routes run two permission layers in a fixed order, and the per-channel override bit is checked before the server role bit: channelVerification ends by calling channelPermissions(PUBLIC_CHANNEL), the route then adds channelPermissions(channel bit) and then memberHasRolePermissionMiddleware(role bit). The server owner (serverCache.createdById) and members with the role ADMIN bit pass both layers without the bit; DM and ticket channels have no server, so both layers return next() and only channelVerification's DM/ticket checks decide access. Role bits and channel overrides live in two separate redis hashes with separate invalidation.

## Steps

1. `src/middleware/channelVerification.ts` (`channelVerification`) — loads req.channelCache, req.serverCache, req.serverMemberCache; DM recipient and ticket-creator checks; scheduled-deletion 403; then PUBLIC_CHANNEL check
2. `src/middleware/channelPermissions.ts` (`channelPermissions`) — owner and role-ADMIN bypass, then tests the bit on req.channelCache.permissions
3. `src/middleware/memberHasRolePermission.ts` (`memberHasRolePermissionMiddleware`, `memberHasRolePermission`) — owner and ADMIN bypass, then tests the aggregated bit on req.serverMemberCache.permissions
4. `src/cache/ChannelCache.ts` (`getChannelForUserCache`, `setServerChannelMemberPermissions`, `removeServerMemberPermissionsCache`) — per-channel hash of member override bits
5. `src/cache/ServerMemberCache.ts` (`getServerMemberCache`, `deleteAllServerMemberCache`) — per-server hash of member role-bit OR
6. `src/common/Bitwise.ts` (`ROLE_PERMISSIONS`, `CHANNEL_PERMISSIONS`, `USER_BADGES`) — bit tables; ADMIN exists in both the role and badge namespaces

## Invariants

- A change to role permissions or membership must clear the member hash (deleteAllServerMemberCache); a change to channel overrides or role ids must clear the channel permission hash (removeServerMemberPermissionsCache), or old bits keep being enforced.
- Role checks must use ROLE_PERMISSIONS.ADMIN.bit, not USER_BADGES.ADMIN (site badge, different bit).
- Code outside the middleware (Channel.ts, emits/Server.ts, fcm/pushNotification.ts, onAuthenticate.ts) calls serverMemberHasPermission, which has no owner check, so each caller tests the owner first.
