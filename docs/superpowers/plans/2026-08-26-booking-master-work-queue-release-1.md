# Booking Master Work Queue Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable Opportunity + Today master-queue backbone so one event/year pursuit can drive smart daily work, full-profile navigation, manual priority controls, and Completed Today without replacing existing calls, follow-ups, bookings, or Gmail/Calendar infrastructure.

**Architecture:** Add a small Opportunity persistence layer attached to the existing organization/event profile, then adapt the existing Today query into a unified work-item projection instead of creating a parallel task system. Reuse current follow-ups, calls, bookings, scout alerts, and profile routes as source records; Opportunity stores current-cycle state and queue overrides, while Today assembles those sources into Needs Attention, Active Queue, and Completed Today. Event profile pages become the destination for queue work and preserve a return-to-Today context in session storage.

**Tech Stack:** TypeScript 5.9, React 19, Vite, Wouter, Express 5, PostgreSQL, Drizzle ORM, Zod 4, Tailwind CSS, Vitest 4, Testing Library, Supertest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-26-booking-master-work-queue-design.md`

## Global Constraints

- Today is the Booking master work queue.
- Event Profile remains the permanent cross-year record; Opportunity represents one event/year booking pursuit.
- Existing Gmail, Google Calendar, calls, follow-ups, bookings, ACT history, Scout alerts, and profile records remain authoritative source systems; do not duplicate their full data into Opportunity.
- Opportunity status describes the booking pursuit, not an individual task.
- Smart ordering is the default; the user can pin, mark urgent, snooze, and manually reorder work for the current business day.
- Manual day ordering does not permanently retrain priority unless the user changes Opportunity priority/status explicitly.
- Completed items remain visible under Completed Today for the current business day.
- Completing an action that needs another touch creates the future follow-up and removes the current action from Active Queue.
- Selecting work opens the full Event Profile, not the existing Today side profile sheet.
- Back to Today restores queue filters and approximate scroll/item position.
- Subjective status transitions are suggestions; deterministic transitions may be applied automatically.
- Do not change outgoing-email or Gmail send behavior in Release 1.
- Do not replace the existing assisted-calling subsystem in Release 1.
- Use `BUSINESS_TIME_ZONE` and existing business-date helpers for Today/completion boundaries.

---

## File Map

### Database / Opportunity domain

- `lib/db/src/schema/index.ts` — export Opportunity and queue-override tables/relations using existing schema conventions.
- `lib/db/migrations/<next>_booking_opportunities.sql` — additive tables and indexes. At execution time, list `lib/db/migrations`, choose the next unused numeric prefix, and register that exact filename immediately in `lib/db/src/migrations.ts`.
- `lib/db/src/migrations.ts` — startup migration marker for the new tables.
- `artifacts/api-server/src/features/opportunities/opportunity-types.ts` — status/priority/DTO contracts.
- `artifacts/api-server/src/features/opportunities/opportunity-repository.ts` — get/create/update Opportunity and daily queue overrides.
- `artifacts/api-server/src/features/opportunities/opportunity-repository.test.ts` — persistence and uniqueness tests.
- `artifacts/api-server/src/features/opportunities/opportunity-service.ts` — transition rules and follow-up integration.
- `artifacts/api-server/src/features/opportunities/opportunity-service.test.ts` — deterministic vs suggested transitions and completion flow tests.
- `artifacts/api-server/src/routes/opportunities.ts` — current Opportunity read/update and queue-control endpoints.
- `artifacts/api-server/src/routes/opportunities.test.ts` — API behavior tests.
- `artifacts/api-server/src/app.ts` or `artifacts/api-server/src/routes/index.ts` — register the route following the repository’s current route-registration convention.

### Today projection

- `artifacts/api-server/src/features/today/master-work-queue.ts` — normalize existing follow-ups/bookings/scout alerts/opportunities into one queue contract and rank it.
- `artifacts/api-server/src/features/today/master-work-queue.test.ts` — ordering, override, Needs Attention, and Completed Today tests.
- `artifacts/api-server/src/features/follow-ups/today-query.ts` — keep existing source queries intact; expose data required by the master projection rather than replacing follow-up semantics.
- `artifacts/api-server/src/routes/today.ts` — add master queue payload and queue mutation endpoints while retaining existing fields for compatibility during migration.
- `artifacts/api-server/src/routes/today.test.ts` — master queue HTTP tests and regression coverage for existing Today payload.

### Web / Today

- `artifacts/adventure-zone/src/features/today/master-work-types.ts` — frontend DTOs.
- `artifacts/adventure-zone/src/features/today/today-return-context.ts` — save/restore filter and queue item context in session storage.
- `artifacts/adventure-zone/src/features/today/today-return-context.test.ts` — validation and cleanup tests.
- `artifacts/adventure-zone/src/components/today/needs-attention-section.tsx` — top-priority meaningful inbound/blocker items.
- `artifacts/adventure-zone/src/components/today/active-work-queue.tsx` — smart/manual queue controls.
- `artifacts/adventure-zone/src/components/today/completed-today-section.tsx` — collapsed completed activity.
- `artifacts/adventure-zone/src/components/today/master-work-queue.test.tsx` — integrated queue behavior.
- `artifacts/adventure-zone/src/pages/TodayPage.tsx` — replace Today side-sheet interception with full-profile navigation and render the three queue sections without deleting existing useful Booking/Scout/operations content prematurely.

### Web / Event Profile

- `artifacts/adventure-zone/src/components/opportunities/current-opportunity-card.tsx` — status, next action, dates, last contact, and quick actions.
- `artifacts/adventure-zone/src/components/opportunities/current-opportunity-card.test.tsx` — rendering and status-action tests.
- `artifacts/adventure-zone/src/components/profiles/profile-primary-actions.tsx` — add Opportunity-aware actions without removing current Call/Log call/Edit/Last Resort controls.
- `artifacts/adventure-zone/src/pages/EventProfilePage.tsx` — load current Opportunity, highlight requested task, and expose Back to Today when return context exists.
- `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx` — full-profile queue navigation and Back to Today tests.

---

### Task 1: Add the event-year Opportunity persistence model

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/<next>_booking_opportunities.sql`
- Modify: `lib/db/src/migrations.ts`
- Create: `artifacts/api-server/src/features/opportunities/opportunity-types.ts`
- Create: `artifacts/api-server/src/features/opportunities/opportunity-repository.ts`
- Create: `artifacts/api-server/src/features/opportunities/opportunity-repository.test.ts`

