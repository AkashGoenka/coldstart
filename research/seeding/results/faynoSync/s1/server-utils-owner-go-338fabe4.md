---
id: server-utils-owner-go-338fabe4
type: file
character: hub
title: "server/utils/owner.go"
anchors:
  - {"path":"server/utils/owner.go","symbols":["ResolveRequestOwner","ResolveOwnerMiddleware","RespondTeamAccessError","EnsureTeamUserAppAccess","EnsureTeamUserUploadAccess","UsernameTaken"],"hash":"sha256:8e7a20e92af2","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:17.153Z
edits: 1
---

# server/utils/owner.go

## Facets

- **ResolveRequestOwner** — The username argument is only a cross-check: it must equal the principal's name or the call errors. A team user resolves to teamUser.Owner; any other principal resolves to its own name.
- **ResolveOwnerMiddleware** — Used only by the /tuf/v1/task, /tuf/v1/artifacts/publish and /tuf/v1/artifacts/delete routes in server/tuf/tuf.go. Any error from ResolveRequestOwner, including a revoked session, becomes 500 'Failed to resolve owner', not 401.
- **RespondTeamAccessError** — Maps ErrAccessDenied to 403 with the error text, errSessionRevoked to 401, and anything else to a logged 500 'failed to check access'. A missing app row and an unlisted app return the same accessDeniedError text.
- **EnsureTeamUserAppAccess** — Returns nil when CallerTeamUser returns nil (admins and API tokens), so it binds team users only. The apps_meta lookup is by app_name and owner = teamUser.Owner; a missing row and a row not in the allowed list both return accessDeniedError.
- **EnsureTeamUserUploadAccess** — Checks app_name, channel, platform and arch from the upload params. app_name is checked even when empty; channel, platform and arch are skipped when empty. Each lookup is owner-scoped and compares the row _id hex with the team user's allowed list.
- **UsernameTaken** — Looks up admins and then team_users with CaseInsensitiveCollation (Locale en, Strength 2), excluding one team user _id when given. The code comment gives the reason: online keys live in ONLINE_KEY_DIR/<admin>/, which a case-insensitive filesystem cannot tell apart.
