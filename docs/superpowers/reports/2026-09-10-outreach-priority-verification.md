# Outreach priority system — verification and rollout

Status: the seven Important whole-feature findings and three smaller findings are addressed. The scoped re-review cleared nine findings and exposed one generated foreign-key naming defect in I6; the bounded correction and focused verification pass. Draft PR #799 contains the reviewed feature scope. Rollout remains disabled.

## Intended behavior

Today combines existing promised work with route-aware pursuit priorities. Convention candidates lead strong prospects and fillers when the evidence supports pursuing them. Different openings share the same package and physical-resource constraints. Replies, callbacks, decisions, contact restrictions and unknown evidence remain visible and take precedence over routine cadence.

The default no-response schedule is 7/14/21 elapsed days from actual successful contact, with the minimum waiting period measured again after a delayed attempt. An owner can record a reason and an explicit minimum gap for shorter intervals. An urgent event remains in review until the owner also explicitly acknowledges its operational timeline. Dedicated returning events require a renewal review or decision date. Scheduled drafts and failed sends do not count as actual outreach. Advancing a candidate sends nothing. An established contacted pursuit keeps advisory priority between attempts. Late replies to released pursuits enter visible review without restoring capacity; resuming requires classified evidence, an explicit decision date, fresh availability and resolution of competing established pursuits.

Conversations do not reserve equipment. Specific availability offers require an exact live hold and owner approval of the final recipient, content and event identity. Final provider submission rechecks those facts and current protected-record, last-resort, territory and event-year decline rules for the exact recipient. Ordinary content/intent approval does not waive those protections. Confirmed or uncertain delivery remains durably recorded so elapsed time alone cannot authorize a resend. Reconciliation shows the selected exact payload and provider evidence, and requires a deliberate outcome plus an explicit terminated-operation acknowledgement.

## Verification record

| Implementation checkpoint | Evidence |
| --- | --- |
| Shared capacity, holds and booking writers | Pure interval tests and PGlite transaction tests cover contention, conversion, physical-resource transfers, imported promises and partial migration repair. Task3B fixes include separate route corridors and legacy saved assignments. |
| Exact-content dispatch and contact replay | The expanded Task3C gate passed 128 tests; its review-fix gate passed 55 covering tests plus the migration repair case. Scheduled leases, administrative evidence, inbound replay, archived/read messages, preflight failures and the original three Office EarlyBird tests are covered. |
| Workspace backend | Task4A covering gate passed 62 tests; its final affected gate passed 23 tests plus the migration repair case. Scoped API and database typechecks passed. Independent review and the travel-fix re-review are clear; the affected portfolio gate passed 11 tests. |
| Integrated backend gate | At the reviewed workspace-backend checkpoint, **184 tests across 14 files** passed and the API bundle built. After event-identity completion and latest-main integration, 13 directly affected tests passed and the final API production bundle passed. |
| Owner UI | The final integrated tree passed **51 interaction tests across seven files**, covering Today, profile summary, Opportunity and Office owner review, Scout prefill, and existing Today/profile behavior. The web production bundle passed. |
| Final whole-feature fix wave | **82 tests across five directly affected files** pass: 46 policy/portfolio cases, eight selected PGlite/migration cases, and 28 planner interactions. The scheduled Opportunity and Office coordinators are exercised with the real dispatch guard and mocked provider submission; late reply classification/resume, retained-data base migration repair, urgent cadence acknowledgement and exact delivery reconciliation are covered. The migration regression starts with the repository's actual Drizzle-generated foreign-key names, repairs twice without duplicates, and finishes ready with exactly five relationships. Both scoped compilers and production builds pass. See `.superpowers/sdd/2026-09-09-route-aware-outreach/final-fix-report.md` for exact commands, mapping and limitations. |
| Explicit event identity | 13 focused backend tests cover owner routes, late binding, protected/wrong identities, idempotency, unresolved deliveries, stale approvals and preserved work; 24 of the UI tests cover the integrated planner interactions. Independent Task4C review found no issues. |

Generic full-workspace TypeScript checking has pre-existing dependency/type-generation errors outside this feature; none of the web errors name the new planner component or API client. The scoped API checks use the application's production Zod v4 alias. Both API and web production bundles pass.

The supported browser denied navigation to the isolated local preview with `net::ERR_BLOCKED_BY_CLIENT`. Reading an already-open production profile established visual context only; it did not verify the new feature. No production interaction was used as a substitute for local UI validation.

The integrated API commands ran from `artifacts/api-server`, using the installed Vitest binary and a deliberately unreachable local `DATABASE_URL` for eager imports; database cases inject PGlite:

```sh
vitest run --maxWorkers=1 src/features/outreach-planner src/routes/outreach-planner.test.ts src/features/opportunity-email/opportunity-email-repository.test.ts src/features/opportunity-email/opportunity-email-service.test.ts src/features/office/office-email-send-coordinator.test.ts src/features/google-workspace/google-gmail-bound-send.test.ts src/features/google-workspace/google-recent-validation-outreach.test.ts src/db/leg-assignment-required-startup.test.ts
vitest run src/features/opportunity-email/opportunity-email-delivery.test.ts
node ./build.mjs
```

Results at the reviewed backend checkpoint: the first command passed 171 tests in 119.85 seconds; the second passed 13 tests in 260 ms, for 184 tests across 14 different files. After the later identity change and latest-main integration, the directly affected 13-test gate passed in 19.11 seconds and the final API build produced a 16.5 MB main bundle.

The pre-fix final affected backend command selected the explicit identity lifecycle, owner routes, original admission, and two dispatch approval/retry regressions from `outreach-allocation.pglite.test.ts`, `outreach-repository.pglite.test.ts`, and `routes/outreach-planner.test.ts`. It passed 13 tests and intentionally skipped 62 cases outside that selection.

The UI command ran from `artifacts/adventure-zone`:

```sh
vitest run --config vitest.config.ts --maxWorkers=1 src/components/today/outreach-planner.test.tsx src/pages/OfficeCoordinatorAdminPage.outreach-review.test.tsx src/components/assistant/assistant-drawer.outreach-prefill.test.tsx src/components/today/master-work-queue.test.tsx src/features/today/today-focus.test.ts src/features/today/today-return-context.test.ts src/components/profiles/profile-email-composer.test.tsx
vite build --config vite.config.ts
```

Pre-fix integrated results: 51 interaction tests passed across seven files in 10.00 seconds. The web build exited successfully; the planner chunk was 79.62 kB (18.48 kB gzip).

## Rollout sequence

1. Keep `OUTREACH_PLANNER_ENABLED` unset or false while applying the additive migrations. Readiness markers detect missing required objects; migrations perform their additive repairs, and the runner rechecks readiness after SQL execution and fails deployment if it remains false. The base allocation repair is verified against retained demand/hold rows, including a dropped revision column, lifecycle/quantity constraints and NOT NULL protection. Missing factual or source-identity data that cannot be recovered faithfully requires repair from evidence; migration must not invent a promise.
2. Review real configured legs, package counts, unavailable equipment, Calendar source state and a sample of actual openings. Record exact demand, verified locations and availability times for any route/resource anchors that are needed. Missing evidence must continue to read as needs review.
3. Review pending scheduled drafts before enabling enforcement. Existing drafts need final content/intent approval; specific offers also need matching live holds. The enabled send paths deliberately stop drafts that lack this evidence.
4. Enable the flag consistently for application and worker pools only after the owner workflow and configuration review are complete. `allocationEnforcementComplete` describes implemented safeguards; it does not certify enabled rollout or live configuration.
5. If changing the flag later, pause scheduled execution and resolve or retain operational control of in-flight/uncertain deliveries first. Disabling the new guard is not evidence that an unresolved provider operation failed to send.

No live database mutation, Calendar refresh, email, call, bulk outreach, reassignment, main-branch merge or production rollout is part of this verification record.

## Implementation decisions

| Decision, in order | Reason | Cost if wrong |
| --- | --- | --- |
| Review capacity/source work, booking mutations and dispatch in sequential Task3 slices | The change spans many writers and two send systems | Additional integration rework; the original scope and rollout gate stay intact |
| Persist authenticated imported commitments as unverified claims that conservatively affect capacity | Rejecting an import can hide a real promise; authentication does not verify Calendar evidence | Additional owner reconciliation or stricter ingestion staging may be necessary |
| Continue the existing isolated feature checkout | It contains the recovered unsaved work | Publication must use explicit feature paths over the complete remote main tree |
| Complete Task4 backend contracts before its UI | Cadence, admission and portfolio fields were prerequisites | One additional focused review gate |
| Include an explicit minimum inter-attempt gap in owner-selected shorter cadence | A fixed seven-day minimum would defeat an owner-selected urgent schedule | An incorrect owner schedule requires correction; replies, promises and missing evidence still override it |
| Add an explicit owner resolution step for an unlinked opportunity once its event is verified | Ordinary admission rejects a later null-to-booking mismatch, leaving an undated future prospect without a usable next step | Incorrect identity evidence requires owner review or correction; already-linked event protection and history remain intact |
| Bind a verified event by updating the existing opportunity in place | Existing drafts, contact history and manual next actions remain attached to the same opportunity | A mistaken binding needs owner correction, so conflicting existing links remain protected |
| Move UI fixes and event-identity work into dedicated checkouts after unattributed edits kept returning in shared files | Stable isolated trees made each reviewed commit reproducible and prevented one task from overwriting another | Publication must continue to use the reviewed final tree and explicit path manifest |

Publication uses only explicit feature paths over the current remote main tree. Local source-hydration commits are not published as replacement repository trees.
