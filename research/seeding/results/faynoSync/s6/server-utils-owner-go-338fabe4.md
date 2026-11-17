---
id: server-utils-owner-go-338fabe4
type: file
character: single
title: "server/utils/owner.go"
anchors:
  - {"path":"server/utils/owner.go","symbols":["ResolveRequestOwner","ResolveOwnerMiddleware","EnsureTeamUserAppAccess","EnsureTeamUserUploadAccess","UsernameTaken"],"hash":"sha256:8e7a20e92af2","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.417Z
edits: 2
---

# server/utils/owner.go

Tenant resolution: ResolveRequestOwner maps a team principal to teamUser.Owner and any other principal to its own name, and refuses when the passed username differs from the principal's. ResolveOwnerMiddleware maps every error, including a revoked team user, to 500 'Failed to resolve owner', while RespondTeamAccessError maps errSessionRevoked to 401. EnsureTeamUserAppAccess denies when Apps.Allowed is empty; EnsureTeamUserUploadAccess always checks app_name but skips empty channel/platform/arch, and matches the arch parameter against arch_id. UsernameTaken compares admins then team_users case-insensitively because ONLINE_KEY_DIR/<admin>/ cannot tell case variants apart on case-insensitive filesystems.
