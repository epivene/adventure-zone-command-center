# Connected Leg Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Desiree one booking operations panel that connects prior-season evidence, the saved leg, packages, equipment, route context and missing details, with consistent navigation across the app.

**Architecture:** Add a bounded read projection around the existing booking operations-summary, leg-assignment and resource services. Share its validated contract between the API and one reusable panel; keep existing assignment editors and mutation semantics. Make the combined schedule own its filters and refresh mounted consumers after successful existing edits.

**Tech Stack:** Existing Node 22, TypeScript, pnpm workspace, Express, Drizzle/PostgreSQL, Zod, React/Wouter, Leaflet, Vitest/Testing Library and PGlite. No new dependencies or database migrations.

**Spec:** `docs/superpowers/specs/2026-10-01-connected-leg-operations-design.md` (approved by Desiree October 1, 2026).

**Source baseline:** `16f8896e96b0ef8c424a73ce47328ada824a2464`. Spec commit: `eb7466b8f40717947d342365782409f537c1d224`. Reconcile newer main changes before execution; preserve unrelated work. The first release only is planned here.

## Global Constraints

- "A manager slot is not a physical package set or a verified available crew."
- "Angel and Angelo are different people; Jeremy must not be merged with JR without confirmation."
- "Archived legs remain visible in history and are not suggested as current candidates."
- "Historical crew work is labeled history."
- "The panel does not add a second assignment editor or new mutation path in this release."
- "No green Available or Ready verdict may be inferred from an empty query, a route score, package capacity, crew history or an expired hold."
- "A confirmed customer booking with missing logistics remains confirmed and visibly needs operational work."
- "A missing Google authorization is a connection problem, not an empty calendar."
- "Sending requires her explicit approval of the final correspondence."
- Normal sets remain five Adventure Zone, three Pirates and one Warrior's Playground; split and extra-set enforcement belongs to later releases.
- Use America/Denver for season/date display. Preserve operational windows and source identities. Do not call Google, routing providers or paid AI to assemble this view.
- No permission expansion, live-data repair, external sends, merge or deployment is included in plan execution.

## Review Focus

1. A profile has several bookings in one season, or undated bookings: show choices explicitly; never silently choose another event/year (Tasks 1 and 3).
2. Role checks and partial-read failures interact: denied history/work/crew data must never appear through a fallback path (Tasks 2 and 3).
3. December/January and daylight-saving boundaries: preserve the explicitly selected season, include overlapping windows consistently and do not silently use the browser timezone (Tasks 1 and 4).
4. A slow response returns after selecting another booking: it must not overwrite the newly selected booking's panel (Tasks 3 and 5).
5. Zero coordinates, invalid coordinates and missing pins: valid zero values remain usable; unmapped/unassigned events stay visible as records (Task 4).

## File boundaries and shared contract

Create `lib/api-zod/src/booking-leg-operations.ts` and export it from `lib/api-zod/src/index.ts`. It owns the JSON-safe read contract, not database models or availability rules. Export Zod schemas and inferred types for:

- `OperationsViewer = { kind: 'owner' | 'boss' } | { kind: 'manager'; legId: string }` (server-side viewer is derived from authentication, never from request input).
- `OperationsSection<T> = { state: 'loaded'; data: T } | { state: 'not_recorded' | 'unavailable' | 'restricted'; message: string }`.
- `OperationsBookingOption = { id: string; name: string; status: string; seasonYear: number | null; startsAt: string | null; endsAt: string | null }`.
- `OperationsHistoryItem = { bookingId: string; profileId: string; name: string; seasonYear: number | null; relation: 'same_profile' | 'event_family'; leg: { id: string; name: string; archived: boolean } | null; packageNames: string[]; startsAt: string | null; endsAt: string | null; sources: Array<{ label: string; href: string }> }`.
- `BookingLegOperations = { bookingId: string; profileId: string | null; seasonYear: number | null; bookingStatus: string; assignment: OperationsSection<AssignmentView>; history: OperationsSection<HistoryView>; dates: OperationsSection<DateWindows>; resources: OperationsSection<ResourcesView>; route: OperationsSection<RouteView>; crew: OperationsSection<CrewView>; lodging: OperationsSection<LodgingView>; work: OperationsSection<WorkView>; calendar: OperationsSection<CalendarView> }`.

