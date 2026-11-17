---
id: server-utils-session-go-b764450b
type: file
character: single
title: "server/utils/session.go"
anchors:
  - {"path":"server/utils/session.go","symbols":["VerifySessionPrincipal","CallerTeamUser","GenerateSessionJWT"],"hash":"sha256:0936ae7a463f","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:17.138Z
edits: 4
---

# server/utils/session.go

A session JWT's sub is the principal's _id and the username claim is only compared, never used to find the principal: VerifySessionPrincipal loads the document by _id from team_users or admins and returns errSessionRevoked if it is gone or its token_version or username differs. CallerTeamUser follows the same pattern and converts a missing team_users document into errSessionRevoked instead of ErrNoDocuments, because its callers read ErrNoDocuments as 'this is an admin'. server/utils/session_test.go (TestSession_DeletedTeamUserRecreatedByOtherTenant) asserts 401 for the old token after the team user is deleted and the name is reused in another tenant.
