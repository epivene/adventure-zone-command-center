# Connected leg operations — verification, October 1, 2026

## Review status

Draft delivery only. No merge, deployment, live booking edits, imports, outbound correspondence, or paid provider calls were performed by the feature. One fresh independent gpt-6-astra whole-branch review completed. Its six Important findings were fixed in one regression-tested pass; a repeated-name choice issue was re-graded Important and fixed too. The remaining calendar display minor was fixed during the October 2 continuation. Draft-only delivery is appropriate; baseline CI and visual checks remain unresolved.

## October 2 continuation

Owner and boss panels now label the Calendar connection section when its read is unavailable, retain the error message and offer the existing retry. Manager panels continue to omit office calendar details. The two owner/boss error assertions failed before the fix, then all nine panel tests passed, including a manager privacy regression. The affected five-suite recheck passed 19 tests.

Added `.github/workflows/connected-leg-operations-ci.yml`, a read-only, path-scoped check using Node 22 and frozen dependencies. It explicitly selects local fixture API tests and the connected operations UI regressions; it does not invoke the blocked full API suite. Existing workflows remain unchanged. Its executable verification steps were run locally in workflow order: shared-library typecheck passed, shared contract 2/2, API 75/75 across 11 suites, UI 70/70 across 21 suites, frontend production build and API production build passed. This is **147 focused tests**, not a claim of full workspace coverage. The local runtime remains Node 24; hosted Node 22 results will be recorded separately.

At remote head `aea95d1a58626c6f638fc5be36eb11b0d528c2af`, hosted checks were 7 successful and 11 failed. All failed job logs were inspected:

| Workflow | Observed failure |
|---|---|
| Release Safety | API typecheck exhausted the default Node heap. Main `b6dbc807cbf936882d5a7304349382daa55a6fb0` job 110619448234 also failed with heap exhaustion. |
| Guided Calling CI | Its API and frontend test groups passed; the workspace typecheck and root build exhausted the Node heap. |
| Design Studio Current Templates CI | Node heap exhaustion. |
| Google Workspace Sync CI | Five failures: old settings/source assertions, changed Gmail draft result fields, missing profile-email fixture, deployment sync setting assertion, and calendar app-window DB mock without `transaction`. |
| Office Coordinator CI | Email draft fixture lacks current columns; owner middleware source assertion searches for an absent literal. |
| Booking Master Work Queue Release 2 CI | Same absent owner middleware literal; recipient error wording expectation differs from its structured code. |
| Calendar Route Handoff CI | Existing manager route anchor ID assertion expects a trip UUID, receives a manager navigation ID. Earlier test groups passed. |
| Assistant General Mode CI | Root test harness lacks DOM, database configuration and backend aliases; some history assertions differ. |
| Manager Assistant CI | Root alias/database setup and the same manager anchor assertion. |
| Package Intelligence CI | Root backend alias/database setup and frontend React setup. |
| Booking Assistant CI | Root Zod/alias/database setup and a history answer assertion. |

To distinguish observed hosted failures from reproduced baseline failures, ran this safe selection in the unchanged `8c34ec1` baseline worktree:

```sh
env pnpm_config_verify_deps_before_run=false pnpm --filter @workspace/api-server test src/features/leg-manager/manager-map-data.test.ts src/routes/office-security-regression.test.ts src/routes/opportunity-email-index-mount.test.ts
```

Result: 3 failed, 18 passed. The manager anchor and both middleware source assertions reproduced exactly. Those tests and the manager map implementation are unchanged by this feature; the route index diff only adds the explicitly authenticated operations router. Other logged hosted failures were investigated, but their entire workflows were not rerun on baseline and are not claimed to have been fully reproduced. No broad check was suppressed or marked successful.

Hosted focused workflow passed on Node 22 at commit `87607a14574ae359b123a4f25837a935f1fd54a1`: job 110652045457, **Operations regressions and builds**, completed successfully. Shared-library typecheck, all 147 selected tests, frontend build and API build passed with a fresh frozen dependency installation. The subsequent documentation update changes only this verification record. Phone/tablet/desktop visual checks and broad workspace failures remain pending; the PR stays draft.

## Implemented acceptance