Section data: `AssignmentView` has separately nullable `assignedLeg` and `suggestion` (leg identity, persisted explanation/source/confidence/warning). `HistoryView` has `basis: 'previous_season' | 'last_known' | 'none'`, `items`, `hasMore`, `historyHref` and `coverage: 'saved_records_only' | 'review_pending'`. `DateWindows` has nullable public and reserved start/end values and reserved source. `ResourcesView` has selected package names, physical allocations, existing warnings and pending special-request count. `RouteView` has nullable previous/next stop identity and stored drive minutes, with estimate provenance/age if recorded. `CrewView` has explicit saved assignment items only; work history is separate labeled evidence. `LodgingView` has verified vehicle/camper/lodging items only. `WorkView` has bounded active-work title/status/next action/link. `CalendarView` has saved connection status, last error code and pending relevant review count, without credentials or account tokens.

No `available`, `ready`, proposed approval or invented crew-count field belongs in the contract. Missing current staffing/lodging models yield `not_recorded`, not an empty verified roster. Section failures do not change `bookingStatus`.

Backend files live in `artifacts/api-server/src/features/bookings/`: new `booking-leg-operations-history.ts`, `booking-leg-operations-repository.ts`, and `booking-leg-operations-service.ts`, with adjacent tests. Reuse `booking-operations-summary.ts`; preserve its existing consumers and warning semantics. Frontend files live in `artifacts/adventure-zone/src/features/bookings/` and `src/components/bookings/`. Do not edit the duplicated legacy backend implementations in the frontend tree or `.migration-backup`.

---

### Task 1: Historical evidence and the read contract

**Files:** Create the shared contract above and adjacent `booking-leg-operations.test.ts`; create backend history/repository files and `booking-leg-operations-history.test.ts`, `booking-leg-operations-repository.pglite.test.ts`; modify shared-contract index.

**Interfaces:** Produce `selectOperationsHistory(targetSeason: number | null, candidates: OperationsHistoryItem[]): HistoryView`. Produce `BookingLegOperationsRepository.loadBase(bookingId: string, viewer: OperationsViewer): Promise<OperationsBaseRecord | null>` and `listProfileBookings(profileId: string, viewer: OperationsViewer): Promise<OperationsBookingOption[]>`. Define `OperationsBaseRecord` in the repository as `{ booking: OperationsBookingOption & { profileId: string | null; travelLegId: string | null }; windows: DateWindows; assignment: AssignmentView; historyCandidates: OperationsHistoryItem[] }`. Access failures throw before returning this record. Database access lives in the repository; history selection is pure.

- [ ] **Step 1: Add failing contract/history tests.** Test names: `keeps_archived_identity_and_multiple_legs`, `does_not_merge_Jeremy_JR`, `previous_season_before_older_last_known`, `ambiguous_family_shows_all_evidence`, `undated_is_not_current_season`, `package_mirrors_do_not_duplicate_booking`.

  Assertions include `expect(result.items.map(x => x.leg?.name)).toContain('Angelo')`, Jeremy and JR retain distinct IDs, prior-season history wins over older records, and two linked package mirrors produce one booking with both package names. The last-known display labels its actual year. Unknown dates remain null. A shared organizer without explicit event-family membership supplies no match.

