# Leg Planning and Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save real leg operating plans, enforce staffing/equipment constraints and attributed approvals, and present the same results throughout the existing operations workflow.

**Architecture:** Extend existing booking/leg/resource identities with dated staffing, verified package sets, operating drafts and immutable approval decisions. A shared deterministic evaluator feeds scoped reads and transactional commitments. Reuse the existing allocation mutex and canonical reservation projection rather than creating a competing ledger.

**Tech Stack:** Node 22, pnpm 10, TypeScript, Express, Drizzle/PostgreSQL, Zod, React/TanStack Query/Wouter, Vitest/Testing Library and PGlite; no new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-leg-planning-and-approvals-design.md`, approved by Desiree October 1, 2026; spec commit `4929a8c`.

**Source baseline:** Remote merged main inspected at `03dd72044e1ec51ac28768a82b41846e918617dc`. Local checkout contains synthetic ancestry; do not push that ancestry. At execution, read applicable instructions and create an isolated checkout/worktree from current remote main, then carry the approved spec and plan forward. Reconcile intervening changes before implementation.

## Global Constraints

- "The nine current planning slots are Dave, Hulk, Kristy, Mikey, Angel, Jeremy (tentative), and three unfilled slots."
- "Angel and archived Angelo remain separate; Jeremy is not assumed to be archived JR."
- "Mouth is excluded from current assignments and preserved in history."
- "Saving an incomplete draft is allowed."
- "There is no second canonical booking-leg assignment."
- "Historical work and rehire eligibility remain separate evidence."
- "Do not invent a universal minimum."
- "Five simultaneous complete sets normally; a sixth requires Dave's approval and a verified equipment/staffing plan for the affected dates."
- "Three normally; a fourth requires Dave's approval and verified additional equipment/staffing."
- "One physical setup; no simultaneous duplicate and no override."
- "Dave **or the relevant leg manager** approves the exact two-site plan."
- "Prefer Adventure Zone plus a smaller Pirates or Warrior package. Two full Adventure Zone events require explicit strategic review, not an automatic prohibition."
- "Split approval neither creates resources nor approves a sixth Adventure Zone or fourth Pirates set."
- "A generic acknowledgement can document awareness but cannot waive physical overlap, unavailable equipment, insufficient staff, duplicate Warrior use or the approval rules below."
- "Customer correspondence still requires Desiree's review and explicit instruction to send."
- Preserve public versus reserved dates, original historical identities and commercial booking status. Source-aware date handling uses America/Denver; no global timezone migration.
- No fabricated inventory/staff, live data repair, calendar-wide reconciliation, new connector mutation scopes, automatic provider calls, messages, paid AI, merge or deployment.

## Review Focus

1. An identical request key is retried with a different body: reject the mismatch, never replay another mutation's receipt (Task 5).
2. A worker has several availability intervals, including a conflicting unavailable interval: require full confirmed coverage and let unavailable evidence win (Task 3).
3. A split spans December/January or crosses a daylight-saving transition: retain the selected season, normalize each source window and compare instants correctly (Tasks 2 and 4).
4. Dave's account is disabled or authority is rebound after approval: require fresh authorized review; never trust a historical display name (Task 4).
5. A response or save completes after switching event/season: invalidate its own booking, without replacing the newly selected editor or draft (Task 7).

## File boundaries and contracts

New shared JSON contracts live in `lib/api-zod/src/leg-planning.ts`, exported from `lib/api-zod/src/index.ts`. New backend units live under `artifacts/api-server/src/features/leg-planning/`: `planning-repository.ts` owns persistence, `planning-facts.ts` projects authoritative evidence, `operational-window.ts` normalizes dates, `readiness-policy.ts` evaluates facts, `approval-policy.ts` checks decisions/fingerprints, `planning-service.ts` coordinates authorized reads/writes, and `planning-writer-hooks.ts` invalidates or checks legacy writes. Policy files never call providers or databases.

Define these public types and matching schemas in Task 1:

- `PlanningActor`: owner with the existing authenticated owner subject; boss with authenticated account ID/session version; manager with authenticated leg ID/session version and principal `manager-leg:<legId>`. HTTP bodies cannot supply it. Existing manager credentials are per leg, not individual-person accounts; the audit identifies that credential and its configured manager label, without claiming individual identity proof. Extend manager middleware to retain the server-verified session version.
- `WindowInput`: nullable start/end strings, `semantics: timestamp | inclusive_date | exclusive_date`, source label. `OperationalWindow`: UTC start/end milliseconds with half-open end, source label. `WindowResult`: resolved window or `needs_review` with reason codes.
- `PlanRequirements`: nullable minimum crew, required-role counts, nullable transport requirement, lodging state `unknown | required | unnecessary` and an explicit unnecessary reason.
- `PlanDraft`: booking ID, proposed leg ID, season year, nullable explicit window, optional arrival/setup/operating/teardown/departure windows, requirements, worker/role/window assignments with proposed/confirmed state, package-set IDs, transport resource IDs, lodging entries (dates/location/capacity/source), nullable split-group ID. Package demand comes from canonical selections, not client counts.
- `EventPlan`: booking ID, numeric revision, draft, nullable last committed snapshot, invalidation reasons. `LegSeasonPlan`: leg ID, season, revision, confirmed/tentative/unfilled leadership, nullable responsible manager worker ID/name, worker IDs and verified base/transport defaults. A manager worker reference is optional and never fabricated from a leg name.
- `PackageSet`: ID, canonical package ID, name, normal/extra classification, unverified/verified state, composition revision and real resource IDs. Required composition is explicitly configured as resource categories/counts; a verifier records actor/time/source. Zero or unconfigured composition cannot be verified.
- `PlanFacts`: draft and revision; canonical booking/window/demand; scoped worker status and availability; package sets/composition; resource state; canonical obligations and active holds; travel evidence; relevant authority, approval requests/decisions and clock. Each obligation has canonical ID, booking/leg, window, worker/resource IDs and package quantities; mirrored booking/trip IDs collapse only with explicit linkage.
- `ReadinessResult`: overall `conflict | needs_review | needs_details | verified_plan`, dimension results for crew/equipment/dates_travel/accommodation/approval, typed reason codes and scoped next-action links, evaluated timestamp and facts fingerprint.
- `ApprovalRequest`: ID, split/extra_adventure_zone/extra_pirates type, exact booking IDs, parent leg, reviewed plan fingerprint, pending/decided state. `ApprovalDecision`: request ID, approved/declined/revoked, authenticated actor, authority revision, timestamp, reason and strategic-two-AZ acknowledgement.
- `PlanningRead`: nullable event plan, readiness, permitted actions and scoped requests/decisions. `MutationResult<T>`: receipt ID, resulting value, affected booking IDs, idempotent flag. Mutation input includes `requestKey` and `expectedRevision`; batch commit carries the expected revision of each booking.
- `RevisionWrite<T>`: payload `T`, request key and nullable expected revision (null means create only). Typed setup payloads are `LegSeasonPlanInput` (season plan without server revision), `CrewAvailabilityInput` (nullable row ID, worker ID, window, confirmed/unavailable/unverified state and source), `PackageSetInput` (set without server verification metadata; explicit verify action/source), `SplitGroupInput` (nullable group ID, parent leg and exactly two booking IDs), and `DaveAuthorityInput` (enabled boss account ID or null to revoke). Split and availability rows have revisions too.

New tests use `features/leg-planning/planning-fixtures.ts`, exporting `completeFacts(overrides?: Partial<PlanFacts>): PlanFacts`, `draft(overrides?: Partial<PlanDraft>): PlanDraft`, and fixture builders for actors, obligations and approval decisions. These are local test fixtures, never startup seeds. Readiness tests mutate one fact of a complete baseline, so failures demonstrate the business rule rather than mirroring implementation.

## Task 1: Persist drafts, staffing, package sets and decision history

**Files:** Create `lib/db/src/leg-planning-schema.ts`, `lib/db/migrations/20261001_leg_planning.sql`, `lib/api-zod/src/leg-planning.ts`, `artifacts/api-server/src/features/leg-planning/planning-repository.ts`, `planning-fixtures.ts` and `planning-repository.pglite.test.ts`; create `artifacts/api-server/src/db/leg-planning-required-startup.ts` and its test. Modify `lib/db/src/index.ts`, `lib/db/src/drizzle-schema.ts`, `lib/db/src/migrations.ts`, `lib/db/package.json`, `lib/api-zod/src/index.ts`, `artifacts/api-server/src/db/required-schema-startup.ts` and its test.

**Interfaces:** Produce the contracts above and `DrizzlePlanningRepository.readBooking(bookingId: string, actor: PlanningActor): Promise<EventPlan | null>`, `readSeason(legId: string, seasonYear: number, actor: PlanningActor): Promise<LegSeasonPlan | null>`, `saveDraftIn(tx: AllocationTransaction, input: PlanDraft, expectedRevision: number | null): Promise<EventPlan>`. `ensureLegPlanningSchemaBeforeListen(): Promise<void>` checks required constraints/indexes, not just table presence.

- [ ] Write tests asserting: empty installation returns null plans; migration does not alter nine current legs/history or seed workers/resources; duplicate leg/season and booking plans are rejected; stale draft revision fails; malicious non-UUID references fail; missing required schema prevents readiness startup.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/leg-planning/planning-repository.pglite.test.ts src/db/leg-planning-required-startup.test.ts`; expect missing module/schema failures.
- [ ] Implement additive tables: `leg_season_plans` (unique leg/season), `crew_availability`, `package_sets`, `package_set_members`, `leg_event_plans` (unique booking; versioned validated JSON snapshots), `leg_plan_crew_commitments` (indexed worker/time), `leg_plan_splits` (exact two branch bookings), `leg_plan_approval_requests`, append-only `leg_plan_approval_decisions`, singleton `leg_plan_authorities`, and `leg_plan_mutation_receipts` (unique actor/request key and body hash). Foreign keys reference existing identities. Index all overlap queries. Decisions have no update/delete repository methods. Bind schema startup to `LEG_PLANNING_ENABLED=true`, expose capability only after successful verification. Add migration marker checks and schema exports.
- [ ] Rerun the two tests; expect all assertions to pass. Run `pnpm run typecheck:libs`.
- [ ] Commit the schema, contract and repository deliverable: `feat: persist leg operating plans and approval evidence`.

