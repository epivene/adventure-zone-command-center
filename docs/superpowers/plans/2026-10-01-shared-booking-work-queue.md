# Shared Booking Work Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Give Desiree and Com visible, resumable event work with atomic duplicate protection.

**Architecture:** Add a shared activity store independent of paid assistant execution. Expose it through the existing connector and authenticated app routes, and display it in existing task/profile surfaces. Reuse operation receipts and preserve merge history.

**Tech Stack:** TypeScript, PostgreSQL, existing SQL transaction adapter, Express, Zod, React, Vitest, PGlite and Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-shared-booking-work-queue-design.md`

## Global Constraints

- Allow one nonterminal activity per profile and booking year.
- All updates require the exact revision.
- Expired/stale progress never automatically releases ownership.
- Reads require crm:read. Create requires crm:append; editing existing activities requires crm:update.
- Do not broaden scopes automatically.
- No email sending, paid AI execution, Com scheduling or booking-status changes.
- Existing task systems and follow-ups retain their behavior.
- Existing workflows that do not participate can still operate.
- Do not deploy or mutate live CRM data during implementation.

## Review Focus

- Simultaneous claims must return one canonical activity, not duplicate rows (Task 1).
- A reply arriving during owner edits must not allow stale Com data to overwrite those edits (Task 2).
- A released activity must remain reserved for its profile/year until reclaimed or closed (Task 2).
- Malicious review URLs and cross-profile links must not execute or expose unrelated data (Tasks 2 and 5).
- Merging two profiles with active work in the same year must preserve both by blocking until resolved (Task 4).

## File map and shared interfaces

API paths below are relative to `artifacts/api-server/src`; UI paths are relative
to `artifacts/adventure-zone/src`. A denotes the API base, U denotes the UI base.

- A `db/booking-work-schema.ts`: additive schema and indexes.
- A `features/booking-work/contracts.ts`: validation, DTOs and transition inputs.
- A `features/booking-work/repository.ts`: SQL reads and atomic row mutations.
- A `features/booking-work/service.ts`: ownership, scopes, associations and receipts.
- A `features/chatgpt-connection/booking-work-tools.ts`: connector definitions.
- A `routes/booking-work.ts`: authenticated owner route adapter.
- U `features/booking-work/client.ts`: API DTOs and requests.
- U `features/booking-work/WorkQueue.tsx`: filters, pagination and list states.
- U `features/booking-work/WorkActivityCard.tsx`: activity details and controls.
- U `features/booking-work/ProfileWorkActivity.tsx`: profile-scoped composition.

`WorkStatus` is queued | researching | draft_ready | waiting_desiree |
waiting_customer | blocked | completed | cancelled.
`WorkQueueKind` is new_leads | replies | followups | paperwork | routes.
`WorkActor` is `{kind:'owner'|'connection'; id:string}`; assigned actor can be null.
`WorkLink` is `{kind:'draft'|'document'|'followup'|'email'; recordId?:string;
url?:string; label:string}`. Internal kinds require recordId; email requires HTTPS URL.
`WorkActivity` contains id, profileId, eventYear, bookingId (nullable), queue, title,
assignedTo, status, nextAction, dueAt (nullable), progress (nullable object with
completed, total, summary), links, revision (positive integer), createdAt, updatedAt.
`CreateWork` supplies profileId, eventYear, optional bookingId, queue, title and
nextAction. `PatchWork` supplies optional status, nextAction, dueAt, progress, links.
`WorkFilter` supplies optional profileId, eventYear, status, queue, actor, cursor,
limit (default 20, max 50). `WorkPage` contains items and nextCursor.
Event year is an integer 2000–2200. Titles max 300, next actions max 2000,
progress summary max 2000 and links max 20; reject unknown input fields.

### Task 1: Activity storage and atomic creation

**Files:** Create A `db/booking-work-schema.ts`, A `features/booking-work/contracts.ts`,
A `features/booking-work/repository.ts`, A `features/booking-work/repository.pglite.test.ts`.
Modify A `db/chatgpt-connection-schema.ts` to invoke the additive schema under the
existing startup schema lock.

**Interfaces:** `BookingWorkRepository(tx:SqlQuery)` produces
`createOrGet(input:CreateWork, actor:WorkActor):Promise<{activity:WorkActivity;created:boolean}>`,
`read(id:string):Promise<WorkActivity|null>`, `list(filter:WorkFilter):Promise<WorkPage>`,
and `patch(id:string,revision:number,patch:PatchWork,actor:WorkActor|null):Promise<WorkActivity>`.
The patch actor argument is the desired assignment, supplied by the service.

- [ ] Write failing database tests with these assertions:
  `expect(new Set(results.map(x=>x.activity.id)).size).toBe(1)` for concurrent same-year claims;
  `expect(otherYear.activity.id).not.toBe(first.activity.id)`;
  `expect(afterClose.created).toBe(true)`; stale patch rejects without changes.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/booking-work/repository.pglite.test.ts`; expect failure before implementation.