- [ ] **Step 2: Run the tests and verify the missing contract/provider fails.** Run `pnpm --filter @workspace/api-server test src/features/bookings/booking-leg-operations-history.test.ts src/features/bookings/booking-leg-operations-repository.pglite.test.ts`.
- [ ] **Step 3: Implement the schemas, repository and selection function.** Use canonical booking IDs and explicit profile/family relationships; never deduplicate by title alone. Derive season from stored public event dates in America/Denver; undated stays unknown. Group mirrors by their linked booking ID; preserve multiple distinct historical bookings/legs. Return at most 20 historical items, mark `hasMore`, and link to existing history. Use existing source-calendar link identities; allow only internal app links and HTTPS source links. Never inspect arbitrary note text to infer identity or crew availability.
- [ ] **Step 4: Add and run persistence tests.** PGlite fixtures cover same-profile/family matching, duplicate mirrors, revoked/outside-leg access and a cross-year public date. Check read calls leave booking status, assignment, resources and calendar links unchanged. Run the command from Step 2 and `pnpm exec vitest run lib/api-zod/src/booking-leg-operations.test.ts`; expect all passing.
- [ ] **Step 5: Commit only this task's files.** Commit message: `feat: add bounded booking leg history contract`.

### Task 2: Shared summary service and authorized read routes

**Files:** Create backend service and adjacent service tests; create `artifacts/api-server/src/routes/booking-leg-operations.ts` and `.test.ts`; modify `routes/index.ts`. Reuse existing operations-summary, leg-assignment repository, calendar link/connection repository and booking-work repository.

**Interfaces:** Produce `BookingLegOperationsService.get(bookingId: string, viewer: OperationsViewer): Promise<BookingLegOperations | null>` and `listProfileBookings(profileId: string, viewer: OperationsViewer): Promise<OperationsBookingOption[]>`. Inject providers so route/resource/calendar/work failures are testable independently. Produce `createBookingLegOperationsRouter(dependencies: { service: BookingLegOperationsService; requireOwner: RequestHandler; requireBoss: RequestHandler; requireManager: RequestHandler }): IRouter`, using Express's existing handler/router types.

- [ ] **Step 1: Add failing tests.** `suggestion_does_not_allocate`, `resource_failure_preserves_history_and_status`, `connected_badge_does_not_prove_import_coverage`, `reauthorization_is_visible`, `denied_work_is_not_partial_fallback`, `manager_cannot_read_other_leg`, `invalid_uuid_and_booking_profile_mismatch`.

  Assert separate assignment/suggestion fields, original confirmed status, explicit unavailable/not-recorded/restricted sections, and no token/worker private-note fields in JSON. `expect(routeResponse.status).toBe(403)` for an authenticated manager requesting another leg; an unauthorized principal gets 401 before providers run. Known saved reauthorization errors remain visible; connected status still reports saved-record-only coverage.

- [ ] **Step 2: Run `pnpm --filter @workspace/api-server test src/features/bookings/booking-leg-operations-service.test.ts src/routes/booking-leg-operations.test.ts`; verify failure before implementation.**
- [ ] **Step 3: Implement the service and route factory.** Request-scoped operations-summary caching only. Read persisted leg decisions without invoking `evaluate`, `suggest`, provider estimates, imports or syncs. Combine independently loaded sections with settled results; handle only section errors locally, never authentication/access failures. Select adjacent saved stops for display; mark missing/stale estimates, without claiming a new feasibility verdict. Read saved Google connection status/lastErrorCode and relevant review records. No current crew/lodging assignment storage means Not recorded; do not upgrade `crew_work_history` into future assignments.
- [ ] **Step 4: Mount read endpoints.** Owner: `GET /bookings/:id/leg-operations`, `GET /event-profiles/:profileId/leg-operations-bookings`. Boss: `/boss/bookings/:id/leg-operations`, `/boss/profiles/:profileId/leg-operations-bookings`. Manager: `/manager/bookings/:id/leg-operations`, scoped to the authenticated leg. Owner routes use `requireOwnerMiddleware`; boss/manager routes use existing role middleware, mounted in their authenticated route section. Booking-list responses are `{ bookings: OperationsBookingOption[] }`; validate ownership of profile/booking links. Boss can read facts but work-queue visibility follows existing permissions. Manager payloads exclude unrelated profile bookings, other-leg crew details and unauthorized history, and never expose owner-only actions.
- [ ] **Step 5: Run Step 2 tests plus `pnpm --filter @workspace/api-server typecheck` and existing `src/features/chatgpt-connection/operational-reads.pglite.test.ts`; expect passing.** Include spies asserting no mutation, Google network, routing estimate or AI methods ran during reads. Keep existing connector contract unchanged; a new Com read tool is deferred.
- [ ] **Step 6: Commit this task.** Message: `feat: expose shared role-scoped leg operations summary`.