One role-scoped read panel connects saved assignments, separately labeled suggestions, historical event/leg evidence, public and reserved dates, package/equipment facts, stored route estimates, calendar-link status and relevant work. Missing current crew/lodging evidence remains “Not recorded.” Angel and archived Angelo retain separate IDs and history. A profile with several bookings requires an explicit booking/year choice; undated bookings remain separate choices.

Owner booking/profile, boss profile and assigned manager operations reuse the same contract with role-appropriate sections and controls. Section read failures do not replace canonical booking facts. Existing successful edit and booking creation paths invalidate mounted readers. Late responses cannot replace a newly selected booking. Schedule/calendar/map share explicit year/leg/status scope and keep unknown-date, unassigned and unmapped records visible. Profile links carry booking/year/leg and a safe originating schedule return path.

No schema migration or second assignment store. No new communication writer. Full availability/staffing, historical reconciliation, structured split approvals and extra-set enforcement remain later releases. Normal five AZ/three Pirates/one Warrior rules and Dave/leg-manager approvals are not claimed to be enforced by this read release.

## Local automated checks

| Check | Actual result |
|---|---|
| Focused frontend acceptance and affected suites | 20 files, 63 tests passed; actual popup navigation suite also passed (recorded below) |
| Focused API and existing operational/calendar/location reads | 11 files, 75 tests passed |
| Shared read DTO schemas | 1 file, 2 tests passed |
| API production build | Passed |
| Frontend production build after final acceptance fixes | Passed; 3,852 modules, 13.84 seconds; existing chunk-size warning |
| Root typecheck | Failed on existing frontend diagnostics after shared libraries passed |
| Frontend standalone typecheck | 131 diagnostics; diagnostic file/code locations equal unchanged baseline, no new diagnostic locations |
| API standalone typecheck | Failed; diagnostic file/code locations also occur on unchanged baseline, with no new locations |
| Full frontend suite | Latest broad run: 104 files failed, 433 passed; 194 tests failed, 1,998 passed; one obsolete popup URL assertion fixed afterward; baseline comparison below |
| Full API suite | Blocked by automatic approval review; no completed full-suite result |

The full frontend run included an early version of the integrated fixture assertion; that assertion was corrected and the final focused run is green. Existing EventProfilePage's 12 outdated assertions were separately reproduced using its unchanged baseline component with corrected transport mocks. The unchanged RoutesPage.workflow-split source assertion also fails. Unchanged baseline full suite: **105 files failed / 422 passed; 182 tests failed / 1,965 passed** (287.91 seconds). Comparing failed file names: 103 failures are common, only the early integrated fixture failed newly (now green); BookingDetailPage.assistant-context and BossSchedulePage.test no longer fail on this branch. EventProfilePage.test moved from a baseline import failure to its 12 reproduced obsolete assertions after mock repairs. The total counts therefore differ and are not evidence that all suites passed. The complete common failure file list follows.

Commands ran with `env pnpm_config_verify_deps_before_run=false` to use the existing lockfile/dependency cache without reinstalling. Node 24.19.0 was provided; the repository requests Node 22.x. API typecheck required a 7 GB Node heap. No new product dependency was added.

Builds: `pnpm --filter @workspace/api-server build`, `pnpm --filter @workspace/adventure-zone build`. Typechecks: `pnpm run typecheck`, `pnpm --filter @workspace/adventure-zone exec tsc --noEmit`, and API equivalent with `NODE_OPTIONS=--max-old-space-size=7000`.

### ui-final.log

```text
$ vitest run --config vitest.config.ts src/pages/ConnectedLegOperations.integration.test.tsx src/components/bookings/leg-operations-panel.test.tsx src/components/bookings/profile-leg-operations.test.tsx src/features/bookings/use-booking-leg-operations.test.tsx src/features/bookings/booking-operations-changes.test.ts src/pages/BookingEditPage.test.tsx src/pages/BookingDetailPage.assistant-context.test.tsx src/pages/BossProfilePage.leg-operations.test.tsx src/pages/ManagerOperationsPage.test.tsx src/pages/SchedulePage.test.tsx src/pages/SchedulePage.filters.test.tsx src/components/routes/event-map.combined-controls.test.ts src/components/routes/event-map.test.tsx src/features/bookings/operations-navigation.test.ts src/features/routes/map-focus.test.ts src/pages/BossSchedulePage.test.tsx src/pages/BossSchedulePage.event-data.test.tsx src/components/calendar/event-calendar.profile-navigation.test.tsx src/components/profiles/profile-booking-creator.test.tsx
```