## Task 2: Resolve dates and project canonical obligations

**Files:** Create backend `operational-window.ts`, `operational-window.test.ts`, `planning-facts.ts`, `planning-facts.pglite.test.ts`. Read/reuse `features/outreach-planner/outreach-capacity-evidence.ts`, `features/bookings/booking-leg-operations-repository.ts`, `features/resources/resource-repository.ts` and `features/leg-assignment/leg-feasibility.ts`.

**Interfaces:** Consume Task 1 types. Produce `resolveOperationalWindow(input: WindowInput): WindowResult`, `loadPlanFacts(tx: AllocationTransaction, bookingIds: string[], actor: PlanningActor, now: Date): Promise<PlanFacts[]>` and `planningFingerprint(facts: PlanFacts): string`. Fingerprints sort IDs and include material scoped facts, not unrelated notes or a global generation counter.

- [ ] Add tests with assertions including `resolveOperationalWindow({startsAt:'2027-07-21',endsAt:'2027-07-26',semantics:'exclusive_date',source:'google'}).window.endMs === Date.parse('2027-07-26T06:00:00Z')`; year-9999 and reversed intervals return needs_review. Cover longer reserved windows, March DST, December/January and selected season preservation. Assert linked booking/trip resource mirrors yield one obligation, distinct bookings two, expired holds none, unresolved source dates needs_review and unrelated edits the same fingerprint.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/leg-planning/operational-window.test.ts src/features/leg-planning/planning-facts.pglite.test.ts`; expect failures before the resolver/projector exists.
- [ ] Implement half-open interval normalization with existing timezone utilities. Load canonical allocations, active holds, crew commitments, verified composition and endpoint-matched travel evidence without network calls. An explicit plan window must encompass required verified operating phases and cannot shorten an existing real reserved window. Missing travel verification, changed endpoints or source-declared stale estimates remain review reasons. Returning expectations and history stay labeled evidence, not hard reservations.
- [ ] Rerun these tests; expect passing projection, provenance and date assertions.
- [ ] Commit: `feat: project source-aware leg planning obligations`.

## Task 3: Evaluate crew, equipment, travel and accommodation

**Files:** Create backend `readiness-policy.ts`, `readiness-policy.test.ts`; extend `planning-fixtures.ts`.

**Interfaces:** Produce `evaluatePlanReadiness(facts: PlanFacts, approvals: ApprovalEvaluation): ReadinessResult`. `ApprovalEvaluation` is a Task 1 contract containing passed/pending/invalid approvals and narrowly scoped approved split/extra-set grants. Task 4 supplies its real evaluator; tests here use explicit fixtures.

- [ ] Add a missing-requirements test with `const facts = completeFacts(); facts.draft.requirements.minimumCrew = null; expect(evaluatePlanReadiness(facts, approvals).overall).toBe('needs_details')`. Assert missing roles, unverified inventory, proposed crew and unknown lodging never yield verified_plan. Assert worker overlap, maintenance equipment and unavailable intervals yield conflict. Union adjacent confirmed availability intervals must cover the entire assignment; an unavailable interval wins. Shared resource IDs across differently named sets still conflict.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/leg-planning/readiness-policy.test.ts`; expect missing evaluator failures.
- [ ] Implement the pure evaluator and reason enums. Check required-role counts and confirmed availability; reject do-not-rehire confirmed staff. Require verified configured composition matching selected packages and actual resource status/windows. Reuse canonical interval capacity evaluation with exact AZ5/Pirates3/Warrior1 limits, capped grants AZ6/Pirates4. For a proposed sixth AZ or fourth Pirates with otherwise valid supply, return pending-approval needs_review; seventh AZ/fifth Pirates/second Warrior are hard conflicts. A prospective extra-capacity request does not waive any staffing/resource conflict. Treat missing transfer evidence as review and insufficient time as conflict. Validate transport when required, lodging window/capacity/source when required, and explicit reason when unnecessary. Overall precedence is conflict, needs_review, needs_details, verified_plan.
- [ ] Rerun tests covering capacity boundaries 5/6/7, 3/4/5 and 1/2, timestamped evidence, absent history, existing warnings acknowledged and completed tasks; expect no false readiness.
- [ ] Commit: `feat: evaluate verified leg plan readiness`.