### Task 3: Booking/profile panel and explicit booking-year selection

**Files:** Create frontend `features/bookings/booking-leg-operations-client.ts`, `use-booking-leg-operations.ts`, `select-profile-operations-booking.ts`; create `components/bookings/leg-operations-panel.tsx` and `profile-leg-operations.tsx` with adjacent tests; create `pages/BossProfilePage.leg-operations.test.tsx`; modify `pages/BookingDetailPage.tsx`, `EventProfilePage.tsx`, `BossProfilePage.tsx`, and `ManagerOperationsPage.tsx`.

**Interfaces:** Produce `OperationsReadClient = { getBooking(id: string): Promise<BookingLegOperations>; listProfileBookings(id: string): Promise<OperationsBookingOption[]> }` using existing owner/boss/manager transports. Produce `useBookingLegOperations(bookingId: string | null, client: OperationsReadClient)` returning `{ data, loading, error, reload }`. Produce `LegOperationsPanel({ operations, role, onRetry })`, and `ProfileLegOperations({ profileId, client, role, search, onSearchChange })`. Selection helper returns a booking only for an explicit valid ID or exactly one booking in an explicitly selected season; otherwise it returns choices/empty.

- [ ] **Step 1: Add failing tests.** `shows_last_season_source_and_saved_assignment`, `unknown_crew_and_lodging_not_available`, `multiple_bookings_require_choice`, `requested_booking_wrong_profile_is_rejected`, `slow_old_request_cannot_replace_new_selection`, `boss_same_facts_fewer_controls`, `manager_no_owner_links`. Assert exact labels Assigned, Suggested, Needs details, Not recorded and Unavailable; no Ready/Available badge.
- [ ] **Step 2: Run `pnpm --filter @workspace/adventure-zone test src/components/bookings/leg-operations-panel.test.tsx src/components/bookings/profile-leg-operations.test.tsx src/features/bookings/use-booking-leg-operations.test.tsx`; verify failure before implementation.**
- [ ] **Step 3: Implement client, selection and hook.** Validate response with the shared Zod schema. Cancel/ignore stale async results when booking/client changes; clear old data while loading a new booking. Keep chosen `season` and `bookingId` in profile query parameters, preserving contact, return-path and unrelated existing parameters. Default to the current business year with an explicit visible selector; unknown-year bookings remain a separate choice. No booking in the year gives an explanation and existing booking-creation action where permitted.
- [ ] **Step 4: Implement and mount the same compact panel.** Render stacked history, current leg, dates/route, packages/allocations, staffing/lodging and next-action sections. Preserve existing profile content and shared-work cards; do not copy task status into readiness. Owner links open existing booking edit/package editor, crew and Google settings. Boss links use authorized boss navigation and existing reassignment permissions. Manager chooses an assigned event from existing scoped map/dashboard data in Trip operations; no new broad profile picker. Unavailable/restricted sections have retry or factual labels, not empty success. Make source links accessible and preserve archived historical names.
- [ ] **Step 5: Run Step 2 tests plus `pnpm --filter @workspace/adventure-zone test src/pages/BookingDetailPage.assistant-context.test.tsx src/pages/EventProfilePage.test.tsx src/pages/BossProfilePage.leg-operations.test.tsx src/pages/ManagerOperationsPage.test.tsx`.** Verify no additional paid assistant-context call is triggered by the new panel. Inspect folded/unfolded widths without horizontal page scrolling.
- [ ] **Step 6: Commit this task.** Message: `feat: connect booking and profile leg operations views`.

