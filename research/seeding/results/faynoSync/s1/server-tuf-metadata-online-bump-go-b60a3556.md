---
id: server-tuf-metadata-online-bump-go-b60a3556
type: file
character: single
title: "server/tuf/metadata/online_bump.go"
anchors:
  - {"path":"server/tuf/metadata/online_bump.go","symbols":["StartOnlineRolesBumper","runOnlineBumpTick","bumpExpiringOnlineRoles","expiringOnlineRoles","IsValidDelegatedRoleName"],"hash":"sha256:0bf9b6951bf0","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:58.602Z
edits: 1
---

# server/tuf/metadata/online_bump.go

StartOnlineRolesBumper is started from server.go only when TUF_ENABLED is set; it runs one tick at once and then every 5 minutes. A tick proceeds only if SetNX on TUF_ONLINE_BUMP_TICK wins (TTL 4m30s, deliberately never released), and every apps_meta document with an app_name is considered, not only tuf:true apps. bumpExpiringOnlineRoles skips an app whose BOOTSTRAP_ value is missing or starts with pre- or signing-, logging a warning that asks for bootstrap recovery when the app is tuf:true. expiringOnlineRoles walks timestamp, then snapshot, then each role's header in S3 and marks roles expiring within one hour; it does not check signatures, which its comment leaves to the bump path, and it skips targets with a warning when TARGETS_ONLINE_KEY_ is false. If a re-sign that includes targets or delegated roles fails, it retries with snapshot and timestamp only so an expiring timestamp is still refreshed.