## Task 4: Attribute approvals and validate strategic splits

**Files:** Create backend `approval-policy.ts`, `approval-policy.test.ts`; extend repository decision methods and fixtures.

**Interfaces:** Produce `evaluateApprovals(facts: PlanFacts): ApprovalEvaluation` and `authorizeDecision(actor: PlanningActor, request: ApprovalRequest, facts: PlanFacts, decision: ApprovalDecisionInput): DecisionAuthorization`. `ApprovalDecisionInput` contains only approved/declined/revoked, reason and strategic acknowledgement; actor/timestamp/fingerprint come from the server. Repository produces `appendDecisionIn(tx, requestId, actor, input): Promise<ApprovalDecision>`.

- [ ] Test split authorization by Dave or the exact parent-leg manager; unrelated manager and generic boss fail. Test extra AZ/Pirates Dave-only binding; owner-supplied approvedBy ignored/rejected. Two-AZ split requires explicit strategic acknowledgement and sufficient disjoint staffing, but does not become Dave-only. Disabled/rebound authority, changed crew/window/composition and revocation invalidate decisions; identical edits and unrelated notes do not. Test cross-year split branches and repeated request rejection.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/leg-planning/approval-policy.test.ts`; expect absent policy failures.
- [ ] Implement authority revision and canonical plan fingerprints. Define DecisionAuthorization as allowed or denied with authority/stale/evidence/conflict reason codes. Requests cover exact branches/windows/resources. Decision submission evaluates a prospective grant for precisely the request, removing only its pending-approval reason to avoid circular validation; required equipment/staffing and every other independent approval remain enforced. A split may be reviewed while an extra-set decision is pending, but commitment waits for both. Approval can remain valid while later conflicting obligations make readiness conflict; it never suppresses those conflicts. Same-leg overlap exception applies only to the approved group with feasible disjoint workers/resources; extra-capacity grants stay independent.
- [ ] Rerun tests; expect exact authority, strategic review and invalidation behavior.
- [ ] Commit: `feat: authorize scoped leg split and extra set decisions`.

## Task 5: Commit atomically and protect existing writers

**Files:** Create backend `planning-service.ts`, `planning-writer-hooks.ts`, `planning-service.test.ts`, `planning-commit.pglite.test.ts`, `planning-commit.postgres.test.ts`. Modify `features/outreach-planner/outreach-allocation.ts`, `outreach-commitments.ts`, `outreach-raw-reconciliation.ts`; modify `features/bookings/booking-repository.ts`, `booking-relationship-repository.ts`, `features/packages/package-repository.ts`, `features/resources/resource-repository.ts`, `features/trips/trip-repository.ts`, `features/leg-assignment/leg-assignment-repository.ts`, `features/routes/travel-leg-repository.ts`. Extend `20261001_leg_planning.sql` and startup checks for writer participation.

**Interfaces:** Produce `LegPlanningService.get(bookingId: string, actor: PlanningActor): Promise<PlanningRead | null>`, `saveDraft(actor: PlanningActor, input: RevisionWrite<PlanDraft>): Promise<MutationResult<EventPlan>>`, `commitPlans(actor: PlanningActor, input: {bookingIds: string[]; expectedRevisions: Record<string,number>; requestKey: string}): Promise<MutationResult<EventPlan[]>>`, `requestApproval(actor: PlanningActor, input: RevisionWrite<{type: ApprovalRequest['type']; bookingIds: string[]; parentLegId: string}>): Promise<MutationResult<ApprovalRequest>>`, `decideApproval(actor: PlanningActor, input: RevisionWrite<{requestId: string; decision: ApprovalDecisionInput}>): Promise<MutationResult<ApprovalDecision>>`. Setup methods `saveSeason`, `saveAvailability`, `savePackageSet`, `saveSplit`, `saveDaveAuthority` each accept `(actor: PlanningActor, input: RevisionWrite<CorrespondingInput>)` and return `Promise<MutationResult<CorrespondingRecord>>`; corresponding types are respectively LegSeasonPlanInput/LegSeasonPlan, CrewAvailabilityInput/CrewAvailability, PackageSetInput/PackageSet, SplitGroupInput/SplitGroup and DaveAuthorityInput/DaveAuthority. Define those record schemas with row revision/server attribution in Task 1. Return structured 403/409/422 errors. `checkPlanningWriteIn(tx: AllocationTransaction, before: PlanFacts[], after: PlanFacts[], mode: 'commitment' | 'reconciliation'): Promise<void>` protects old writers without importing HTTP.

- [ ] Test stale revision rollback, matching-key retry receipt identity, mismatching-body retry rejection and full rollback after a branch failure. Test manual booking/date/leg edits invalidate existing plans without changing customer status; confirmed crew/resource writes reject new physical conflicts. Exercise existing configure-packages/resources, trips, hold creation, automatic/manual leg assignment, resource status and calendar reconciliation paths. Verify both flag combinations: planning enabled/outreach disabled and both enabled.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/leg-planning/planning-service.test.ts src/features/leg-planning/planning-commit.pglite.test.ts`; expect missing service/hook failures.
- [ ] Implement shared lock participation whenever outreach allocation **or** leg planning is enabled, while keeping outreach UI/provider gating separate. Initialize and verify the existing allocation mutex/receipt schema before exposing planning. Reuse `withAllocationTransaction` and its allocation mutex then advisory lock `908092026`, then sorted leg/worker/resource row locks. Extend existing receipt guards to new obligation tables. Do not nest `commitmentTransaction` or broadly remove its single-booking protection: the new explicit two-branch split commit uses its own reviewed encompassing mutation under the same lock. Recheck live facts and all expected revisions inside the transaction; update canonical booking leg, resource assignments, confirmed crew rows, accepted snapshots and receipt together. Existing date/status reconciliation can invalidate readiness; confirmed allocation writers cannot bypass hard constraints. Legacy overrides never become grants.
- [ ] Run local PostgreSQL concurrency tests with `LEG_PLANNING_TEST_DATABASE_URL` pointing only to a disposable local database: two concurrent commits for one resource/worker produce one success and one conflict; a concurrent hold and plan commit serialize; a two-branch rollback leaves neither branch committed. PGlite tests cover deterministic behavior, not proof of concurrency. If local PostgreSQL is unavailable, record the unperformed check and do not claim concurrency verification.
- [ ] Commit: `feat: enforce atomic leg planning commitments across writers`.

