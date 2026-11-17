---
id: src-common-env-ts-2b79bc4d
type: file
character: single
title: "src/common/env.ts"
anchors:
  - {"path":"src/common/env.ts","symbols":["TYPE","CLUSTER_INDEX"],"hash":"sha256:441ad23aa05d","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:52.830Z
edits: 1
---

# src/common/env.ts

TYPE is the only process-type switch: it is 'ws' when process.argv contains '--ws' and 'api' for every other argv, so the '--api' flag that the npm scripts pass changes nothing, and a process started without --ws is an api process. Cluster children inherit argv, so workers resolve the same TYPE as their primary. CLUSTER_INDEX is passed by the primary's cluster.fork call in src/index.ts, and src/common/flakeId.ts uses 42 + CLUSTER_INDEX as the flake machine id, so an api worker and a ws worker with the same index get the same machine id.