**Interfaces:**

```ts
export const opportunityStatusValues = [
  "new_lead",
  "researching",
  "ready_to_contact",
  "contacted",
  "follow_up",
  "interested",
  "booking_in_progress",
  "booked",
  "not_pursuing",
  "declined",
  "no_response",
  "territory_hold",
  "needs_review",
  "cancelled",
] as const;

export type OpportunityStatus = typeof opportunityStatusValues[number];
export type OpportunityPriority = "normal" | "high" | "urgent";

export type OpportunityRecord = {
  id: string;
  organizationId: string;
  eventYear: number;
  bookingId: string | null;
  contactId: string | null;
  status: OpportunityStatus;
  priority: OpportunityPriority;
  nextActionKind: string | null;
  nextActionDueAt: Date | null;
  holdReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type QueueOverride = {
  opportunityId: string;
  businessDate: string;
  pinned: boolean;
  manualOrder: number | null;
  snoozedUntil: Date | null;
};
```

- [ ] **Step 1: Write failing repository tests for one Opportunity per organization/year**

```ts
it("keeps separate yearly opportunities on one permanent profile", async () => {
  const first = await repo.create({ organizationId: ORG_ID, eventYear: 2026 });
  const second = await repo.create({ organizationId: ORG_ID, eventYear: 2027 });
  expect(first.id).not.toBe(second.id);
});

it("rejects a duplicate organization/year opportunity", async () => {
  await repo.create({ organizationId: ORG_ID, eventYear: 2026 });
  await expect(repo.create({ organizationId: ORG_ID, eventYear: 2026 })).rejects.toThrow();
});
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunities/opportunity-repository.test.ts
```