## Task 6: Add scoped routes and connected read sections

**Files:** Create `artifacts/api-server/src/routes/leg-planning.ts`, `leg-planning.test.ts`; extend `routes/index.ts`, `features/bookings/booking-leg-operations-service.ts`, `booking-leg-operations-providers.ts`, their tests, `features/leg-manager/leg-manager-middleware.ts` and its affected tests, and `lib/api-zod/src/booking-leg-operations.ts` with its test. Create backend `planning-view.ts`, `planning-view.test.ts`.

**Interfaces:** `createLegPlanningRouter({service, requireOwner, requireBoss, requireManager}): IRouter` exposes role-prefixed `/bookings/:id/operating-plan` GET/PATCH, `/operating-plans/commit` POST, `/leg-seasons/:legId/:year` GET/PATCH, `/crew-availability` GET/POST and `/crew-availability/:id` PATCH, `/package-sets` GET/POST and `/package-sets/:id` PATCH, `/leg-splits` POST and `/leg-splits/:id` PATCH, `/leg-approvals` GET/POST and `/leg-approvals/:id/decision` POST. Owner-only `/leg-planning/dave-authority` GET/PATCH configures the enabled boss-account binding. `toPlanningView(facts: PlanFacts, actor: PlanningActor): PlanningRead` redacts unrelated obligations. Existing BookingLegOperations adds an optional section-wrapped `planning` and loads recorded crew/lodging, preserving old response consumers.

