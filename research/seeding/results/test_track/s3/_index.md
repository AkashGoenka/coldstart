# Notebook index

53 active notes (30 file · 17 flow · 6 lesson)

## Files

- [app/controllers/admins/omniauth_callbacks_controller.rb](app-controllers-admins-omniauth-callbacks-controller-rb-4e978d56.md) (single)
- [app/controllers/api/v1/assignment_events_controller.rb](app-controllers-api-v1-assignment-events-controller-rb-7fd3feaa.md) (single)
- [app/controllers/api/v4/split_registries_controller.rb](app-controllers-api-v4-split-registries-controller-rb-5fb75b1a.md) (single)
- [app/controllers/authenticated_api_controller.rb](app-controllers-authenticated-api-controller-rb-bd946287.md) (single)
- [app/controllers/concerns/cors_support.rb](app-controllers-concerns-cors-support-rb-b3a41238.md) (single)
- [app/controllers/shared_secret_authenticated_api_controller.rb](app-controllers-shared-secret-authenticated-api-controller-r-48882c0a.md) (single)
- [app/models/admin.rb](app-models-admin-rb-dfae316f.md) (single)
- [app/models/app_feature_completion_migration.rb](app-models-app-feature-completion-migration-rb-9b559e69.md) (single)
- [app/models/app_feature_completion.rb](app-models-app-feature-completion-rb-1c0b04aa.md) (single)
- [app/models/app_identifier_claim.rb](app-models-app-identifier-claim-rb-706bff97.md) (single)
- [app/models/app.rb](app-models-app-rb-b9767b41.md) (hub) — define_build, auth_secret_must_be_sufficiently_strong
- [app/models/app_remote_kill_migration.rb](app-models-app-remote-kill-migration-rb-f78f20fc.md) (single)
- [app/models/app_remote_kill.rb](app-models-app-remote-kill-rb-db49ee53.md) (single)
- [app/models/app_version_build_path.rb](app-models-app-version-build-path-rb-e569cef4.md) (single)
- [app/models/app_version.rb](app-models-app-version-rb-f2b1cfcf.md) (single)
- [app/models/arbitrary_assignment_creation.rb](app-models-arbitrary-assignment-creation-rb-284775b4.md) (single)
- [app/models/assignment.rb](app-models-assignment-rb-aea791e3.md) (single) — excluding_decision_overrides, for_presentation, unsynced?
- [app/models/bulk_assignment_creation.rb](app-models-bulk-assignment-creation-rb-151de5f4.md) (single)
- [app/models/bulk_reassignment.rb](app-models-bulk-reassignment-rb-81623507.md) (single)
- [app/models/deterministic_assignment_creation.rb](app-models-deterministic-assignment-creation-rb-b18784bc.md) (single)
- [app/models/identifier_claim.rb](app-models-identifier-claim-rb-163aeb3f.md) (single)
- [app/models/split_decision_migration.rb](app-models-split-decision-migration-rb-8cdb19d3.md) (single)
- [app/models/split.rb](app-models-split-rb-ba157a17.md) (hub) — active, reassign_weight, registry, registry_must_have_winning_variant_if_decided, registry_weights_must_be_integers, for_presentation, with_feature_incomplete_knockouts_for, with_remote_kill_knockouts_for, knock_out_weightings
- [app/models/split_registry.rb](app-models-split-registry-rb-ef7a24e9.md) (single)
- [app/models/split_upsert.rb](app-models-split-upsert-rb-c04fe2ee.md) (single)
- [app/models/variant_calculator.rb](app-models-variant-calculator-rb-40367afb.md) (single)
- [app/models/variant_retirement.rb](app-models-variant-retirement-rb-7b219332.md) (single)
- [app/models/visitor_lookup.rb](app-models-visitor-lookup-rb-839b1d02.md) (single)
- [app/models/visitor_supersession.rb](app-models-visitor-supersession-rb-20cb2e58.md) (single)
- [app/types/app_version_type.rb](app-types-app-version-type-rb-c187ea06.md) (single)

## Flows

- [how a bulk assignment supersedes existing assignments](how-a-bulk-assignment-supersedes-existing-assignments.md)
- [how a Chrome extension assignment override is authenticated and written](how-a-chrome-extension-assignment-override-is-authenticated.md)
- [how a decision hides earlier assignments](how-a-decision-hides-earlier-assignments.md)
- [how a new API version is wired (adding v5)](how-a-new-api-version-is-wired-adding-v5.md)
- [how a second visitor claiming an identifier merges into the existing visitor](how-a-second-visitor-claiming-an-identifier-merges-into-the.md)
- [how a split decision takes effect on existing assignments and client registries](how-a-split-decision-takes-effect-on-existing-assignments-an.md)
- [how a split weight change reaches running assignments](how-a-split-weight-change-reaches-running-assignments.md)
- [how a variant retirement moves existing assignments to the remaining variants](how-a-variant-retirement-moves-existing-assignments-to-the-r.md)
- [how a visitor gets assigned a variant of a split](how-a-visitor-gets-assigned-a-variant-of-a-split.md)
- [how an app build decides which splits a client receives](how-an-app-build-decides-which-splits-a-client-receives.md)
- [how API requests are authenticated per endpoint](how-api-requests-are-authenticated-per-endpoint.md)
- [how assignment_event assigns a visitor deterministically](how-assignment-event-assigns-a-visitor-deterministically.md)
- [how experience_sampling_weight reaches clients](how-experience-sampling-weight-reaches-clients.md)
- [how explicit variant overrides are recorded](how-explicit-variant-overrides-are-recorded.md)
- [how SAML admin login is switched on and what gates admin access](how-saml-admin-login-is-switched-on-and-what-gates-admin-acc.md)
- [how the split registry timestamp is validated and used as the as_of cutoff](how-the-split-registry-timestamp-is-validated-and-used-as-th.md)
- [how the v2 migrations API writes app feature completions and remote kills](how-the-v2-migrations-api-writes-app-feature-completions-and.md)

## Lessons

- [no admin allow-list or domain check on SAML login](no-admin-allow-list-or-domain-check-on-saml-login.md) (absence)
- [no api v5 in this repo](no-api-v5-in-this-repo.md) (absence)
- [no app-build knockouts in the v3 or v4 split registries](no-app-build-knockouts-in-the-v3-or-v4-split-registries.md) (absence)
- [no experience sampling applied to assignments in this repo](no-experience-sampling-applied-to-assignments-in-this-repo.md) (absence)
- [no HTTP caching on split registry responses in this repo](no-http-caching-on-split-registry-responses-in-this-repo.md) (absence)
- [no user or admin-session check on assignment overrides](no-user-or-admin-session-check-on-assignment-overrides.md) (absence)