Expected: FAIL because the Opportunity schema/repository does not exist.

- [ ] **Step 3: Add additive SQL and Drizzle schema**

Create `booking_opportunities` with UUID primary key, organization FK, optional booking/contact FKs, event year, status, priority, next-action fields, hold reason, and timestamps. Add a unique `(organization_id, event_year)` index.

Create `booking_opportunity_queue_overrides` keyed by `(opportunity_id, business_date)` with `pinned`, `manual_order`, and `snoozed_until`.

- [ ] **Step 4: Implement repository methods**

```ts
get(id: string): Promise<OpportunityRecord | null>;
getForOrganizationYear(organizationId: string, eventYear: number): Promise<OpportunityRecord | null>;
create(input: CreateOpportunityInput): Promise<OpportunityRecord>;
update(id: string, patch: UpdateOpportunityInput): Promise<OpportunityRecord>;
getQueueOverride(opportunityId: string, businessDate: string): Promise<QueueOverride | null>;
upsertQueueOverride(input: QueueOverride): Promise<QueueOverride>;
```

- [ ] **Step 5: Register the migration marker and run tests/typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunities/opportunity-repository.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db artifacts/api-server/src/features/opportunities
git commit -m "feat: add booking opportunities"
```

---

### Task 2: Add Opportunity transition rules and future-follow-up completion behavior

**Files:**
- Create: `artifacts/api-server/src/features/opportunities/opportunity-service.ts`
- Create: `artifacts/api-server/src/features/opportunities/opportunity-service.test.ts`
- Modify/reuse: `artifacts/api-server/src/routes/follow-ups.ts`
- Reuse existing follow-up persistence/service APIs rather than creating a second follow-up table.

**Interfaces:**

```ts
export type OpportunityEvent =
  | { kind: "research_started" }
  | { kind: "ready_checks_complete" }
  | { kind: "first_contact_completed" }
  | { kind: "follow_up_created"; dueAt: Date }
  | { kind: "booking_started" }
  | { kind: "booking_confirmed" }
  | { kind: "positive_response" };

export type TransitionResult = {
  appliedStatus: OpportunityStatus | null;
  suggestedStatus: OpportunityStatus | null;
};

export function deriveOpportunityTransition(
  current: OpportunityStatus,
  event: OpportunityEvent,
): TransitionResult;
```

- [ ] **Step 1: Write failing deterministic/suggested transition tests**

```ts
expect(deriveOpportunityTransition("new_lead", { kind: "research_started" })).toEqual({
  appliedStatus: "researching",
  suggestedStatus: null,
});
expect(deriveOpportunityTransition("follow_up", { kind: "positive_response" })).toEqual({
  appliedStatus: null,
  suggestedStatus: "interested",
});
```

- [ ] **Step 2: Write a failing completion test proving current work completes and future follow-up is created atomically**

The service should accept an existing follow-up/task source ID, complete it through the existing follow-up API/repository, then create the future follow-up and set Opportunity status to `follow_up`. If future creation fails, do not leave the current action falsely reported as fully completed by the Opportunity service.

- [ ] **Step 3: Implement transition policy and follow-up orchestration**

Keep subjective `positive_response → interested` as a suggestion. Apply research, first-contact, follow-up-created, booking-started, and booking-confirmed transitions directly when their source action is already authoritative.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunities/opportunity-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/opportunities artifacts/api-server/src/routes/follow-ups.ts
git commit -m "feat: coordinate opportunity follow ups"
```

---

### Task 3: Build the unified server-side Today master-work projection

