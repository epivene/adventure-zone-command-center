# Task 4B report — Booking and profile UI integration

## Status

Complete at reviewed backend checkpoint `4ac8fa8`. This change is frontend-only. The route-aware outreach feature remains controlled by the backend `enabled` flag and renders no planner/profile UI when disabled. Verification performed no live provider call, customer send, production data mutation, deployment, or remote write.

The separately identified future-prospect booking-binding work is intentionally outside Task 4B. An existing opportunity without a verified booking remains visibly in review; this UI does not add or simulate a booking-ID PATCH/bind action.

## Files

- Created `artifacts/adventure-zone/src/features/outreach-planner/outreach-api.ts`.
- Created `artifacts/adventure-zone/src/components/today/outreach-planner.tsx`.
- Created `artifacts/adventure-zone/src/components/today/outreach-planner.test.tsx`.
- Modified `artifacts/adventure-zone/src/pages/TodayPage.tsx`.
- Modified `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`.
- Modified `artifacts/adventure-zone/src/components/opportunities/opportunity-draft-composer.tsx`.
- Modified `artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.tsx`.

No API-server file is part of this change.

## Contract integration

- Contact-next presentation uses `candidate.portfolio.state === "first_choice"` together with current capacity and outreach readiness. It does not infer independent availability from per-opening rank.
- Replies, decisions, existing callbacks, cross-opening contention, stale/missing evidence, unknown capacity, source review, and unresolved dispatches remain visible under waiting or needs-review paths.
- Profile navigation uses the candidate `organizationId` and `eventProfileHref`, producing `/profiles/:organizationId` with Today return context. Opportunity IDs are never used as profile IDs.
- Planner, source/history/inbound, draft-review, and dispatch DTOs use the reviewed camelCase shapes. The allocation catalog deliberately preserves the reviewed raw allocation fields (`candidate_id`, `booking_id`, `opportunity_id`, `leg_id`, `resource_ids`, `expires_at`, `available_at`, and related fields).
- Exact demand mutations send `{ quantities, resourceIds, completePhysicalDemandReviewed: true, reason }`. Route anchors send named leg/resource identity, coordinates, availability/validity instants, source, and reason. Dispatch reconciliation requires the provider operation to be terminated and records source evidence plus outcome.
- Date-only event/opening values render without timezone date drift. Decision, snooze, hold, route-anchor, commitment, and dispatch instants convert browser-local `datetime-local` input to ISO, while the labels state the actual device timezone.

## User-facing behavior

### Today workspace

The existing urgent Today work remains first. The planner follows it as five compact, expandable sections: Contact next, Waiting / follow-ups, Route openings and backups, Find more leads, and Needs review. Existing route warnings and the rest of Today remain in place.

Candidate cards show the event year and tier, actual event dates separately from opening dates, named leg/package demand, capacity evidence, source freshness, real attempt choices, next action, current cross-opening leader, and human-readable waiting/conflict reasons. Only verified `fits` capacity gets positive styling, and the UI explains that it is not a guarantee without a live allocation.

Owner controls include audited tier/rank edits, decision and snooze instants, validated cadence overrides, history review, actual successful-send/completed-call linking, source and inbound classification, exact demand/resource selection, hold creation/release/extension, eligibility-gated advancement, opening fill/close, committed-demand recovery, atomic commitment change, route anchor recording/revocation, imported-source review, and uncertain-dispatch reconciliation. Mutation failures remain local and preserve entered values.

Opening setup uses configured active legs and packages with named counts and real dates. Candidate admission searches existing opportunities or saved Scout profiles by name and year; profile admission reuses/creates the reviewed event-year opportunity and optionally uses an explicitly matched booking. No UUID-entry administration form or fake business data is introduced.

Research setup records explicit date, geography, radius, adjacent-region, package, and target-count criteria. It can prefill the actual Lead Scout assistant workflow. Saved results require an existing opportunity plus source URL, checked date, location, dates, contact, package-fit evidence, and confidence before counting as qualified; unknown facts remain review.

Cards use wrapping grids/flex layouts, visible labels, `min-h-11` touch controls, breakable long text, and no table or forced horizontal-scroll layout.

### Profile

The existing Event Profile, convention history, and Early Bird presentation remain intact. A profile-specific outreach summary filters by exact `organizationId` and shows each opening, event year, portfolio state/reason, actual dates, tier, and unresolved availability.