- [ ] Test owner/boss/manager authentication separately, manager cross-leg 403, disabled account 403, malformed body 400, stale revision 409, missing facts 422. Serialize conflict responses and assert no unrelated names, contact details, rosters or lodging appear. Test partial planning failure retains loaded history/resources; missing schema never returns a verified plan. Assert no provider/network calls while reading or deciding.
- [ ] Run `pnpm --filter @workspace/api-server test src/routes/leg-planning.test.ts src/features/leg-planning/planning-view.test.ts src/features/bookings/booking-leg-operations-service.test.ts`; expect absent routes/projection failures.
- [ ] Implement middleware-derived actors, scoped repository queries and action permissions. Owner may configure all plans; boss may prepare/read operational plans and submit decisions only with bound authority; manager may prepare own leg plans and availability for workers with authorized membership. Owner edits shared inventory/authority. All IDs/revisions validated, no-store reads, decision actor fields rejected in body, section failure isolated. Existing connector tool contract/scopes stay unchanged.
- [ ] Rerun route/view/summary tests and `pnpm exec vitest run lib/api-zod/src/booking-leg-operations.test.ts`; expect privacy and backward-compatible response checks to pass.
- [ ] Commit: `feat: expose authorized leg planning and shared readiness views`.

## Task 7: Build the leg-plan editor and approval workflow