### Task 4: One schedule/map filter and consistent route links

**Files:** Modify `pages/SchedulePage.tsx`, `RoutesPage.tsx`, `components/routes/event-map.tsx`; create `features/bookings/operations-navigation.ts` and tests; extend `SchedulePage.test.tsx`, `RoutesPage.workflow-split.test.ts`, `event-map.combined-controls.test.ts`, `event-map.test.tsx`. Reuse current schedule status helpers.

**Interfaces:** Produce `operationsScheduleHref(input: { season: number; legId?: string | null; status?: string; bookingId?: string }): string`. Extend EventMap with `controlledSeasonYear?: number` and `onSeasonYearChange?: (year: number) => void`, preserving existing `requestedSeasonYear` behavior for standalone consumers. A controlled map never maintains a competing selected year.

- [ ] **Step 1: Add failing tests.** `embedded_2027_never_defaults_2026`, `embedded_reset_keeps_parent_season`, `url_back_forward_updates_filters`, `cross_year_window_matches_selected_season`, `unmapped_unassigned_still_listed`, `zero_coordinates_are_valid`. Assert `operationsScheduleHref({season:2027,legId:'angel',status:'all'})` includes season/leg and does not include an unnecessary status parameter.
- [ ] **Step 2: Run `pnpm --filter @workspace/adventure-zone test src/pages/SchedulePage.test.tsx src/components/routes/event-map.combined-controls.test.ts src/components/routes/event-map.test.tsx src/features/bookings/operations-navigation.test.ts`; verify the new cases fail.**
- [ ] **Step 3: Implement controlled embedded season.** Schedule owns year/leg/status; sync state when Wouter search changes, not only initial mount. Routes passes the selected year to EventMap and routes map-year/reset changes back to Schedule. Do not let map reset select the current year when embedded. Standalone map remains independently usable. Preserve map focus and existing status semantics; pass the same filter scope to visible counters, records and map pins.
- [ ] **Step 4: Implement navigation and missing-record display.** Use explicit business-year/date semantics and overlapping public/reserved windows consistently in the combined view; do not silently discard undated records. List undated records separately with Needs dates, unmapped with Needs mapping, and unassigned with Needs leg. Zero latitude/longitude are valid within geographic bounds; invalid/missing coordinates stay in the list. Operations route/profile links preserve season, leg and existing status filters. Do not geocode automatically or alter source windows.
- [ ] **Step 5: Run Step 2 plus `pnpm --filter @workspace/adventure-zone test src/pages/RoutesPage.workflow-split.test.ts src/features/routes/map-focus.test.ts src/pages/BossSchedulePage.test.tsx src/pages/BossSchedulePage.event-data.test.tsx`; expect passing.** Verify a 2027 booking opens the 2027 map/calendar and returns to the same profile booking selection.
- [ ] **Step 6: Commit this task.** Message: `fix: keep connected operations schedule and map filters consistent`.

### Task 5: Refresh consumers after existing booking edits

**Files:** Create frontend `features/bookings/booking-operations-changes.ts`, `.test.ts`, `pages/BookingEditPage.test.tsx`; modify `actions/bookings.ts`, operations hook, `BookingDetailPage.tsx`, `EventProfilePage.tsx`, `BossProfilePage.tsx`, `RoutesPage.tsx`, and `CalendarPage.tsx`. Extend affected page tests; preserve current transports.

**Interfaces:** Produce `notifyBookingOperationsChanged(bookingId: string): void` and `subscribeBookingOperationsChanges(listener: (bookingId: string) => void): () => void`. This is an in-session invalidation signal, not another store or assignment record. Consumers refetch canonical APIs; mounted profile listeners may reload their booking list for any booking change.