### Actual owner send screens

Both `OpportunityDraftComposer` and the owner `OfficeCoordinatorAdminPage` submission review use the shared exact-final-content review. Review shows the same recipient, subject, and body passed to the guarded send path; HTML is rendered in a sandboxed iframe and plain text remains whitespace-preserved.

Opportunity send/schedule stays disabled while subject/body edits are unsaved or exact approval is absent. Office recipient/content overrides invalidate approval, require another review, and are sent through the existing owner override payload only after approval. Specific-offer approval requires a matching live hold. Dispatching/uncertain delivery states instruct the owner to reconcile rather than resend. No send was invoked during verification.

## Verification

From `artifacts/adventure-zone`:

```text
../../node_modules/.bin/vitest run --config vitest.config.ts \
  src/components/today/outreach-planner.test.tsx \
  src/components/today/master-work-queue.test.tsx \
  src/features/today/today-focus.test.ts \
  src/features/today/today-return-context.test.ts \
  src/components/profiles/profile-email-composer.test.tsx
```

Result: exit 0; 5 test files passed, 35 tests passed. The interaction coverage includes disabled/default-off behavior, recoverable load failure, portfolio-first-choice grouping and contention, responsive markup, configured opening creation with preserved input on failure, opportunity/profile admission, audited decision/source actions, advance/hold gating, explicit research criteria, exact draft approval, and guarded Opportunity send behavior. The existing Today queue/focus/return and profile email composer regressions also pass.

```text
../../node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false
```

Result: exit 2 because the shared workspace has pre-existing and concurrent diagnostics. There are no diagnostics in the new planner/API files, Today page, Opportunity draft composer, or Office owner page. The two diagnostics in modified `EventProfilePage.tsx` are the same baseline `unknown[]`/`unknown` diagnostics recorded in `/workspace/scratch/bd8890c17c95/reviews/web-typecheck.log` (line numbers shift by two because of the new import/render). The current shared worktree also contains unrelated concurrent diagnostics in files outside this task; Task 4B does not modify them.

```text
git diff --check -- <seven Task 4B frontend files>
```

Result: exit 0.

Root already owns the integrated API regression and production bundles, so Task 4B did not repeat those gates. Supported browser navigation blocks local preview with `net::ERR_BLOCKED_BY_CLIENT`; per the brief, no test route, alternate harness, preview deployment, or production mutation was added. Responsive behavior is therefore covered by React interaction/DOM assertions and markup inspection rather than a cloud-browser screenshot.

## Review fix round 1 — I1–I8 and M1–M4

Reviewed base: `3205ec4`. All eight Important findings in `task-4b-review.md` are resolved together:

1. Both actual owner delivery screens now read the authoritative planner `enabled` state. Enabled rollout requires exact final-content approval; disabled or unavailable rollout preserves the existing Opportunity send/schedule and Office send paths. Focused cases cover disabled Opportunity send and schedule plus the disabled Office Early Bird reminder send.
2. Candidate admission and existing candidate editing expose a labeled, date-only reviewed `conventionEndsOn` input. Convention membership/year remains context only; blank evidence stays review. Admission adds the candidate first and then applies the reviewed audited candidate patch because the canonical add-candidate contract does not accept this evidence field.
3. Unknown-identity Office review can search existing opportunities by organization/event name and explicit year, assign the selected identity through `PUT /drafts/office_email/:id/identity`, and refresh exact review. Specific-offer holds remain empty until opportunity, booking, and event year are exact, then include only active holds matching both booking and opportunity.
4. Candidate source-mode changes clear both incompatible selections, result lists, and booking choice. Submission reads only the visible mode's selected identity.
5. Actual send/call evidence can be audited as `additional_attempt` after the three-stage chain, independently of the unavailable next stage. The existing `not_cadence` classification remains available.
6. Research progress counts distinct qualified `opportunityId` values, so multiple reviewed sources for one opportunity count as one profile.
7. Fill/close uses a persistent labeled reason, local busy/error state, refresh-after-success, and input-preserving retry instead of `window.prompt` and an unhandled promise.
8. Exact review and approval requests bind to a draft/content generation. Recipient, subject, body, dirty-state, kind, or draft changes invalidate pending work; late responses cannot restore an old preview or approval for the current send payload.

