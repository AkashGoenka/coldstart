---
id: server-tuf-metadata-online-bump-go-b60a3556
type: file
character: single
title: "server/tuf/metadata/online_bump.go"
anchors:
  - {"path":"server/tuf/metadata/online_bump.go","symbols":["StartOnlineRolesBumper","bumpExpiringOnlineRoles","acquireOnlineBumpTick","expiringOnlineRoles"],"hash":"sha256:0bf9b6951bf0","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.490Z
edits: 2
---

# server/tuf/metadata/online_bump.go

Ticks immediately and then every 5 minutes; the tick claim is SETNX TUF_ONLINE_BUMP_TICK with TTL interval minus 30s and is never released (a replica that crashes after claiming skips that window). It walks every apps_meta doc with an app_name (not only tuf:true) and skips apps whose BOOTSTRAP_<admin>_<app> is empty, pre- or signing- prefixed; roles expiring within 1h are selected via timestamp -> snapshot -> role files, and an offline targets role is skipped with a warning while delegated roles are still selected.