**Files:**
- Create: `artifacts/api-server/src/features/today/master-work-queue.ts`
- Create: `artifacts/api-server/src/features/today/master-work-queue.test.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`
- Modify: `artifacts/api-server/src/routes/today.ts`
- Create or modify: `artifacts/api-server/src/routes/today.test.ts`

**Interfaces:**

```ts
export type MasterWorkKind =
  | "reply"
  | "callback"
  | "follow_up"
  | "draft"
  | "research"
  | "review"
  | "new_outreach"
  | "booking"
  | "cleanup";

export type MasterWorkItem = {
  id: string;
  sourceId: string;
  sourceType: string;
  opportunityId: string | null;
  organizationId: string | null;
  bookingId: string | null;
  contactId: string | null;
  eventName: string;
  city: string | null;
  region: string | null;
  kind: MasterWorkKind;
  reason: string;
  dueAt: Date | null;
  opportunityStatus: OpportunityStatus | null;
  priority: OpportunityPriority;
  pinned: boolean;
  manualOrder: number | null;
  completedAt: Date | null;
};

export type MasterTodayQueue = {
  needsAttention: MasterWorkItem[];
  active: MasterWorkItem[];
  completedToday: MasterWorkItem[];
};
```

- [ ] **Step 1: Write ranking tests for the approved default priority order**

Prove: reply → due callback → interested/hot lead → due follow-up → draft → review/research → new outreach → cleanup. Then prove pinned items beat smart order, manual order sorts pinned/manual peers, and snoozed items are absent until due.

- [ ] **Step 2: Write Completed Today boundary tests using `BUSINESS_TIME_ZONE`**

An item completed inside today’s business-day bounds appears in `completedToday`; yesterday’s completion does not.

- [ ] **Step 3: Implement pure normalization/ranking functions**

Keep the ranker independent from DB calls. Reuse existing `classifyBusinessDueDate`, follow-up source data, Scout alert source data, booking metadata, and Opportunity overrides.

- [ ] **Step 4: Extend GET `/today` compatibly**

Add:

```ts
masterQueue: {
  needsAttention: MasterWorkItem[];
  active: MasterWorkItem[];
  completedToday: MasterWorkItem[];
}
```

Do not remove the current `followUps`, `nextCall`, `needsFollowUpPlan`, Scout alerts, trips, or other existing Today fields in this release.

- [ ] **Step 5: Add queue-control endpoints**

```text
POST /today/work/:opportunityId/pin
POST /today/work/:opportunityId/urgent
POST /today/work/:opportunityId/snooze
POST /today/work/reorder
POST /today/work/reset-order
```

Validate UUIDs, business date, snooze timestamps, and that reordered Opportunity IDs belong to the authenticated user-visible Booking queue.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/today/master-work-queue.test.ts src/routes/today.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS with legacy Today response tests still green.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/today artifacts/api-server/src/features/follow-ups/today-query.ts artifacts/api-server/src/routes/today.ts artifacts/api-server/src/routes/today.test.ts
git commit -m "feat: add Today master work queue API"
```

---

### Task 4: Replace Today’s side-profile interception with full-profile work navigation

**Files:**
- Create: `artifacts/adventure-zone/src/features/today/today-return-context.ts`
- Create: `artifacts/adventure-zone/src/features/today/today-return-context.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify/create focused Today tests following existing component-test conventions.

**Interfaces:**

```ts
export type TodayReturnContext = {
  filter: string | null;
  workItemId: string | null;
  scrollY: number;
};

export function saveTodayReturnContext(value: TodayReturnContext): void;
export function readTodayReturnContext(): TodayReturnContext | null;
export function clearTodayReturnContext(): void;
```

Storage key: `adventure-zone:today-return-context`.

- [ ] **Step 1: Write failing storage validation tests**

Reject malformed JSON, negative/non-finite scroll positions, and unexpected fields. Return `null` safely rather than throwing.

- [ ] **Step 2: Remove the Today `ProfileDetailSheet` interception path**