- [ ] Implement table `booking_work_activities` with profile FK, required event year,
  nullable booking FK, JSON links/progress, revision and timestamps. Add partial unique
  index `(profile_id,event_year) WHERE status NOT IN ('completed','cancelled')`.
  Use conflict-safe insertion followed by canonical reread; update with revision CAS.
  Paginate using immutable `(created_at,id)` order; cursor includes filter fingerprint.
- [ ] Add pagination assertions: no duplicate IDs across pages, invalid/filter-mismatched
  cursor rejected, cancelled history retained, malformed progress rejected by schema.
- [ ] Run the focused test command; expect all tests pass, then commit this task.

### Task 2: Ownership, recovery and authenticated app service

**Files:** Create A `features/booking-work/service.ts`,
`features/booking-work/service.pglite.test.ts`, `routes/booking-work.ts`,
`routes/booking-work.test.ts`; modify A `routes/index.ts` using the existing owner guard.

**Interfaces:** `BookingWorkService(db:ConnectionDatabase)` exposes connector methods
`claim(principal,input:CreateWork & MutationKey)`,
`update(principal,input:{id:string;revision:number;patch:PatchWork}&MutationKey)`,
`release(principal,input:{id:string;revision:number}&MutationKey)` returning operation receipts.
Claim returns existing conflicting work without takeover. Reclaim unassigned work
requires crm:update and exact revision via an explicit `claimExisting` method.
Owner adapters use authenticated server identity, never a client-supplied owner ID.
Owner `reassign(id,revision,actor|null)` permits explicit handoff to a validated actor.

- [ ] Write failing tests: wrong actor update rejects; revoked connection rejects;
  missing scopes reject; identical retry returns the same operationId; changed-key
  payload rejects; stale owner/Com edits reject; failed operation leaves no receipt.
- [ ] Run API tests for `src/features/booking-work` and `src/routes/booking-work.test.ts`; expect new tests fail.
- [ ] Implement service with OperationStore, activeConnection, scope checks, profile
  and booking association checks. Internal links must belong to the same profile;
  reject executable URLs. Completed/cancelled activities cannot be reopened by patch.
  Release sets assignedTo null and keeps status, links and progress intact.
- [ ] Expose owner GET `/booking-work`, GET `/booking-work/:id`, POST `/booking-work`,
  PATCH `/booking-work/:id`, POST `/booking-work/:id/reassign`; return 409 on CAS
  conflict with current activity, 403 on unauthorized action and 404 when inaccessible.
- [ ] Add tests asserting release retains active uniqueness, explicit reclaim works,
  foreign profile/year booking rejects, javascript URLs reject and owner handoff
  invalidates an old revision. Assert zero send/model/worker invocations.
- [ ] Run the focused tests; expect all pass, then commit this task.

### Task 3: Com connector tools

**Files:** Create A `features/chatgpt-connection/booking-work-tools.ts` and
`booking-work-tools.test.ts`; modify `tool-registry.ts`, `mcp-server.test.ts` and
the existing service wiring that instantiates the registry.

**Interfaces:** Tools are `list_booking_work`, `read_booking_work`,
`claim_booking_work`, `update_booking_work`, `release_booking_work`,
`claim_existing_booking_work`. Inputs use Task 1 DTOs plus requestKey/revision from Task 2.
Reads use activeConnection and crm:read; mutations use Task 2 service.

