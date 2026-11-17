---
id: src-services-serverrole-ts-a5aace8d
type: file
character: single
title: "src/services/ServerRole.ts"
anchors:
  - {"path":"src/services/ServerRole.ts","symbols":["createServerRole","updateServerRole","deleteServerRole","updateServerRoleOrder"],"hash":"sha256:4409d191c09f","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.953Z
edits: 2
---

# src/services/ServerRole.ts

createServerRole does no permission check (the route chain does). It enforces a role cap only when opts.bot is unset (200 for verified servers, else env.MAX_ROLES_PER_SERVER), inserts the new role at order 2 and renumbers the others to order i+3 in one transaction, then clears the whole server member hash, emits and writes the audit log without await (skipped for bot roles). create, update, delete and updateServerRoleOrder each clear the member hash; only deleteServerRole also clears channel permission hashes, for channels with an override row for that role. deleteServerRole strips the role id from members in the same transaction and refuses bot roles unless forceDeleteBotRole is passed.