`TodayPage.tsx` currently captures profile links and opens `ProfileDetailSheet`. Remove that interception for master-work items. Queue work links should navigate to `/event-profiles/:id` with `from=today&workItemId=...` and preserve any contact/booking/follow-up query context.

- [ ] **Step 3: Save Today state immediately before navigation**

Save current filter, work item ID, and `window.scrollY`. Do not persist business records in session storage.

- [ ] **Step 4: Restore Today context on return**

After Today data renders, restore filter and scroll position once, then leave normal browser navigation semantics intact.

- [ ] **Step 5: Run frontend tests/typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/today/today-return-context.test.ts
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/features/today artifacts/adventure-zone/src/pages/TodayPage.tsx
git commit -m "feat: open Today work in full profiles"
```

---

### Task 5: Render Needs Attention, Active Queue, and Completed Today

**Files:**
- Create: `artifacts/adventure-zone/src/features/today/master-work-types.ts`
- Create: `artifacts/adventure-zone/src/components/today/needs-attention-section.tsx`
- Create: `artifacts/adventure-zone/src/components/today/active-work-queue.tsx`
- Create: `artifacts/adventure-zone/src/components/today/completed-today-section.tsx`
- Create: `artifacts/adventure-zone/src/components/today/master-work-queue.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`

**Interfaces:**

The web DTO mirrors `MasterTodayQueue` from Task 3. `ActiveWorkQueue` accepts callbacks for pin, urgent, snooze, reorder, and reset; it does not mutate server state locally without successful API responses.

- [ ] **Step 1: Write failing component tests**

Prove:
- Needs Attention appears first when non-empty.
- Active Queue preserves server smart order.
- pin/urgent/snooze invoke the correct endpoints.
- manual reorder submits ordered Opportunity IDs.
- Reset to smart order clears manual ordering.
- Completed Today is collapsed by default and shows completion outcome when expanded.
- clicking an item goes to the full profile.

- [ ] **Step 2: Implement compact queue cards**

Each active row shows event, city/state, work type, reason, due date when relevant, Opportunity status, and controls for pin/snooze/priority. Keep touch targets usable on mobile.

- [ ] **Step 3: Integrate into TodayPage without deleting unrelated working content**

Place master sections near the top of the Booking work surface. Existing Scout alerts/operations/renewals can remain below or be consumed into the master projection in later tasks; Release 1 must not regress their current behavior.

- [ ] **Step 4: Run focused tests/build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/today/master-work-queue.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/today artifacts/adventure-zone/src/features/today artifacts/adventure-zone/src/pages/TodayPage.tsx
git commit -m "feat: make Today the booking work queue"
```

---

### Task 6: Add Current Opportunity to the full Event Profile and Back to Today

**Files:**
- Create: `artifacts/api-server/src/routes/opportunities.ts`
- Create: `artifacts/api-server/src/routes/opportunities.test.ts`
- Create: `artifacts/adventure-zone/src/components/opportunities/current-opportunity-card.tsx`
- Create: `artifacts/adventure-zone/src/components/opportunities/current-opportunity-card.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-primary-actions.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx`

**Interfaces:**

```text
GET /opportunities/current?organizationId=<uuid>&year=<yyyy>
PATCH /opportunities/:id
POST /opportunities/:id/apply-suggested-status
```

- [ ] **Step 1: Write failing API tests for current opportunity read/update**

Validate organization/year, status enum, priority enum, and that subjective suggested status is not applied unless the explicit apply endpoint is called.

- [ ] **Step 2: Write failing profile UI tests**

The profile should show Current Opportunity with status, next action, event year/date context available from the Opportunity/booking, and quick actions. When `from=today` is present and a valid return context exists, show **Back to Today**.

- [ ] **Step 3: Implement `CurrentOpportunityCard`**

Initial quick actions in Release 1:
- change status/priority;
- schedule follow-up using existing follow-up flow;
- existing Call action;
- Add Note through existing profile tooling;
- Booked status only through confirmed booking source or an explicit admin action that preserves booking workflow rules.