- [ ] Write failing discovery and invocation tests with exact tool names, scope
  enforcement, strict schema rejection and paginated response assertions.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/chatgpt-connection`; expect new assertions fail.
- [ ] Register tools with descriptions requiring claim-before-work, receipt verification,
  explicit reassignment and preservation of user edits. Return existing activity links
  for conflicts; never imply a claim ran or scheduled Com.
- [ ] Run connector and booking-work tests; expect pass, then commit this task.

### Task 4: Preserve queue records during profile merges

**Files:** Modify A `features/chatgpt-connection/profile-merge-references.ts`,
`profile-merge-service.ts`, `profile-merge-service.pglite.test.ts` and the merge
executor reached by that service. Include activity revisions in preview fingerprint.

**Interfaces:** Merge preview gains a blocker when source and target have active
activities for the same year. Existing receipt and approved-preview interfaces remain.

- [ ] Write failing tests: active same-year collision blocks preview/apply;
  completed history and distinct-year activity links move; changed queue revision
  invalidates approved preview.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/chatgpt-connection/profile-merge-service.pglite.test.ts`; expect failure.
- [ ] Add references and collision checks to preview and transactional execution;
  include link preservation and rollback on any constraint failure.
- [ ] Run focused merge and booking-work tests; expect pass, then commit this task.

### Task 5: Shared task and profile interface

**Files:** Create U `features/booking-work/client.ts`, `WorkQueue.tsx`,
`WorkActivityCard.tsx`, `ProfileWorkActivity.tsx`, `WorkQueue.test.tsx`.
Modify U `pages/OfficeCoordinatorAdminPage.tsx` to include shared work in the existing
owner task area. Locate the canonical owner profile component through App.tsx and
mount ProfileWorkActivity there; document its exact path in the implementation commit.
Do not broaden coordinator or boss permissions through these owner API routes.

**Interfaces:** `WorkQueue({profileId?:string})`,
`WorkActivityCard({activity:WorkActivity,onChanged:()=>void})`,
`ProfileWorkActivity({profileId:string})`; client exports list/read/create/update/reassign
requests using Task 2 endpoints and DTOs.

- [ ] Write failing UI tests asserting status, owner, timestamp, progress, review links,
  filtering, pagination, empty/error states, and a 409 preserving unsaved user edits.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/features/booking-work`; expect failure.
- [ ] Implement responsive cards and owner controls for creation, edits, handoff and
  completion/cancellation. Require year on creation. Do not render a live-running
  animation from status alone. Filtered results must discard stale network responses.
- [ ] Add assertions that executable URLs never become links and a stale response
  cannot replace a newer selected profile/filter. Verify keyboard labels and phone layout.
- [ ] Run UI tests; expect pass, then commit this task.

### Task 6: Integration verification and delivery

**Files:** Add `docs/verification/2026-10-01-shared-booking-work-queue.md` and
`docs/shared-booking-work-queue.md` explaining fields, tools and operational limits.

- [ ] Reconcile with current main before implementation starts; preserve approved
  spec/plan in an isolated checkout and check applicable AGENTS.md instructions.
- [ ] Run all new service, connector, merge and UI tests together; require all pass.
- [ ] Run `pnpm --filter @workspace/api-server build` and
  `pnpm --filter @workspace/adventure-zone build`; require successful exits.
- [ ] Run both package typechecks; compare failures against unchanged main and report
  any pre-existing failures without claiming a clean result.
- [ ] Review mobile widths, links and conflict flow in an authorized local preview
  if available; report any unperformed visual verification.
- [ ] Document that Com must use the new claim tools, existing independent workflows
  are not locked, no live heartbeat is implied, and refresh is needed after deployment.
- [ ] Review the full diff, commit verification notes and open a draft PR with scope,
  tests, limitations and rollout instructions. Do not merge/deploy automatically.

## Plan self-review

Storage, atomic claims, ownership, permissions, receipts, links, user edits, UI,
merge behavior and no-side-effect boundaries each have assigned tests above.
The main-sync step is a prerequisite to Task 1 execution despite being recorded
in delivery checks. No live records need to be created for verification.