Minor findings are also addressed. Candidate cards show source/candidate checks, allocation freshness, and explicit `America/Chicago` labels for rendered operational instants. Enabled Office review uses one exact customer-message preview, with retained edits clearly identified and discard available; HTML remains sandboxed. Lead Scout launch now passes the supported anchor, dates, and radius directly into `ScoutLaunchForm`, while the drawer shows the saved adjacent-region, named-package, qualification, and distinct-target criteria. A clean changed-runtime-file compiler supplements the documented whole-project baseline failure.

The existing contributed profile-summary interaction and Office owner-review interaction were retained. No Task 4C opportunity-booking bind route, DTO, control, or test is included. No API-server file was read for implementation beyond the narrow existing DTO shape check, modified, staged, or tested in this round.

### Review-round verification

Final focused frontend command, from `artifacts/adventure-zone`:

```text
../../node_modules/.bin/vitest run --config vitest.config.ts \
  src/components/today/outreach-planner.test.tsx \
  src/pages/OfficeCoordinatorAdminPage.outreach-review.test.tsx \
  src/components/today/master-work-queue.test.tsx \
  src/features/today/today-focus.test.ts \
  src/features/today/today-return-context.test.ts \
  src/components/profiles/profile-email-composer.test.tsx --reporter=dot
```

Result: exit 0; **6 test files passed, 46 tests passed**. The acceptance cases cover I1–I8, the M3 structured Scout prefill, the contributed profile/Office cases, and the existing Today/profile-email regressions.

Clean targeted TypeScript command used a temporary `artifacts/adventure-zone/tsconfig.task4b-fix.json` extending the application config, with `files` limited to the seven changed runtime modules (`outreach-api`, planner, Opportunity composer, Office page, assistant context/drawer, and Scout form), then ran:

```text
../../node_modules/.bin/tsc -p tsconfig.task4b-fix.json --noEmit --pretty false
```

Result: exit 0; **no diagnostics**. The temporary config was removed after the run.

The normal whole-application command was also run once:

```text
../../node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false
```

Result: exit 2 on the documented baseline set in unrelated application modules. It reports no diagnostic in any Task 4B changed runtime file. This does not claim a clean whole-project compiler.

## Re-review fix round 2 — N1–N3

Reviewed base: `73d95bb`. The three findings in `task-4b-rereview.md` are resolved without backend or Task 4C changes:

1. The rollout lookup now distinguishes authoritative `enabled: false` from an unavailable request. An unavailable result keeps Opportunity send/schedule and Office send disabled, displays the local lookup error, and provides a labeled retry. Only an explicit false response restores the existing flag-off delivery path. A successful enabled retry mounts exact final-content review and continues to require its approval.
2. Office identity assignment captures the starting content snapshot and generation before the request. It checks both after the assignment resolves before clearing review state or starting a reload. Review reloads now bind their API request arguments and comparison snapshot to the same render, so recipient, subject, body, dirty-state, kind, or draft changes during assignment prevent old content from restoring a preview or approval.
3. Both general and contextual planner Scout form keys now include every initialized planner value: anchor, start date, end date, and radius. A new launch that changes only the end date remounts the form with the saved end date instead of retaining locally edited state from the previous launch.

### Round 2 verification

Covering frontend command, from `artifacts/adventure-zone`:

```text
../../node_modules/.bin/vitest run --config vitest.config.ts \
  src/components/today/outreach-planner.test.tsx \
  src/pages/OfficeCoordinatorAdminPage.outreach-review.test.tsx \
  src/components/assistant/assistant-drawer.outreach-prefill.test.tsx --reporter=dot
```

Result: exit 0; **3 test files passed, 25 tests passed**. New interactions cover the rejected flag GET followed by an enabled retry, editing exact Office content while identity assignment is pending, and a planner Scout relaunch with only `dateEnd` changed. The same run retains the authoritative disabled Opportunity and Office Early Bird cases and the existing direct stale review/approval cases.

Clean targeted TypeScript command used a temporary `artifacts/adventure-zone/tsconfig.task4b-round2.json` extending the application config, with `files` limited to the four changed runtime modules, then ran:

```text
../../node_modules/.bin/tsc -p tsconfig.task4b-round2.json --noEmit --pretty false
```

Result: exit 0; **no diagnostics**. The temporary config was removed after the run. `git diff --check` also exited 0, and the round contains no Task 4C booking-binding contract or backend file.