### api-focused.log

```text
$ vitest run src/features/bookings/booking-leg-operations-history.test.ts src/features/bookings/booking-leg-operations-repository.pglite.test.ts src/features/bookings/booking-leg-operations-service.test.ts src/routes/booking-leg-operations.test.ts src/features/chatgpt-connection/operational-reads.pglite.test.ts src/features/routes/travel-leg-map-windows.pglite.test.ts src/routes/calendar.test.ts src/features/routes/location-resolver.test.ts
```

### contract-final.log

```text

```

## Preview limitation

The authorized local fixture preview started at `http://127.0.0.1:5177/operations-preview.html`, but the cloud browser blocked it with `net::ERR_BLOCKED_BY_CLIENT`. No installed local Chromium binary was available. Visual checks at 360 px, 768 px and desktop widths were **not performed** and remain pending before merge. No screenshots are claimed. Temporary preview files/server were removed/stopped; no live production pages were edited to compensate.

## Blocked broad API check

Automatic approval review rejected the full API test run because a test attempted HTTPS access to `anthropic.test` with an unknown potential payload. The broad command was not repeated or bypassed. The materially safer alternative was the explicit local fixture API set above (66 tests passed). Full API-suite coverage remains pending until the test's external request is appropriately reviewed or repaired.

## Main synchronization

Verified source baseline was GitHub main `1da93516133592eb1cc19fd1e97ccac8c24ab901` (local synthetic snapshot `8c34ec1`). Main subsequently advanced to `b6dbc807cbf936882d5a7304349382daa55a6fb0` with two unrelated ChatGPT operation-store commits and no overlapping feature files. Delivery will apply only this feature's file changes and approved spec/plan to fresh main through a new branch; the cached foam banner is excluded.

## Execution rulings

Ruling: Reuse the existing dependency cache while installing workspace links in this isolated checkout — avoids changing another checkout's dependency links — cost if wrong: environment-only build setup delay.
Ruling: Leave unrelated binary foam banner at the local cached version and publish only feature diffs against fresh main — it is outside this change and cannot be read via text source tools — cost if wrong: preview banner appearance may differ, production asset remains unchanged.
Task 1: Ruling: Use the existing SqlQuery read interface rather than a new Drizzle-only repository — matches operational connector reads and allows production-column PGlite tests — cost if wrong: repository adapter replacement.
Task 1: Ruling: Load historical candidates separately from the canonical booking — permits section failures without losing the booking — cost if wrong: one additional bounded database read.
Task 3: Ruling: Repair outdated transport/provider mocks in affected profile tests, but preserve their remaining assertions — baseline component reproduced the same 12/14 failures from the current profile redesign — cost if wrong: outdated profile assertions remain blocking broader CI.
Task 3: Ruling: Create navigation helper during panel integration to avoid a duplicate link builder; navigation/filter coverage belongs to Task 4 — cost if wrong: commit boundary differs from plan, feature scope unchanged.
Task 4: Ruling: Add saved reserved-window fields to existing route reads and filter calendar after projecting windows — otherwise a New Year reserved block is excluded before it can be displayed — cost if wrong: additive read fields and altered window boundary behavior, covered by PGlite and date tests.
Task 4: Ruling: Use Denver only in operations/map season/window helpers; leave the shared Chicago date helper unchanged — avoids an unrelated global date migration — cost if wrong: existing calendar day-grid timezone still differs and is documented for later work.
Task 4: Ruling: Add the small revision subscription infrastructure with mounted map/calendar filters so the commit compiles; existing action notifications and profile subscriptions remain Task 5 — cost if wrong: implementation commit boundaries overlap.
Task 4: Ruling: Update touched Boss schedule test to select Upcoming with a fixed fixture clock and include undated records, and repair calendar DB mock to distinguish table reads — these tests were stale against current main — cost if wrong: fixture maintenance only.
Task 5: Ruling: Invalidate all mounted bookings after the existing special-request decision because it returns no booking ID — no request/assignment writer added — cost if wrong: extra read requests within the current session.
Task 5: Ruling: Refresh Boss schedule and existing manager-scoped map on focus too — prevents removed/reassigned events lingering in their picker — cost if wrong: an extra bounded existing read when focus returns.
Task 6: Ruling: Mark browser-width preview checks pending after the cloud browser blocked localhost and no local Chromium binary was available — do not deploy or tunnel fixtures to bypass the restriction — cost if wrong: responsive visual issues remain unverified.
Task 6: Ruling: Use local fixture API checks after automatic review rejected the broad suite’s anthropic.test request — avoid repeating the external request and record the blocked suite — cost if wrong: unrelated full-suite regressions remain unverified.
Task 6: Ruling: Continue to a draft PR with explicitly reported baseline failures as the approved plan requires — the finishing skill’s generic stop conflicts with that instruction — cost if wrong: draft remains blocked from merge until existing CI issues and pending checks are resolved.

