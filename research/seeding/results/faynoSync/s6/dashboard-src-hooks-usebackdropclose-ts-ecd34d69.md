---
id: dashboard-src-hooks-usebackdropclose-ts-ecd34d69
type: file
character: single
title: "dashboard/src/hooks/useBackdropClose.ts"
anchors:
  - {"path":"dashboard/src/hooks/useBackdropClose.ts","symbols":["useBackdropClose"],"hash":"sha256:bc09488a7962","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T16:11:16.734Z
edits: 1
---

# dashboard/src/hooks/useBackdropClose.ts

The hook closes only when the press and the click both land on the element itself: onMouseDown records whether e.target === e.currentTarget, and onClick calls onClose only when that recorded press and the click target are both the backdrop. A press that starts inside the dialog and is released on the backdrop therefore does not close it. The enabled argument gates only onClick; onMouseDown always records the press.
