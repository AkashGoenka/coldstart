---
id: app-components-flash-component-rb-1ab8814a
type: file
character: single
title: "app/components/flash_component.rb"
anchors:
  - {"path":"app/components/flash_component.rb","symbols":["flash_types","render?"],"hash":"sha256:22db2159edc4","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:33.875Z
edits: 1
---

# app/components/flash_component.rb

Only the keys listed in `flash_types` render, because the template loops over that list and ignores every other flash key, so a new `flash.now[:x]` must have `:x` added here or it disappears silently. `render?` is false when the flash is empty. `scheme_types` maps only `error` to Primer's `danger`; other types pass through unchanged, which is how `flash.now[:warning]` from the admin assignments page is styled.