**Files:** Create frontend `features/leg-planning/planning-client.ts`, `use-leg-plan.ts`, `use-leg-plan.test.tsx`, `components/leg-planning/leg-season-editor.tsx`, `event-plan-editor.tsx`, `package-set-editor.tsx`, `approval-review.tsx`, `planning-editor.test.tsx`. Modify `components/routes/travel-leg-manager-cards.tsx`, `pages/RoutesPage.tsx`, `pages/SettingsPackagesResourcesPage.tsx`, `components/bookings/leg-operations-panel.tsx`, `pages/ManagerOperationsPage.tsx`, `pages/ManagerCrewPage.tsx`, `pages/BossAssignmentsPage.tsx` and their affected tests. Put owner Dave-binding setup in the existing settings/leg-management view.

**Interfaces:** `useLegPlan(bookingId: string, role: 'owner'|'boss'|'manager')` returns scoped read, draft save, revision-checked commit/request/decision actions and loading/errors. `EventPlanEditor({bookingId, role, onCommitted})`, `LegSeasonEditor({legId, seasonYear, role})`, `PackageSetEditor({role})`, `ApprovalReview({requestId, role, onDecision})` consume shared contracts. Client uses existing authenticated fetch helpers for each role; no new token storage.

- [ ] Test incomplete draft saving, explicit selected year, requirement/availability entry, real resource selection, package composition verification and unknown accommodation. Test that unavailable crew/inventory cannot be committed; pending split and extra-set decisions have separate actions. Test Dave sees the same facts with fewer permitted controls, manager sees only own leg, and a slow event-A response/save never overwrites event B's draft.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/components/leg-planning/planning-editor.test.tsx src/features/leg-planning/use-leg-plan.test.tsx`; expect missing components/hook failures.
- [ ] Implement stacked season/event forms, scoped identity pickers and readable readiness reasons/next actions. Keep existing resource/worker creation editors. Add exact two-booking split preparation with explicit strategic acknowledgement; no automatic split suggestion or invented crew halves. Decision review shows the precise current plan and required authority. Preserve unsaved edits while server data refreshes; display revision conflicts for deliberate reread. Keep commercial confirmation and send actions separate. Gate all new controls on verified server capability.
- [ ] Rerun UI tests including existing leg cards, manager operations/crew and boss assignments; expect facts and permission behavior to match shared reads.
- [ ] Commit: `feat: add leg staffing equipment and approval planning controls`.