## Full frontend baseline failure comparison

```text
src/App.google-workspace-navigation.test.ts
src/App.simplified-navigation-regression.test.ts
src/app-branding-name.test.ts
src/call-router-compat-routes.test.ts
src/call-script-settings-navigation.test.ts
src/canonical-internal-links.test.ts
src/components/assistant/assistant-drawer-polling.test.tsx
src/components/assistant/assistant-drawer.test.tsx
src/components/assistant/lead-discovery-results.test.tsx
src/components/assistant/lead-scout-save-dialog.test.tsx
src/components/boss-work-requests/EmailTemplateReview.test.tsx
src/components/boss/boss-profile-emails.test.tsx
src/components/calls/call-console-ui-cleanup.test.ts
src/components/calls/caller-finder.test.tsx
src/components/contacts/quick-add-caller.test.tsx
src/components/design-studio/ContextualBottomToolbar.test.tsx
src/components/design-studio/contract-signature-panel.test.ts
src/components/event-families/profile-member-picker-location.test.ts
src/components/event-families/profile-member-picker.test.tsx
src/components/google-workspace/google-scope-preview.test.tsx
src/components/google-workspace/operational-calendar-settings-card.review-details.test.tsx
src/components/manager/event-lifecycle-action.test.tsx
src/components/manager/receipt-expense-form.test.tsx
src/components/manager/report-schedule-issue.test.tsx
src/components/navigation/app-menu-admin-groups.test.ts
src/components/navigation/app-shell.test.tsx
src/components/navigation/workspace-switcher-menu.test.ts
src/components/office/office-appearance-control.test.ts
src/components/office/office-email-editor.syntax.test.ts
src/components/office/office-email-editor.template-authoring.test.tsx
src/components/opportunities/opportunity-draft-composer.test.tsx
src/components/organizations/duplicates-view.profile-language.test.ts
src/components/organizations/duplicates-view.subset-selection.test.tsx
src/components/organizations/duplicates-view.test.tsx
src/components/organizations/organization-list-decision.test.tsx
src/components/organizations/organization-list-filler.test.tsx
src/components/organizations/organization-membership-drawer.test.tsx
src/components/packages/package-template-editor.base-price.test.tsx
src/components/profiles/admin-directory-live-search.test.tsx
src/components/profiles/profile-bookings-primary.test.ts
src/components/profiles/profile-inline-editor.test.tsx
src/components/profiles/profile-locations-panel.test.tsx
src/components/profiles/profile-research-contract.test.ts
src/components/profiles/profile-research-prospect-intake-release3.test.ts
src/components/profiles/profile-research-release1-finish.test.ts
src/components/profiles/simple-full-profile.email-compose.test.tsx
src/components/profiles/simple-full-profile.palette.test.tsx
src/components/today/booking-copilot-ui.test.tsx
src/components/today/call-queue-workspace.test.tsx
src/components/today/renewals-section.test.tsx
src/dark-theme-booking-new.test.ts
src/features/assistant/assistant-api.test.ts
src/features/assistant/on-device-ai-router.test.ts
src/features/calls/adventure-zone-call-flow.test.ts
src/features/calls/global-guided-call-entrypoints.test.ts
src/features/event-profiles/event-profile-activity-classification.test.ts
src/login-landing.test.ts
src/manager-appearance-selector.test.ts
src/pages/ActRecoveryPage.ownership-repair.test.ts
src/pages/AdminCommandPanelPage.test.tsx
src/pages/BookingsPage.test.ts
src/pages/BossOperationalRecords.test.ts
src/pages/BusinessDocumentsPage.test.tsx
src/pages/CalendarPage.confirmed-default.test.ts
src/pages/CallWorkspacePage.quick-add.test.tsx
src/pages/ConventionOutreachPage.test.tsx
src/pages/EventFamilyPage.member-link.test.ts
src/pages/EventProfilePage.cleanup-followup.test.ts
src/pages/EventProfilePage.locations-panel.test.ts
src/pages/EventProfilePage.organization-membership.test.tsx
src/pages/EventProfilePage.scout-notes.test.tsx
src/pages/EventProfilePage.simple-layout.test.ts
src/pages/EventProfilePage.test.tsx
src/pages/ManagerAftermathAdminPage.incident-actions.test.ts
src/pages/ManagerHomePage.current-event.test.tsx
src/pages/ManagerHomePage.money-endpoint.test.ts
src/pages/ManagerIncidentPage.general.test.ts
src/pages/ManagerIncidentPage.test.tsx
src/pages/ManagerMessagesPage.test.tsx
src/pages/ManagerMoneyPage.test.tsx
src/pages/OfficeCoordinatorAdminPage.test.tsx
src/pages/OrganizationsPage.test.tsx
src/pages/RoutesPage.workflow-split.test.ts
src/pages/SettingsBusinessSourcesPage.test.tsx
src/pages/SettingsCommunicationTemplatesPage.test.tsx
src/pages/SettingsGoogleWorkspaceOAuthReturn.test.tsx
src/pages/SettingsGoogleWorkspaceOptionalSublabels.test.tsx
src/pages/SettingsGoogleWorkspacePage.test.tsx
src/pages/SettingsPackagesResourcesPage.collapsible.test.tsx
src/pages/SimpleFrontendRefinement.test.ts
src/pages/TodayPage.scout-alerts.test.tsx
src/pages/TodayPage.simple-layout.test.tsx
src/pages/TodayPage.test.tsx
src/pages/main-copy-density.test.ts
src/pages/manager-event-date-range.test.ts
src/pages/needs-attention-new-leads-navigation.test.ts
src/pages/new-leads-past-visibility.test.ts
src/pages/profile-advanced-tools-simplification.test.ts
src/pages/today-active-event-labels.test.ts
src/pages/today-layout-contract.test.ts
src/pages/today-section-heading-simplification.test.ts
src/profile-creation-flow.test.ts
src/website-custom-element/adventure-zone-site.contract.test.ts
```

