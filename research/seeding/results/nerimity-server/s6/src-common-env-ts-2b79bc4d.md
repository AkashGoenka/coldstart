---
id: src-common-env-ts-2b79bc4d
type: file
character: single
title: "src/common/env.ts"
anchors:
  - {"path":"src/common/env.ts","symbols":["TYPE","ORIGIN"],"hash":"sha256:441ad23aa05d","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.811Z
edits: 2
---

# src/common/env.ts

TYPE is 'ws' only when process.argv includes --ws; any other invocation (including the --api in package.json scripts) is 'api'. No required variable is validated at load: values are cast with 'as string' and a missing one surfaces later in its consumer (DATABASE_URL in database.ts). ORIGIN unset falls back to '*' with a warning; a value starting with '[' is parsed as a JSON array.
