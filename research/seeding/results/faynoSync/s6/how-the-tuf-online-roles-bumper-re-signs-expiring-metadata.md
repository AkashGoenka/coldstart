---
id: how-the-tuf-online-roles-bumper-re-signs-expiring-metadata
type: flow
title: "how the TUF online roles bumper re-signs expiring metadata"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/metadata/online_bump.go","hash":"sha256:0bf9b6951bf0","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/metadata/metadata_online.go","hash":"sha256:6b4681705fc5","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/metadata/locking.go","hash":"sha256:c8092da1745d","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/metadata/resign_verify.go","hash":"sha256:3cf5b32addee","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/signing/signing.go","hash":"sha256:a5ecbf4cc139","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/metadata/root_anchor.go","hash":"sha256:03fe135bcd6b","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/storage/storage.go","hash":"sha256:b4d51fed1c86","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/metadata/metadata_utils.go","hash":"sha256:0fd60f487182","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.368Z
edits: 1
---

# how the TUF online roles bumper re-signs expiring metadata

The bumper runs inside the API process, started by StartServer only when TUF_ENABLED is set, and nothing in the HTTP routes triggers it; one replica per 5-minute window does the work by winning a Redis SETNX on TUF_ONLINE_BUMP_TICK. Every re-sign (bump, forced POST /tuf/v1/metadata/online, artifact add/delete, root/targets finalize) runs under the Redis lease LOCK_SNAPSHOT_<admin>_<app>.

## Steps

1. `server/server.go` (`StartServer`) — starts the bumper with context.Background(), never cancelled
2. `server/tuf/metadata/online_bump.go` (`StartOnlineRolesBumper`, `bumpExpiringOnlineRoles`) — per app, gated on BOOTSTRAP_<admin>_<app> being complete; selects roles expiring within 1h; offline targets are skipped
3. `server/tuf/metadata/metadata_online.go` (`forceOnlineMetadataUpdateLocked`) — re-signs selected roles with keys from the anchored root
4. `server/tuf/metadata/locking.go` (`WithSnapshotLock`) — Redis SET NX lease, 300s TTL, renewed every 100s, token-checked release
5. `server/tuf/metadata/resign_verify.go` (`VerifyForResign`) — stored role must verify under current or an earlier anchored root; expiry deliberately not checked
6. `server/tuf/signing/signing.go` (`BuildSignerFromPrivateKeyFile`) — loads ONLINE_KEY_DIR/<admin>/<app>/<keyid>; computed key ID must equal root's
7. `server/tuf/metadata/root_anchor.go` (`LoadAnchoredRoot`) — TRUSTED_ROOTS_<admin>_<app> anchor, trust on first use

## Invariants

- A BOOTSTRAP value that is empty or starts with pre-/signing- keeps the bumper away from that app
- If a targets/delegated re-sign fails, the bumper retries with only snapshot and timestamp
