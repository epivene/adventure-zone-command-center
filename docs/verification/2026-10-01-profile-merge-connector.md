# Profile merge connector verification — 2026-10-01

## Scope

No live profiles were merged. Tests use local PGlite fixtures and the HTTP/component harnesses. API and frontend production builds passed. Frontend output retains the existing large-chunk warning.

The connector suite and Settings review-page results are recorded in the pull request after their final run. The production merge executor is exercised against schema-derived PGlite tables; that fixture does not claim to reproduce every production FK/trigger. Native PostgreSQL concurrency/integration tests were not run because a disposable TEST_DATABASE_URL was not configured.

## Broader test attempt

Command: `timeout 150 vitest run --maxWorkers=1` from artifacts/api-server.
The run reached the 150-second limit (exit 124), so it is not a completed or passing full suite. Before timeout it reported the following failures outside this change, plus a legacy merge integration suite that did not load. They were not repaired as part of this connector feature, and an untouched-baseline rerun was not performed.

```text
❯ src/features/outreach-planner/outreach-allocation.pglite.test.ts (53 tests | 2 failed) 86575ms
× admits an undated prospect, resolves the selected booking once, preserves history/manual work, and uses normal demand/fit review 1723ms
× advances, observes a late reply, keeps it released in attention, classifies and explicitly resumes only after fresh availability 1782ms
❯ src/features/act-replacement/organize-schema-contract.test.ts (21 tests | 1 failed | 6 skipped) 28ms
× freezes job source versions and binds archive links to exact source provenance 11ms
❯ src/features/act-replacement/drizzle-apply-repository.test.ts (36 tests | 1 failed) 1649ms
× persists ACT phone create, update, and clear through exact lookup and destination constraints 1626ms
❯ src/features/outreach-planner/outreach-repository.pglite.test.ts (24 tests | 4 failed) 32873ms
× runs migration twice, saves edits, audits profile and preserves manual/promo steps 1770ms
× distinguishes outgoing silent calls, convention provenance and manually classified tier 1349ms
× recovers SQL source failure at google_workspace_validation_mappings savepoint while preserving known blockers and callbacks 1330ms
× recovers SQL source failure at booking_opportunity_email_state savepoint while preserving known blockers and callbacks 1341ms
❯ src/features/organizations/organization-merge.integration.test.ts (0 test)
❯ src/routes/ai-suggestions.test.ts (25 tests | 4 failed) 7710ms
× streams a suggestion event when AI returns a future-dated suggestion 5005ms
× discards entire suggestions when the AI returns a past or absent start date 2239ms
× also rejects a suggestion whose end date precedes its start date 95ms
× reports hadErrors=true in the done event when an AI batch fails 197ms
❯ src/features/organization-locations/location-repository.pglite.test.ts (43 tests | 27 failed) 4030ms
× returns location summaries for the given org only 9ms
× returns no locations for an org with none 2ms
× includes coordinate when lat/lng are set 1ms
× returns null coordinate when lat/lng are absent 1ms
× includes the open follow-up for Main Stage 1ms
× does not show a cancelled or declined booking as nextBooking 3ms
× returns full detail for an existing location 3ms
× includes contacts pinned to the location 1ms
× returns null for a location in a different org 1ms
× returns null for an unknown id 1ms
× inserts a location and returns its id 4ms
× normalizes a website without a protocol on create 2ms
× preserves an existing https:// prefix on create 2ms
× stores normalized_phone on create when a valid NA phone is supplied 2ms
× stores null normalized_phone when the phone cannot be canonicalized 2ms
× stores null normalized_phone when phone is absent 1ms
× patches a location label 2ms
× normalizes a website without protocol on update 1ms
× updates normalized_phone when phone changes 3ms
× clears normalized_phone when phone is cleared 2ms
× throws INCOMPLETE_COORDINATE when only lng is supplied on update 1ms
× returns 'ok' and deletes an empty location 1ms
× returns location count for ORG_A 3ms
× returns 0 location count for ORG_B 2ms
× counts upcoming bookings 3ms
× counts overdue follow-ups 3ms
× returns zero counts for org with no records 3ms
❯ src/features/leg-manager/manager-map-data.test.ts (14 tests | 1 failed) 24ms
× keeps the last checked-out event as the route anchor until the next event is checked in 12ms
```

## Typecheck

`tsc -p artifacts/api-server/tsconfig.json --noEmit` completed with exit 2 and 101 diagnostics across 42 files. No diagnostics remain in files changed by this PR. This is not a clean repository-wide typecheck; diagnostics remain in:

- `artifacts/api-server/src/db/organization-location-cleanup-migration.test.ts`
- `artifacts/api-server/src/features/act-recovery/recovery-unreadable-review.test.ts`
- `artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.ts`
- `artifacts/api-server/src/features/boss-work-requests/convention-planning-migration.test.ts`
- `artifacts/api-server/src/features/boss-work-requests/template-review-repair.test.ts`
- `artifacts/api-server/src/features/boss/boss-profile-view.ts`
- `artifacts/api-server/src/features/chatgpt-connection/lead-note-service.ts`
- `artifacts/api-server/src/features/chatgpt-connection/note-edit.pglite.test.ts`
- `artifacts/api-server/src/features/communication-templates/communication-template-permissions.test.ts`
- `artifacts/api-server/src/features/communication-templates/early-bird-promo-convention-coverage.test.ts`
- `artifacts/api-server/src/features/communication-templates/returning-customer-review-seed.test.ts`
- `artifacts/api-server/src/features/event-profiles/event-profile-activity-classification.test.ts`
- `artifacts/api-server/src/features/event-profiles/event-profile-canonical-children.test.ts`
- `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-repository.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-api-drive.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-profile-email-archive-service.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-profile-email-reply-service.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-profile-label-resolver.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-profile-label-validation-import.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.test.ts`
- `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts`
- `artifacts/api-server/src/features/leg-manager/crew-repository.test.ts`
- `artifacts/api-server/src/features/leg-manager/leg-manager-dashboard.test.ts`
- `artifacts/api-server/src/features/leg-manager/manager-map-data.test.ts`
- `artifacts/api-server/src/features/manager-comms/attachment-filing-service.test.ts`
- `artifacts/api-server/src/features/office/office-mail-service.test.ts`
- `artifacts/api-server/src/features/opportunity-email/draft-context-resolver.test.ts`
- `artifacts/api-server/src/features/organizations/imported-location-family-consolidation.test.ts`
- `artifacts/api-server/src/features/profile-research/profile-research-apply.ts`
- `artifacts/api-server/src/features/trips/trip-service.test.ts`
- `artifacts/api-server/src/routes/act-recovery.test.ts`
- `artifacts/api-server/src/routes/boss-schedule-route.test.ts`
- `artifacts/api-server/src/routes/contracts.test.ts`
- `artifacts/api-server/src/routes/follow-ups.test.ts`
- `artifacts/api-server/src/routes/google-workspace-oauth-callback.test.ts`
- `artifacts/api-server/src/routes/google-workspace-profile-email.test.ts`
- `artifacts/api-server/src/routes/google-workspace-settings.test.ts`
- `artifacts/api-server/src/routes/google-workspace-validation.test.ts`
- `artifacts/api-server/src/routes/office-design-studio.ts`
- `artifacts/api-server/src/routes/twilio-inbound-voice-webhooks.test.ts`

## Local dependency setup

This checkout reused installed workspace dependencies. Initial frontend build attempts encountered stale workspace links and missing react-markdown/remark-gfm links. The local dependency links were corrected without changing package manifests or the lockfile, then the production frontend build passed.