## Independent review and fixes

Reviewer: fresh-context gpt-6-astra (read-only), local range `8c34ec1..85a7202`; no additional reviewer or implementation subagents.

| Finding | Regression and resulting behavior |
|---|---|
| Manager warning data exposure | Actual PGlite/Drizzle provider with two legs sharing a pool: owners retain full conflict facts, managers retain a blocking warning with unrelated booking names/IDs removed. The fixture first hit an unrelated database import; after isolating the default pool, the vulnerable pre-fix service failed the privacy assertion and the corrected service passed. |
| Retry date normalization | Reserved dates in retry JSON are normalized; the prior helper crash was reproduced. |
| Stale location snapshot | Retry overrides contain location fields only and cannot replace refreshed leg/date facts; valid canonical coordinates take precedence. |
| All-day dates and exclusive ends | Saved imported marker plus UTC-midnight identifies public all-day dates; Google reserved source identifies exclusive all-day windows. DTO keeps date-only strings, map transport carries date-only/exclusive flags. January, DST and occupied-end regressions pass. Genuine timed values remain Denver-based. |
| Boss reserved-window parity | Saved reserved bounds and semantics now survive boss route/type/UI projections; January public event remains visible in December when reserved there. |
| Navigation/filter return | Map record links reuse the same profile helper. Every boss view/leg/status/season change updates URL scope; clearing filters deletes stale keys. |
| Repeated-name booking choices (re-graded Important) | Public date labels identify same-named choices; historical leg evidence shows its dates. |

