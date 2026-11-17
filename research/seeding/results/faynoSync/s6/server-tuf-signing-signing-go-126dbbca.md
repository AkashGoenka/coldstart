---
id: server-tuf-signing-signing-go-126dbbca
type: file
character: single
title: "server/tuf/signing/signing.go"
anchors:
  - {"path":"server/tuf/signing/signing.go","symbols":["BuildSignerFromPrivateKeyFile","LoadPrivateKeyAnyFromFilesystem","LoadAndSignDelegation"],"hash":"sha256:a5ecbf4cc139","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.518Z
edits: 2
---

# server/tuf/signing/signing.go

Online private keys are read from ONLINE_KEY_DIR/<admin>/<app>/<file> (file name from keyURI after an fn: prefix, else keyID); symlinks are refused (Lstat + O_NOFOLLOW). BuildSignerFromPrivateKeyFile enforces strength (RSA >= 2048, ECDSA >= 256; Ed25519 unchecked) and requires the TUF key ID computed from the loaded key to equal root's. Signing helpers use only the first `threshold` distinct key IDs.
