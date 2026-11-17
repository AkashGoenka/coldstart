# Notebook index

26 active notes (11 file · 13 flow · 2 lesson)

## Files

- [app/controllers/api/system/statuses_controller.rb](app-controllers-api-system-statuses-controller-rb-8a6bd8d1.md) (single)
- [app/controllers/api/v1/visitors_controller.rb](app-controllers-api-v1-visitors-controller-rb-a51c8657.md) (single)
- [app/models/app.rb](app-models-app-rb-b9767b41.md) (single)
- [app/models/app_remote_kill.rb](app-models-app-remote-kill-rb-db49ee53.md) (single)
- [app/models/app_version.rb](app-models-app-version-rb-f2b1cfcf.md) (single)
- [app/models/assignment.rb](app-models-assignment-rb-aea791e3.md) (single)
- [app/models/bulk_reassignment.rb](app-models-bulk-reassignment-rb-81623507.md) (single)
- [app/models/split.rb](app-models-split-rb-ba157a17.md) (single)
- [app/models/split_registry.rb](app-models-split-registry-rb-ef7a24e9.md) (single)
- [app/models/visitor.rb](app-models-visitor-rb-ad52e812.md) (single)
- [db/seeds.rb](db-seeds-rb-816631ba.md) (single)

## Flows

- [how a split is created or reweighted (SplitUpsert, registry history, decisions, retirement)](how-a-split-is-created-or-reweighted-splitupsert-registry-hi.md)
- [how a visitor's variant is assigned (deterministic hash bucket and persistence)](how-a-visitor-s-variant-is-assigned-deterministic-hash-bucke.md)
- [how admin login works (Devise database vs SAML switched by ENV)](how-admin-login-works-devise-database-vs-saml-switched-by-en-2.md)
- [how an API request is authenticated (three controller base classes)](how-an-api-request-is-authenticated-three-controller-base-cl.md)
- [how API versions v1-v4 relate and which one clients use](how-api-versions-v1-v4-relate-and-which-one-clients-use.md)
- [how assignment overrides, supersession and history (previous_assignments) work](how-assignment-overrides-supersession-and-history-previous-a.md)
- [how bulk assignment from the admin UI runs (job, transaction lock, reassignment SQL)](how-bulk-assignment-from-the-admin-ui-runs-job-transaction-l.md)
- [how CORS works for the JS client (CorsSupport and OPTIONS routes)](how-cors-works-for-the-js-client-corssupport-and-options-rou.md)
- [how identifiers link devices to one visitor (IdentifierClaim and VisitorSupersession)](how-identifiers-link-devices-to-one-visitor-identifierclaim.md)
- [how per-build configs hide or kill splits (feature gates, remote kills, as_of)](how-per-build-configs-hide-or-kill-splits-feature-gates-remo.md)
- [how the app boots, processes run and which env vars matter](how-the-app-boots-processes-run-and-which-env-vars-matter.md)
- [how to add a new API endpoint or form-object write path](how-to-add-a-new-api-endpoint-or-form-object-write-path.md)
- [how variant screenshots and split details are stored (Paperclip attachments)](how-variant-screenshots-and-split-details-are-stored-papercl.md)

## Lessons

- [no per-admin permissions or roles and no admin sign-up](no-per-admin-permissions-or-roles-and-no-admin-sign-up-2.md) (absence)
- [no scheduled jobs or recurring tasks, only the BulkAssignmentJob](no-scheduled-jobs-or-recurring-tasks-only-the-bulkassignment.md) (absence)