Regression failures were observed before fixes. The full frontend recheck found one obsolete `manager-route-map-layers` assertion expecting a URL without the newly required booking/year/leg query. It was updated to parse the actual popup link and verify all three values. Its focused rerun passed. The other **103 failed files** match baseline; the early integrated acceptance fixture is green. Full suites are not claimed green.

Final review commands: the previous focused frontend command plus `src/pages/BossSchedulePage.filters.test.tsx`; API command plus `src/routes/boss-schedule-route.test.ts`, `src/features/bookings/booking-leg-operations-providers.pglite.test.ts`, `src/features/google-workspace/calendar/calendar-operational-window-projection.test.ts`. Popup: `pnpm --filter @workspace/adventure-zone test src/components/routes/manager-route-map-layers.test.tsx`. Broad frontend: `pnpm --filter @workspace/adventure-zone test --maxWorkers=4` (168.55 seconds). Shared libs: `pnpm run typecheck:libs` passed; final API typecheck after rebuilding library declarations has no new diagnostic file/code locations against baseline. Production builds passed after corrections. The final boss-only selection recheck passed 5 tests.

## Previously deferred minor — resolved October 2

Calendar connection failures originally exposed the generic retry control without a labeled Unavailable calendar section. The continuation adds that section for owner and boss, with regression tests. The original execution ledger below is retained as a historical record.

## Final execution record

