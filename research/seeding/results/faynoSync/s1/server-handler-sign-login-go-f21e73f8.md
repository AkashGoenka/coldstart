---
id: server-handler-sign-login-go-f21e73f8
type: file
character: single
title: "server/handler/sign/login.go"
anchors:
  - {"path":"server/handler/sign/login.go","symbols":["Login"],"hash":"sha256:d0889ca7a8c5","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:47.928Z
edits: 3
---

# server/handler/sign/login.go

Login looks the username up in admins first and only then in team_users, so a team user whose name matches an admin cannot log in at all: the admin branch returns on a password failure and never reaches the team branch. Unknown usernames still run a bcrypt compare against a dummy hash, so response time does not reveal which usernames exist. The JWT is signed with the matched document's token_version, which is what later revokes it.
