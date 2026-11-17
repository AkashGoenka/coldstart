---
id: how-variant-screenshots-and-split-details-are-stored-papercl
type: flow
title: "how variant screenshots and split details are stored (Paperclip attachments)"
anchors:
  - {"path":"lib/test_track/attachment_settings.rb","hash":"sha256:c065313c7b57","head":"435fea8235b5"}
  - {"path":"config/initializers/paperclip.rb","hash":"sha256:37d7dc247c43","head":"435fea8235b5"}
  - {"path":"app/models/variant_detail.rb","hash":"sha256:b8ec0ea63583","head":"435fea8235b5"}
  - {"path":"app/models/split_detail.rb","hash":"sha256:8c7502810036","head":"435fea8235b5"}
  - {"path":"app/models/concerns/delegate_attribute.rb","hash":"sha256:de9a022c27a3","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.890Z
edits: 1
---

# how variant screenshots and split details are stored (Paperclip attachments)

Variant screenshots use kt-paperclip configured at boot from TestTrack::AttachmentSettings: storage is S3 only if ATTACHMENT_STORAGE=s3 AND AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and S3_ATTACHMENT_BUCKET are all set (otherwise it logs an error and attachments_enabled? is false), 'local' writes to public/system, and in the test env storage is always local. Max size defaults to 512KB (ATTACHMENT_MAX_SIZE) and only png/jpeg/gif accepted. SplitDetail is a non-persisted form object that delegates its fields onto Split via DelegateAttribute, so validation errors map back to split attributes; hypothesis/criteria/etc. are only required if previously present, so details can be blank initially.

## Steps

1. `lib/test_track/attachment_settings.rb` (`AttachmentSettings`, `storage_strategy`, `s3_enabled?`) — storage selection
2. `config/initializers/paperclip.rb` (`default_options`) — applies settings globally
3. `app/models/variant_detail.rb` (`VariantDetail`) — screenshot validation, retirable? = weight 0 with remaining assignments
4. `app/models/split_detail.rb` (`SplitDetail`) — form object over Split

## Invariants

- S3 default permission is private
