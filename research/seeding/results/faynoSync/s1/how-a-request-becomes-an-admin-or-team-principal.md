---
id: how-a-request-becomes-an-admin-or-team-principal
type: flow
title: "how a request becomes an admin or team principal"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/utils/auth.go","hash":"sha256:4c92a7210edb","head":"ca2f88a4fe38"}
  - {"path":"server/utils/validate.go","hash":"sha256:8046aac4b51c","head":"ca2f88a4fe38"}
  - {"path":"server/utils/session.go","hash":"sha256:0936ae7a463f","head":"ca2f88a4fe38"}
  - {"path":"server/utils/token.go","hash":"sha256:98956db93c22","head":"ca2f88a4fe38"}
  - {"path":"server/handler/sign/login.go","hash":"sha256:d0889ca7a8c5","head":"ca2f88a4fe38"}
  - {"path":"server/handler/token/create.go","hash":"sha256:6254f308d46e","head":"ca2f88a4fe38"}
  - {"path":"server/utils/permissions.go","hash":"sha256:61a5d048145d","head":"ca2f88a4fe38"}
  - {"path":"server/utils/token_scope.go","hash":"sha256:3eea7c740688","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:47.943Z
edits: 2
---

# how a request becomes an admin or team principal

AuthMiddleware accepts two credential kinds: a session JWT, re-checked on every request against the principal's stored document (token_version and username must still match), or an fns_ API token looked up by SHA-256 hash, which is turned into an admin principal named after the token's owner without any document check. Authorization downstream branches on the principal's type and _id, never on the username. Team and admin login are separate lookups in one handler, and a JWT carries only the principal id, type, version and name.

## Steps

1. `server/server.go` (`StartServer`) — builds authMiddleware and registers it with router.Use after the public routes (/download is declared before it); token-management routes add utils.AdminOnlyMiddleware on top
2. `server/utils/auth.go` (`AuthMiddleware`, `BearerToken`) — reads the Bearer header; tries ParseSessionJWT first; on a non-claims parse error with an fns_ prefix falls through to the API-token lookup; sets username, principal, and for tokens is_api_token, api_token_id, allowed_apps
3. `server/utils/validate.go` (`ValidateJWT`) — HMAC-only signature check with the JWT_SECRET key; returns wrapped errors that AuthMiddleware maps to messages
4. `server/utils/session.go` (`ParseSessionJWT`, `VerifySessionPrincipal`, `GenerateSessionJWT`, `CallerTeamUser`) — ParseSessionJWT requires sub, typ (admin or team), ver and username; VerifySessionPrincipal reads admins or team_users by _id and rejects a missing document or a token_version/username mismatch with errSessionRevoked
5. `server/utils/token.go` (`IsAPIToken`, `HashAPIToken`, `GenerateAPIToken`) — fns_ prefix test and SHA-256 hashing used for the api_tokens lookup key
6. `server/handler/sign/login.go` (`Login`) — checks admins by username first, then team_users; bcrypt compare; signs the JWT with the document's token_version; per-IP limit before body binding, per-username limit after
7. `server/handler/token/create.go` (`CreateToken`, `validateAllowedApps`) — owner comes from the context username; every allowed_apps id must be an apps_meta document with that owner and app_name set; stores only token_hash and token_prefix
8. `server/utils/permissions.go` (`CheckPermission`, `AdminOnlyMiddleware`) — CheckPermission lets an API token through only for PermissionUpload on ResourceApps and requires a non-empty allowed_apps; AdminOnlyMiddleware rejects any API token before it checks the principal type
9. `server/utils/token_scope.go` (`ValidateAPITokenAppScope`) — per-app gate for API tokens, called by handlers that are not behind CheckPermission (catalog/get.go, create/request.go, create/presigned.go); no-op for non-token requests

## Invariants

- A session JWT stops working once its principal document is deleted, its token_version changes, or its username changes (TestSession_TeamUserPasswordChangeRevokes, TestSession_RenamedTeamUserNameReused).
- A JWT without sub/typ/ver/username (a legacy token) is rejected (TestSession_LegacyTokenRejected).
- An fns_ token is checked only for its hash, expiry and the handler-level scope; it is not re-checked against the owner's admin document or token_version on this path.
- The team principal is resolved by _id; a missing team document surfaces as errSessionRevoked, never as ErrNoDocuments, because a nil TeamUser means admin to callers (CallerTeamUser).
- A session JWT stops working once its principal document is deleted or its token_version changes (TestSession_TeamUserPasswordChangeRevokes), and a username mismatch with the stored document also rejects it.
