---
id: how-a-channel-route-decides-whether-a-member-may-act-in-a-ch
type: flow
title: "how a channel route decides whether a member may act in a channel"
anchors:
  - {"path":"src/middleware/channelVerification.ts","hash":"sha256:a4fa97aa5bd6","head":"feb30ff9ac54"}
  - {"path":"src/cache/ChannelCache.ts","hash":"sha256:0ed495573d75","head":"feb30ff9ac54"}
  - {"path":"src/cache/ServerMemberCache.ts","hash":"sha256:d6fb169d0335","head":"feb30ff9ac54"}
  - {"path":"src/middleware/channelPermissions.ts","hash":"sha256:f495e5496f26","head":"feb30ff9ac54"}
  - {"path":"src/middleware/memberHasRolePermission.ts","hash":"sha256:64d9209e9c76","head":"feb30ff9ac54"}
  - {"path":"src/common/Bitwise.ts","hash":"sha256:58a4d72b35ea","head":"feb30ff9ac54"}
  - {"path":"src/routes/channels/channelMessageCreate.ts","hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
  - {"path":"src/services/Channel.ts","hash":"sha256:260b96bf059b","head":"feb30ff9ac54"}
  - {"path":"src/services/ServerRole.ts","hash":"sha256:4409d191c09f","head":"feb30ff9ac54"}
  - {"path":"src/services/ServerMember.ts","hash":"sha256:57f8fdd81b4b","head":"feb30ff9ac54"}
  - {"path":"src/services/Server.ts","hash":"sha256:792485ceaf54","head":"feb30ff9ac54"}
  - {"path":"prisma/schema.prisma","hash":"sha256:f190ccb2edee","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:07.310Z
edits: 1
---

# how a channel route decides whether a member may act in a channel

Channel access is gated by two bit layers that are never merged: the per-channel mask (role channel-permission rows OR-ed per member, cached in Redis) and the server-wide role mask (ServerMemberCache); the server owner and any member whose role mask has the ADMIN bit skip both. channelVerification runs first and always adds a PUBLIC_CHANNEL test on top of the route's own bit, then the route's channelPermissions bit, then memberHasRolePermissionMiddleware for the role bit (channelMessageCreate is the full chain). DM and ticket channels have no server, so the channel-mask and role gates pass through and their checks live in channelVerification (inbox recipient or creator for DM; creator or site-wide ADMIN/FOUNDER user badge for tickets).

## Steps

1. `src/middleware/channelVerification.ts` (`channelVerification`) — entry gate for /channels/:channelId routes: loads channel and member, sets req.serverCache and req.serverMemberCache for server channels, then runs the PUBLIC_CHANNEL check
2. `src/cache/ChannelCache.ts` (`getChannelForUserCache`, `setServerChannelMemberPermissions`) — returns the channel and this member's channel mask from the Redis hash, recomputing it from role rows on a miss
3. `src/cache/ServerMemberCache.ts` (`getServerMemberCache`) — supplies req.serverMemberCache.permissions, the OR of the member's role masks plus the default role
4. `src/middleware/channelPermissions.ts` (`channelPermissions`) — owner and ADMIN bypass, then tests one bit of the channel mask
5. `src/middleware/memberHasRolePermission.ts` (`memberHasRolePermissionMiddleware`, `memberHasRolePermission`) — second gate on the server role mask, same owner and ADMIN bypass; passes when req.serverCache is unset
6. `src/common/Bitwise.ts` (`ROLE_PERMISSIONS`, `CHANNEL_PERMISSIONS`, `hasBit`) — bit values: role bits are 1 shifted left n, channel bits are PUBLIC_CHANNEL 1, SEND_MESSAGE 2, JOIN_VOICE 4
7. `src/routes/channels/channelMessageCreate.ts` (`channelMessageCreate`) — reference chain for POST /channels/:channelId/messages: channelVerification, channelPermissions(SEND_MESSAGE), memberHasRolePermissionMiddleware(ROLE_PERMISSIONS.SEND_MESSAGE)

## Invariants

- Channel masks are allow-only: ServerChannelPermissions.permissions is one nullable allow Int per role and channel, and the member mask is the OR of the rows for the member's roles, so no role can remove a bit another role grants.
- The member channel-mask hash is dropped only by the callers of removeServerMemberPermissionsCache: Channel.ts updateServerChannelPermissions (whole channel), ServerRole.ts deleteServerRole (channels that had a row for the role), ServerMember.ts updateServerMember when roleIds change, addWelcomeAnswerRolesToUser and removeWelcomeAnswerRolesFromUser, and Server.ts leaveServer (that user, all channels). A cached hash hit is returned as-is, so a role change that skips these calls keeps serving the old mask.
- The server role mask (ServerMemberCache hash) is a separate cache, cleared by deleteAllServerMemberCache or deleteServerMemberCache at the matching role and member call sites; clearing one does not clear the other.
- In both channelPermissions and memberHasRolePermission the owner and ROLE_PERMISSIONS.ADMIN bypass runs before any bit is read. The ADMIN bit here is role bit 1 shifted by 0, not the site-wide USER_BADGES.ADMIN.