## Task 8: Connect schedule/map/routes, verify and prepare delivery

**Files:** Modify frontend `features/bookings/booking-operations-changes.ts`, `features/bookings/use-booking-leg-operations.ts`, `components/bookings/profile-leg-operations.tsx`, `pages/SchedulePage.tsx`, `pages/BossSchedulePage.tsx`, `components/routes/event-map.tsx`, `pages/RoutesPage.tsx` and corresponding tests. Create `pages/LegPlanning.integration.test.tsx`; extend `pages/ConnectedLegOperations.integration.test.tsx`. Modify `.github/workflows/connected-leg-operations-ci.yml`; create `docs/verification/2026-10-01-leg-planning-and-approvals.md` and `docs/operations/leg-planning-onboarding.md`.

**Interfaces:** Extend existing operations change notification with affected booking IDs and season/leg context from MutationResult; invalidate related summary, schedule/map/route, season-plan and neighboring conflict queries. All consumer views use PlanningRead/ReadinessResult rather than recomputing availability in React.

- [ ] Test event-to-plan-to-manager-to-schedule/map navigation preserves booking/leg/year; commit refresh shows canonical assignment everywhere; changing a neighbor's resource updates both readiness results; unmapped/unassigned records remain visible; task completion/customer status alone does not change readiness. Assert historical ambiguous records stay visible and are not rewritten. Test a server planning section failure leaves other sections navigable.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/pages/LegPlanning.integration.test.tsx src/pages/ConnectedLegOperations.integration.test.tsx src/features/bookings/booking-operations-changes.test.ts`; expect missing connected behavior failures.
- [ ] Implement shared refresh/readiness badges and contextual links in existing views. Add all new focused suites to the established CI workflow; PostgreSQL concurrency runs against an ephemeral CI PostgreSQL service, never production. Write onboarding instructions for the actual Dave binding, crew/role requirements, verified package composition, real transport and lodging; distinguish app completion from season data completeness.
- [ ] Run new backend/frontend suites, affected existing suites from the connected operations CI, `pnpm run typecheck:libs`, `pnpm --filter @workspace/adventure-zone run build` and `pnpm --filter @workspace/api-server run build` on Node 22. Run affected app typechecks and compare failures to clean main; report baseline failures rather than suppressing them. Record exact results and PostgreSQL concurrency evidence.
- [ ] Perform actual browser verification at 360px, 768px and desktop for leg cards, editor, decisions and manager/Dave views. Use authorized supported browser access only; if preview access is blocked, record what remains unverified. Component tests do not replace visual checks.
- [ ] Commit: `feat: connect leg planning readiness across operational views`.
- [ ] Conduct the chosen execution method's whole-branch review, fix material findings and rerun affected checks. Publish a draft PR from current remote-main ancestry with spec/plan links, final behavior, test results and material limitations. Stop before merge/deployment. No new customer correspondence is prepared or sent.

## Self-review and execution handoff

Spec coverage: Tasks 1/7 cover season/event setup, staffing and actual inventory; Tasks 2/3 cover windows, holds, canonical deduplication and readiness; Tasks 4/5 cover exact business approval rules, invalidation, atomicity and legacy paths; Tasks 6/7 cover scope/privacy and daily editing; Task 8 covers connected views, mobile verification, onboarding and reviewable delivery. Separate calendar repair and connector writes remain excluded.

Review-focus inputs each have an owning test. All policy boundaries consume Task 1 contracts; backend writes reuse the existing mutex rather than a parallel lock. No artificial resource IDs, crew minimums, authority binding or ready-season claims are introduced. The PostgreSQL test requirement is explicit because PGlite alone cannot prove concurrent locking.

Recommended execution: **Native**. Implement the tasks in this session, then use one fresh whole-branch reviewer. The tasks share a tightly coupled contract and transaction boundary, so retaining implementation context reduces repeated context cost. Subagent-driven execution is available if Desiree prefers a fresh implementer/reviewer gate for each task.

Written-plan review and selection of the execution method are required before product implementation. This document is a plan, not a completion report.