Do not add Create Draft implementation in this release; that is Release 2.

- [ ] **Step 4: Update ProfilePrimaryActions without removing existing controls**

Preserve Call, Log call, Edit profile, Last Resort, and Add Event / Lead. Add Opportunity-aware context only where it improves navigation.

- [ ] **Step 5: Implement Back to Today restoration**

Use `readTodayReturnContext()`, navigate to `/today`, and let Today restore its own filter/scroll state. Fall back to ordinary Back behavior when no Today context exists.

- [ ] **Step 6: Run focused API/web tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/opportunities.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/opportunities/current-opportunity-card.test.tsx src/pages/EventProfilePage.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/opportunities* artifacts/adventure-zone/src/components/opportunities artifacts/adventure-zone/src/components/profiles/profile-primary-actions.tsx artifacts/adventure-zone/src/pages/EventProfilePage*
git commit -m "feat: add opportunity workspace to profiles"
```

---

### Task 7: Release 1 regression and acceptance verification

**Files:**
- Modify only test files necessary to add regression coverage discovered during integration.

- [ ] **Step 1: Run Opportunity/Today/call/follow-up focused suites**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunities src/features/today src/features/follow-ups src/routes/today.test.ts src/routes/opportunities.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend Today/Profile/call regression suites**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/today src/pages/EventProfilePage.test.tsx src/components/calls
```

Expected: PASS.

- [ ] **Step 3: Run both typechecks and production build**

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 4: Manually verify the approved Release 1 flow**

1. Open Today.
2. Confirm Needs Attention, Active Queue, and collapsed Completed Today render.
3. Pin and snooze two different items; reload and verify server-persisted behavior.
4. Manually reorder work, reload, then Reset to smart order.
5. Open a work item; verify the full Event Profile opens instead of a side sheet.
6. Verify Current Opportunity is visible and the highlighted task context is preserved.
7. Use Back to Today; verify filter and approximate queue position return.
8. Complete a follow-up with a future next touch; verify current work moves to Completed Today and the new future follow-up does not remain as active work today.
9. Confirm existing calls, Scout alerts, renewals, Booking work, and Schedule links still function.

- [ ] **Step 5: Commit any verification-only test fixes**

```bash
git add artifacts/api-server artifacts/adventure-zone
if ! git diff --cached --quiet; then git commit -m "test: verify booking master work queue release 1"; fi
```

## Release 1 Completion Criteria

Release 1 is complete when:

- an organization can have distinct 2026 and 2027 Opportunities without duplicate profiles;
- Today exposes Needs Attention, Active Queue, and Completed Today;
- smart ordering follows the approved priority model;
- pin, urgent, snooze, day-only manual order, and reset work after reload;
- Completed Today uses business-day boundaries;
- completing work can create a future follow-up automatically;
- queue work opens the full Event Profile;
- Back to Today restores work context;
- Current Opportunity is visible and editable on the profile;
- subjective Interest changes remain suggested until approved;
- current calls/follow-ups/Scout alerts/bookings remain functional;
- no Gmail sending/scheduling behavior has been changed yet.

## Subsequent Plans

After Release 1 is merged and verified, create separate implementation plans from the approved spec for:

1. **Release 2 — Draft & Send Center:** Create Draft, history-aware context assembly, in-app editor, AI quick actions, Ready to Send, scheduling presets, send-window rules, follow-up-after-send prompt, and email guardrails.
2. **Release 3 — Calls + Unified Timeline:** disposition suggestions/manual timing, Opportunity integration for current guided calling, unified chronological profile timeline, Internal Team vs Admin Only notes.
3. **Release 4 — Incoming Activity + Notifications:** Gmail reply/bounce promotion into Needs Attention, callback/voicemail events, selective notifications, CRM hygiene prompts, Needs Review blocker lifecycle.