```text
# SDD ledger — plan: docs/superpowers/plans/2026-10-01-connected-leg-operations.md

Execution method: Native, approved by Desiree October 1, 2026.
Local baseline: 8c34ec1, a verified source snapshot of GitHub main 1da93516133592eb1cc19fd1e97ccac8c24ab901 plus the approved spec/plan.
Pre-flight: Task 1 produces shared DTO/history selection consumed by Task 2 service and Task 3 panel; interfaces consistent.
Pre-flight: Task 2 supplies authorized read client contract consumed by Task 3; role derived from auth, no client-supplied viewer.
Pre-flight: Tasks 3/4 share explicit season and booking navigation; URL filters preserve selected booking.
Pre-flight: Task 5 signals successful canonical edits consumed by Tasks 3/4 views; no parallel assignment store.
Pre-flight: Task 6 consumes all previous tasks; no new write capability.
Ruling: Reuse the existing dependency cache while installing workspace links in this isolated checkout — avoids changing another checkout's dependency links — cost if wrong: environment-only build setup delay.
Ruling: Leave unrelated binary foam banner at the local cached version and publish only feature diffs against fresh main — it is outside this change and cannot be read via text source tools — cost if wrong: preview banner appearance may differ, production asset remains unchanged.
Task 1: RED history/repository missing modules observed; GREEN 11/11 API tests and 2/2 shared-contract tests.
Task 1: Ruling: Use the existing SqlQuery read interface rather than a new Drizzle-only repository — matches operational connector reads and allows production-column PGlite tests — cost if wrong: repository adapter replacement.
Task 1: Ruling: Load historical candidates separately from the canonical booking — permits section failures without losing the booking — cost if wrong: one additional bounded database read.
Baseline: API leg domain/feasibility 8/8 pass. Existing BookingDetailPage.assistant-context test fails before product changes because its auth-token mock lacks apiFetch; repair its mock in the affected UI task. Schedule baseline 2/2 pass.
Environment: Node 24.19.0 provided; package requests Node 22 and emits an engine warning. Cached dependencies used, pnpm automatic dependency installation disabled per command.
Task 1: complete (commits 8c34ec1..c9fc6d4, tests: env pnpm_config_verify_deps_before_run=false pnpm --filter @workspace/api-server test src/features/bookings/booking-leg-operations-history.test.ts src/features/bookings/booking-leg-operations-repository.pglite.test.ts →    Duration  5.94s (transform 322ms, setup 0ms, import 761ms, tests 5.11s, environment 0ms))
Task 2: complete (commits c9fc6d4..cc34cb5, tests: env pnpm_config_verify_deps_before_run=false pnpm --filter @workspace/api-server test src/features/bookings/booking-leg-operations-service.test.ts src/routes/booking-leg-operations.test.ts src/features/chatgpt-connection/operational-reads.pglite.test.ts →    Duration  11.77s (transform 699ms, setup 0ms, import 1.44s, tests 10.49s, environment 0ms))
Task 2: GREEN 19/19 new service/route and existing operational-read tests. API typecheck has unrelated existing diagnostics, no booking-leg-operations diagnostics after correct cached Zod 3 links and library build. Full baseline comparison deferred to Task 6.
Task 3: Ruling: Repair outdated transport/provider mocks in affected profile tests, but preserve their remaining assertions — baseline component reproduced the same 12/14 failures from the current profile redesign — cost if wrong: outdated profile assertions remain blocking broader CI.
Task 3: Ruling: Create navigation helper during panel integration to avoid a duplicate link builder; navigation/filter coverage belongs to Task 4 — cost if wrong: commit boundary differs from plan, feature scope unchanged.
Task 3/4: Component mounting and filter RED work overlapped while long baseline checks ran; no independent implementation agents used.
Task 3: complete (commits cc34cb5..a73f6d9, tests: env pnpm_config_verify_deps_before_run=false pnpm --filter @workspace/adventure-zone test src/components/bookings/leg-operations-panel.test.tsx src/components/bookings/profile-leg-operations.test.tsx src/features/bookings/use-booking-leg-operations.test.tsx src/pages/BookingDetailPage.assistant-context.test.tsx src/pages/BossProfilePage.leg-operations.test.tsx src/pages/ManagerOperationsPage.test.tsx →    Duration  1.59s (transform 940ms, setup 1.16s, import 1.28s, tests 1.01s, environment 3.98s))
Task 4: Ruling: Add saved reserved-window fields to existing route reads and filter calendar after projecting windows — otherwise a New Year reserved block is excluded before it can be displayed — cost if wrong: additive read fields and altered window boundary behavior, covered by PGlite and date tests.
Task 4: Ruling: Use Denver only in operations/map season/window helpers; leave the shared Chicago date helper unchanged — avoids an unrelated global date migration — cost if wrong: existing calendar day-grid timezone still differs and is documented for later work.
Task 4: Ruling: Add the small revision subscription infrastructure with mounted map/calendar filters so the commit compiles; existing action notifications and profile subscriptions remain Task 5 — cost if wrong: implementation commit boundaries overlap.
Task 4: Ruling: Update touched Boss schedule test to select Upcoming with a fixed fixture clock and include undated records, and repair calendar DB mock to distinguish table reads — these tests were stale against current main — cost if wrong: fixture maintenance only.
Task 4: Existing RoutesPage.workflow-split navigation source assertion fails on unchanged workspace-switcher.tsx; preserved and documented.
Task 4: complete (commits a73f6d9..260f118, tests: env pnpm_config_verify_deps_before_run=false pnpm --filter @workspace/adventure-zone test src/pages/SchedulePage.test.tsx src/pages/SchedulePage.filters.test.tsx src/components/routes/event-map.combined-controls.test.ts src/components/routes/event-map.test.tsx src/features/bookings/operations-navigation.test.ts src/features/routes/map-focus.test.ts src/pages/BossSchedulePage.test.tsx src/pages/BossSchedulePage.event-data.test.tsx →    Duration  2.76s (transform 1.07s, setup 1.99s, import 1.63s, tests 1.87s, environment 8.00s))
Task 5: RED missing change signal observed; GREEN 15/15 action/hook/editor/affected-page tests. Real BookingForm edit flow exercises the transport, including rejected save.
Task 5: Ruling: Invalidate all mounted bookings after the existing special-request decision because it returns no booking ID — no request/assignment writer added — cost if wrong: extra read requests within the current session.
Task 5: Ruling: Refresh Boss schedule and existing manager-scoped map on focus too — prevents removed/reassigned events lingering in their picker — cost if wrong: an extra bounded existing read when focus returns.
Task 5: complete (commits 260f118..027beae, tests: env pnpm_config_verify_deps_before_run=false pnpm --filter @workspace/adventure-zone test src/features/bookings/booking-operations-changes.test.ts src/features/bookings/use-booking-leg-operations.test.tsx src/pages/BookingEditPage.test.tsx src/pages/BookingDetailPage.assistant-context.test.tsx src/pages/BossProfilePage.leg-operations.test.tsx src/pages/ManagerOperationsPage.test.tsx src/pages/BossSchedulePage.test.tsx →    Duration  2.12s (transform 1.79s, setup 1.32s, import 2.44s, tests 1.48s, environment 4.36s))
Task 6: RED→GREEN for new-booking change notification and preserving originating schedule filters on profile navigation. Existing write path only.
Task 6: Ruling: Mark browser-width preview checks pending after the cloud browser blocked localhost and no local Chromium binary was available — do not deploy or tunnel fixtures to bypass the restriction — cost if wrong: responsive visual issues remain unverified.
Task 6: Ruling: Use local fixture API checks after automatic review rejected the broad suite’s anthropic.test request — avoid repeating the external request and record the blocked suite — cost if wrong: unrelated full-suite regressions remain unverified.
Task 6: Ruling: Continue to a draft PR with explicitly reported baseline failures as the approved plan requires — the finishing skill’s generic stop conflicts with that instruction — cost if wrong: draft remains blocked from merge until existing CI issues and pending checks are resolved.
Task 6: complete (commits 027beae..85a7202, tests: env pnpm_config_verify_deps_before_run=false pnpm --filter @workspace/adventure-zone test src/pages/ConnectedLegOperations.integration.test.tsx src/features/bookings/operations-navigation.test.ts src/components/profiles/profile-booking-creator.test.tsx →    Duration  1.98s (transform 524ms, setup 451ms, import 694ms, tests 795ms, environment 1.55s))
Final review: fresh gpt-6-astra reviewer, read-only whole branch 8c34ec1..85a7202; six Important findings and two initial Minor findings, no Critical.
Final: Ruling: Re-grade repeated same-name booking choices as Important — an explicit choice must identify the intended event, so add dates to choices and history — cost if wrong: two additional display changes.
Final: Ruling: Identify imported date-only public dates from the saved imported marker plus UTC-midnight representation, and Google reserved dates from their saved source — no schema migration or live repair — cost if wrong: a later genuine UTC-midnight edit on an imported booking may need explicit date metadata.
Final: Ruling: Keep full availability, staffing, camper allocation, split approvals and extra-set enforcement in later releases — approved release scope requires honest missing evidence — cost if wrong: bookings still need manual approval and capacity checks.
Final: Ruling: Keep import/reconciliation execution and new Com writers out of this release — the approved scope adds saved reads only — cost if wrong: incomplete calendar history still needs reconciliation.
Final: Ruling: Keep the global legacy calendar timezone migration deferred — correct source-aware new operations projections without changing the legacy day grid — cost if wrong: legacy calendar timing differences remain.
Final: Ruling: Leave responsive rendering unverified after the blocked preview — no authorized browser path could inspect the fixtures — cost if wrong: phone/tablet layout defects remain possible.
Final: Ruling: Keep full API coverage and unrelated baseline failures explicitly pending — use the safe fixture suites and do not repeat the rejected external request — cost if wrong: wider regressions remain unverified.
Final: minor (deferred): Calendar connection failures show the generic retry control but lack a labeled Unavailable calendar section.
Final: fixed manager warning data exposure — real provider shared-resource, two different legs fixture RED→GREEN; focused frontend 63/63 and API 75/75.
Final: fixed location retry date normalization — location retry containing reserved JSON dates RED→GREEN; focused frontend 63/63 and API 75/75.
Final: fixed stale assignment after location retry — retry then rerender canonical Hulk/date assignment RED→GREEN; focused frontend 63/63 and API 75/75.
Final: fixed imported all-day dates and exclusive ends — PGlite imported January plus DST and exclusive-end projection RED→GREEN; focused frontend 63/63 and API 75/75.
Final: fixed boss reserved window parity — boss route reserved transport and December UI overlap RED→GREEN; focused frontend 63/63 and API 75/75.
Final: fixed schedule return filters — map record return URL and boss filter update/removal RED→GREEN; focused frontend 63/63 and API 75/75.
Final: fixed repeated booking name ambiguity — same-name choices and historical dates RED→GREEN; focused frontend 63/63 and API 75/75.

```
