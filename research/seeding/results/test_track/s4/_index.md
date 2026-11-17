# Notebook index

41 active notes (27 file · 11 flow · 3 lesson)

## Files

- [app/components/flash_component.rb](app-components-flash-component-rb-1ab8814a.md) (single)
- [app/controllers/admin/split_assignments_controller.rb](app-controllers-admin-split-assignments-controller-rb-226676e7.md) (single)
- [app/controllers/api/v2/assignment_overrides_controller.rb](app-controllers-api-v2-assignment-overrides-controller-rb-0b972d2c.md) (single)
- [app/controllers/api/v2/migrations/splits_controller.rb](app-controllers-api-v2-migrations-splits-controller-rb-4a929dc9.md) (single)
- [app/controllers/api/v3/split_registries_controller.rb](app-controllers-api-v3-split-registries-controller-rb-4010cb72.md) (single)
- [app/controllers/api/v4/app_identifiers_controller.rb](app-controllers-api-v4-app-identifiers-controller-rb-0c979d87.md) (single)
- [app/controllers/api/v4/split_registries_controller.rb](app-controllers-api-v4-split-registries-controller-rb-5fb75b1a.md) (single)
- [app/controllers/concerns/cors_support.rb](app-controllers-concerns-cors-support-rb-b3a41238.md) (single)
- [app/controllers/shared_secret_authenticated_api_controller.rb](app-controllers-shared-secret-authenticated-api-controller-r-48882c0a.md) (single)
- [app/controllers/unauthenticated_api_controller.rb](app-controllers-unauthenticated-api-controller-rb-82ba33fb.md) (single)
- [app/models/app_identifier_claim.rb](app-models-app-identifier-claim-rb-706bff97.md) (single)
- [app/models/app_remote_kill.rb](app-models-app-remote-kill-rb-db49ee53.md) (single)
- [app/models/app_version_build_path.rb](app-models-app-version-build-path-rb-e569cef4.md) (single)
- [app/models/arbitrary_assignment_creation.rb](app-models-arbitrary-assignment-creation-rb-284775b4.md) (single)
- [app/models/assignment.rb](app-models-assignment-rb-aea791e3.md) (hub) — for_presentation, excluding_incomplete_features_for, except_feature_gates
- [app/models/batch_arbitrary_assignment_creation.rb](app-models-batch-arbitrary-assignment-creation-rb-194e40ab.md) (single)
- [app/models/bulk_reassignment.rb](app-models-bulk-reassignment-rb-81623507.md) (single)
- [app/models/identifier_claim.rb](app-models-identifier-claim-rb-163aeb3f.md) (single)
- [app/models/split.rb](app-models-split-rb-ba157a17.md) (hub) — arel_excluding_incomplete_features_for, with_feature_incomplete_knockouts_for, except_feature_gates
- [app/models/split_registry.rb](app-models-split-registry-rb-ef7a24e9.md) (single)
- [app/models/split_upsert.rb](app-models-split-upsert-rb-c04fe2ee.md) (single)
- [app/models/visitor.rb](app-models-visitor-rb-ad52e812.md) (hub) — from_id
- [app/models/visitor_supersession.rb](app-models-visitor-supersession-rb-20cb2e58.md) (single)
- [app/views/admin/split_assignments/index.html.erb](app-views-admin-split-assignments-index-html-erb-34a303e0.md) (single)
- [app/views/api/v4/split_registries/show.json.jbuilder](app-views-api-v4-split-registries-show-json-jbuilder-19e7212d.md) (single)
- [config/application.rb](config-application-rb-7ff7049c.md) (hub) — config.experience_sampling_weight
- [config/routes.rb](config-routes-rb-e801163e.md) (hub) — identifier, assignment_overrides

## Flows

- [how a browser-extension assignment override gets written](how-a-browser-extension-assignment-override-gets-written.md)
- [how a build timestamp selects the split registry a client receives (v3 and v4)](how-a-build-timestamp-selects-the-split-registry-a-client-re.md)
- [how a bulk variant change rewrites existing assignments](how-a-bulk-variant-change-rewrites-existing-assignments.md)
- [how a CORS-enabled API response gets its headers and preflight](how-a-cors-enabled-api-response-gets-its-headers-and-preflig.md)
- [how a forced override reaches a visitor's config despite an incomplete feature gate](how-a-forced-override-reaches-a-visitor-s-config-despite-an.md)
- [how a remote kill removes assignments and knocks out a split's weights](how-a-remote-kill-removes-assignments-and-knocks-out-a-split.md)
- [how a split migration request becomes a split row and what it keeps](how-a-split-migration-request-becomes-a-split-row-and-what-i.md)
- [how a visitor's assignments are copied when an identifier is claimed](how-a-visitor-s-assignments-are-copied-when-an-identifier-is.md)
- [how an identifier claim decides which visitor the response is built for](how-an-identifier-claim-decides-which-visitor-the-response-i.md)
- [how EXPERIENCE_SAMPLING_WEIGHT reaches clients](how-experience-sampling-weight-reaches-clients.md)
- [how the admin split population count reaches the assignments list and its cap](how-the-admin-split-population-count-reaches-the-assignments.md)

## Lessons

- [no overridden_at or force check on remote kills in this repo](no-overridden-at-or-force-check-on-remote-kills-in-this-repo.md) (absence)
- [no request specs for the split registry endpoints](no-request-specs-for-the-split-registry-endpoints.md) (absence)
- [no request throttling in this repo](no-request-throttling-in-this-repo.md) (absence)