- [ ] **Step 1: Add failing tests.** `successful_edit_notifies_once`, `failed_edit_does_not_notify`, `package_resource_changes_refresh_warnings`, `dispose_unsubscribes`, `focus_refreshes_external_change`, `older_reload_cannot_restore_previous_leg`. Assert changed assignment is read back from the server, not guessed from a request payload.
- [ ] **Step 2: Run `pnpm --filter @workspace/adventure-zone test src/features/bookings/booking-operations-changes.test.ts src/features/bookings/use-booking-leg-operations.test.tsx src/pages/BookingEditPage.test.tsx`.** Verify the new invalidation assertions fail before wiring them.
- [ ] **Step 3: Implement notifications only after existing successful update/package/resource/special-request actions.** Do not modify backend save/automatic-assignment behavior or add a new writer. Consumers subscribe with cleanup and refetch on relevant notifications, mount/navigation and browser focus. Refetches must preserve filters/selection and guard stale responses. A boss or manager change made elsewhere is reflected on focus/reload; do not imply cross-device push updates.
- [ ] **Step 4: Run the focused action/hook/page tests.** A fixture reassigned through the existing editor must show the new leg in the panel, profile, calendar and route map after refetch. A rejected save retains the old assignment and displays the existing error. No new duplicate record or role capability is introduced.
- [ ] **Step 5: Commit this task.** Message: `fix: refresh connected operations after booking changes`.

### Task 6: Integrated acceptance and reviewable delivery

**Files:** Add `artifacts/adventure-zone/src/pages/ConnectedLegOperations.integration.test.tsx`; add `docs/verification/2026-10-01-connected-leg-operations.md` with actual test and preview results. Adjust earlier task files only for failures found here.

**Interfaces:** Consumes Tasks 1–5 without adding API fields or new subsystem behavior. Produces one reviewable first-release branch and verification record.

- [ ] **Step 1: Add an integrated fixture test.** A returning 2027 event shows Angel's 2026 evidence, an independently saved 2027 assignment and unknown current crew/lodging; a package conflict stays visible. Reassign through the existing mocked edit path, navigate between profile/booking/2027 calendar/map, and assert all refetched views share the new leg and year. A historical Angelo booking remains history. Assert no outbound send/AI/import calls.
- [ ] **Step 2: Run the integrated test and all new/affected tests from Tasks 1–5.** Record actual commands and results; failures unrelated to this branch must be identified, not suppressed. Fix any introduced failures.
- [ ] **Step 3: Run `pnpm run typecheck`, `pnpm --filter @workspace/api-server build`, and `pnpm --filter @workspace/adventure-zone build`; expect successful exits.** Use the existing lockfile/package manager; do not install new product dependencies.
- [ ] **Step 4: Inspect the local preview at 360px, 768px and desktop widths using authorized test fixtures.** Check owner, boss and manager controls; year selection; partial errors; edit/return refresh; missing pins. Store concise screenshots and verification evidence with the branch. No live booking/customer changes are needed.
- [ ] **Step 5: Commit verification and complete branch review.** Review against the approved first-release acceptance items; explicitly note that historical reconciliation, full availability checks, structured splits and new Com mutations remain later releases. Open a draft PR with the concrete resulting behavior and actual validation. Do not merge or deploy.

## Self-review and execution handoff

Spec first-release requirements map to Tasks 1–6: history/identity/source gaps (1–2), same panel and state separation (2–3), role/phone access (2–3/6), shared filters/missing records (4), existing-edit consistency (5–6), partial failures and no external side effects (2–3/6). All five Review Focus inputs have named tests in their owning tasks. Exact shared schemas/signatures are established before consumers. Later-release enforcement and new Com writes are deliberately outside this plan.

Recommended execution method: **Native**, with the same agent implementing sequentially and one independent whole-branch review afterward. The tasks share one read contract and need consistent navigation/refresh wiring; this keeps context and cost lower while preserving a final review. **Subagent-driven** is the alternative: separate implementation and review workers per task, with greater independent review coverage and higher context cost.

Desiree reviews this written plan and selects an execution method before implementation starts. No product code was changed while writing it.
