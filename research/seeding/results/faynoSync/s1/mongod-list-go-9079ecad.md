---
id: mongod-list-go-9079ecad
type: file
character: single
title: "mongod/list.go"
anchors:
  - {"path":"mongod/list.go","symbols":["listItems","ListApps"],"hash":"sha256:024eb33d8c29","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:17.148Z
edits: 1
---

# mongod/list.go

listItems is the only access gate on GET /app/list, /channel/list, /platform/list and /arch/list, which server/server.go registers without CheckPermission. A team user gets an empty result when its allowed list for the resource is empty; otherwise the query is _id $in the allowed ids plus owner = teamUser.Owner. Every other caller takes the non-team branch and gets rows whose owner equals the name passed in; that branch does not read allowed_apps from the gin context, and an fns_ API token's principal is admin, so a token listing goes through this branch.
