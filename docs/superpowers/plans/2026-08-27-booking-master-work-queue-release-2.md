# Booking Master Work Queue Release 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the merged Release 1 Booking master-work foundation into a safe, Opportunity-linked email execution workflow with explicit Create Draft, editable Gmail-backed drafts, Ready to Send/Outbox, scheduling, send failure recovery, and post-outreach follow-ups.

**Architecture:** Keep Gmail/Google Workspace authoritative for draft/send state, Google Calendar authoritative for availability, and Opportunity/Today authoritative for workflow state. Add a focused opportunity-email orchestration layer that resolves context and guardrails before draft generation, persists only linkage/workflow metadata needed by the app, and feeds Today/Activity Timeline without creating a parallel mail system. Reuse Release 1 Opportunity, follow-up, Today return-context, Completed Today, and Event Profile flows.

**Tech Stack:** TypeScript 5.9, React 19, Vite, Wouter, Express 5, PostgreSQL, Drizzle ORM, Zod 4, Google Workspace/Gmail integration, Google Calendar integration, Tailwind CSS, Vitest 4, Testing Library, Supertest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-27-booking-master-work-queue-release-2-design.md`

## Global Constraints

- Drafts are generated only after the user explicitly chooses **Create Draft**.
- Outgoing communication remains human-reviewable and editable before delivery.
- Gmail is the source of truth for draft/send state; the app coordinates workflow state around it.
- Google Calendar/current package availability remains the availability authority.
- Current verified event/contact information beats stale historical contact details for sending purposes.
- Historical ACT/Gmail/call/profile context still controls relationship tone.
- The app must never silently invent prior contact, event dates, package availability, recipient identity, or relationship history.
- Material ambiguity becomes **Needs Review** rather than a guessed draft.
- A saved draft alone does not create a follow-up because no outreach has occurred yet.
- A scheduled or sent email may create a future follow-up after the user chooses a follow-up option.
- Delivery failure never advances Opportunity state as though outreach succeeded.
- Routine new outreach must not actively pursue New Mexico, Oregon, California, Kansas, Oklahoma, or Texas without a human-approved exception.
- Preserve approved Adventure Zone package, pricing, insurance, pay-for-play, adult-event, and sponsorship wording rules from the spec exactly.
- Do not replace assisted calling in Release 2.
- Keep Release 1 Today queue, Opportunity, follow-up, full-profile navigation, and Back to Today behavior intact.
- Repository-wide typecheck has known pre-existing debt; Release 2 CI must run focused tests/builds and must not introduce new errors in touched files.

---

## File Map

### API / Opportunity email domain

- `artifacts/api-server/src/features/opportunity-email/opportunity-email-types.ts` — draft purpose/state/blocker/outcome contracts.
- `artifacts/api-server/src/features/opportunity-email/opportunity-email-repository.ts` — app-side linkage/idempotency/failure metadata for Gmail drafts.
- `artifacts/api-server/src/features/opportunity-email/opportunity-email-repository.test.ts` — persistence and uniqueness tests.
- `artifacts/api-server/src/features/opportunity-email/draft-context-resolver.ts` — resolve profile/opportunity/contact/history/calendar context.
- `artifacts/api-server/src/features/opportunity-email/draft-context-resolver.test.ts` — context-selection tests.
- `artifacts/api-server/src/features/opportunity-email/draft-guardrails.ts` — territory, duplicate, decline, protected-record, and wording guardrails.
- `artifacts/api-server/src/features/opportunity-email/draft-guardrails.test.ts` — blocker/contract tests.
- `artifacts/api-server/src/features/opportunity-email/opportunity-draft-service.ts` — create/reopen/update/rewrite/send/schedule/retry orchestration.
- `artifacts/api-server/src/features/opportunity-email/opportunity-draft-service.test.ts` — service behavior and idempotency tests.
- `artifacts/api-server/src/features/opportunity-email/ready-to-send-service.ts` — outbox projection and bulk send/schedule coordination.
- `artifacts/api-server/src/features/opportunity-email/ready-to-send-service.test.ts` — counts, bulk outcomes, partial-failure tests.
- `artifacts/api-server/src/routes/opportunity-drafts.ts` — Opportunity draft endpoints.
- `artifacts/api-server/src/routes/opportunity-drafts.test.ts` — authenticated route tests.
- `artifacts/api-server/src/routes/today-ready-to-send.ts` — Today outbox endpoints.
- `artifacts/api-server/src/routes/today-ready-to-send.test.ts` — authenticated bulk route tests.
- `artifacts/api-server/src/routes/index.ts` — register new routers.

### Database

- `lib/db/src/booking-opportunity-email-schema.ts` — additive app-side email workflow metadata table.
- `lib/db/src/index.ts` / `lib/db/src/schema/index.ts` — export schema following repository convention.
- `lib/db/migrations/<next>_booking_opportunity_email_state.sql` — additive migration.
- `lib/db/src/migrations.ts` — register migration marker.

### Web / Composer

- `artifacts/adventure-zone/src/features/opportunity-email/opportunity-email-types.ts` — frontend DTOs.
- `artifacts/adventure-zone/src/components/opportunities/opportunity-draft-composer.tsx` — editable composer with Save/Schedule/Send and quick AI actions.
- `artifacts/adventure-zone/src/components/opportunities/opportunity-draft-composer.test.tsx` — composer actions and Undo tests.
- `artifacts/adventure-zone/src/components/opportunities/follow-up-after-send.tsx` — 3 days/7 days/pick/no follow-up prompt.
- `artifacts/adventure-zone/src/components/opportunities/follow-up-after-send.test.tsx` — prompt timing tests.
- `artifacts/adventure-zone/src/components/opportunities/current-opportunity-card.tsx` — activate Create Draft and route into composer.
- `artifacts/adventure-zone/src/pages/EventProfilePage.tsx` — load/show composer context and preserve Back to Today.
- `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx` — Create Draft + navigation regression.

### Web / Today Outbox

- `artifacts/adventure-zone/src/components/today/ready-to-send-section.tsx` — replace Release 1 placeholder with functional outbox.
- `artifacts/adventure-zone/src/components/today/ready-to-send-section.test.tsx` — counts/selection/expand/schedule tests.
- `artifacts/adventure-zone/src/features/today/master-work-types.ts` — add compatible ready-to-send DTO if needed.
- `artifacts/adventure-zone/src/pages/TodayPage.tsx` — wire functional Ready to Send between Needs Attention and Active Queue.
- `artifacts/adventure-zone/src/components/today/master-work-queue.test.tsx` — Ready to Send integration regression.

### CI

- `.github/workflows/booking-master-work-queue-release-2-ci.yml` — focused API/web tests, builds, and touched-file typecheck discipline.

---

### Task 1: Add Opportunity-linked email workflow persistence

**Files:**
- Create: `lib/db/src/booking-opportunity-email-schema.ts`
- Create: `lib/db/migrations/<next>_booking_opportunity_email_state.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts` if present in current schema-export convention
- Modify: `lib/db/src/migrations.ts`
- Create: `artifacts/api-server/src/features/opportunity-email/opportunity-email-types.ts`
- Create: `artifacts/api-server/src/features/opportunity-email/opportunity-email-repository.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/opportunity-email-repository.test.ts`

**Interfaces:**

```ts
export type OpportunityDraftPurpose = "new_outreach" | "follow_up" | "reply";
export type OpportunityEmailState = "draft" | "scheduled" | "sent" | "failed" | "cancelled";

export type OpportunityEmailRecord = {
  id: string;
  opportunityId: string;
  organizationId: string;
  contactId: string | null;
  eventYear: number;
  purpose: OpportunityDraftPurpose;
  state: OpportunityEmailState;
  gmailDraftId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  body: string;
  scheduledFor: Date | null;
  sentAt: Date | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  sendRequestKey: string | null;
  scheduleRequestKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Repository contract:

```ts
getCurrentForOpportunity(opportunityId: string): Promise<OpportunityEmailRecord | null>;
getById(id: string): Promise<OpportunityEmailRecord | null>;
create(input: CreateOpportunityEmailInput): Promise<OpportunityEmailRecord>;
update(id: string, patch: UpdateOpportunityEmailInput): Promise<OpportunityEmailRecord>;
findBySendRequestKey(requestKey: string): Promise<OpportunityEmailRecord | null>;
findByScheduleRequestKey(requestKey: string): Promise<OpportunityEmailRecord | null>;
listReadyToSend(): Promise<OpportunityEmailRecord[]>;
```

- [ ] **Step 1: Write failing persistence tests**

```ts
it("keeps one current draft per opportunity before send", async () => {
  const first = await repo.create(makeDraft({ opportunityId: OPPORTUNITY_ID }));
  await expect(repo.create(makeDraft({ opportunityId: OPPORTUNITY_ID }))).rejects.toThrow();
  expect((await repo.getCurrentForOpportunity(OPPORTUNITY_ID))?.id).toBe(first.id);
});

it("stores Gmail linkage, scheduling, and failure metadata", async () => {
  const created = await repo.create(makeDraft({ opportunityId: OPPORTUNITY_ID }));
  const updated = await repo.update(created.id, {
    gmailDraftId: "gmail-draft-1",
    gmailThreadId: "thread-1",
    state: "failed",
    lastFailureCode: "gmail_503",
    lastFailureMessage: "Service unavailable",
  });
  expect(updated.gmailDraftId).toBe("gmail-draft-1");
  expect(updated.lastFailureCode).toBe("gmail_503");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunity-email/opportunity-email-repository.test.ts
```

Expected: FAIL because the schema/repository does not exist.

- [ ] **Step 3: Add additive SQL/Drizzle schema**

Create `booking_opportunity_email_state` with a UUID primary key, Opportunity FK, organization/contact identifiers, year, purpose/state, Gmail IDs, recipient/subject/body, scheduling/send/failure/idempotency fields, timestamps, and a partial/unique constraint that prevents more than one non-terminal current draft for one Opportunity.

- [ ] **Step 4: Implement repository methods and row mapping**

Keep Gmail content/state fields app-visible without duplicating Gmail history beyond the current app-managed draft record.

- [ ] **Step 5: Run focused tests and DB build**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunity-email/opportunity-email-repository.test.ts
pnpm --filter @workspace/db build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db artifacts/api-server/src/features/opportunity-email
 git commit -m "feat: add opportunity email state"
```

---

### Task 2: Resolve authoritative draft context and classify blockers

**Files:**
- Create: `artifacts/api-server/src/features/opportunity-email/draft-context-resolver.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/draft-context-resolver.test.ts`
- Create: `artifacts/api-server/src/features/opportunity-email/draft-guardrails.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/draft-guardrails.test.ts`
- Reuse: existing Event Profile, ACT history, Gmail/Google Workspace, calls/follow-ups, booking/calendar/package repositories/services.

**Interfaces:**

```ts
export type DraftContext = {
  opportunityId: string;
  organizationId: string;
  eventYear: number;
  eventName: string;
  city: string | null;
  region: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  contactId: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
  priorRelationshipSummary: string[];
  sameYearSentCount: number;
  sameYearDeclined: boolean;
  existingDraftId: string | null;
  calendarEvidence: unknown[];
  packageAvailability: unknown;
  protectedRecord: boolean;
};

export type DraftBlockerCode =
  | "missing_recipient"
  | "ambiguous_recipient"
  | "duplicate_outreach"
  | "current_year_decline"
  | "territory_hold"
  | "protected_record"
  | "availability_unknown"
  | "relationship_ambiguity"
  | "needs_review";

export type DraftBlocker = {
  code: DraftBlockerCode;
  message: string;
  requiresHumanReview: true;
};

export function evaluateDraftGuardrails(
  context: DraftContext,
  purpose: OpportunityDraftPurpose,
): { blocker: DraftBlocker | null; effectivePurpose: OpportunityDraftPurpose };
```

- [ ] **Step 1: Write failing context tests**

Prove newest verified recipient wins over stale ACT contact, same-year sent history is counted, current-year decline is exposed, and Gmail/ACT/profile/call context is passed through without inventing missing facts.

- [ ] **Step 2: Write failing blocker tests**

```ts
expect(evaluateDraftGuardrails(makeContext({ recipientEmail: null }), "new_outreach").blocker?.code)
  .toBe("missing_recipient");
expect(evaluateDraftGuardrails(makeContext({ region: "TX" }), "new_outreach").blocker?.code)
  .toBe("territory_hold");
expect(evaluateDraftGuardrails(makeContext({ sameYearSentCount: 1 }), "new_outreach").effectivePurpose)
  .toBe("follow_up");
expect(evaluateDraftGuardrails(makeContext({ protectedRecord: true }), "follow_up").blocker?.code)
  .toBe("protected_record");
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/opportunity-email/draft-context-resolver.test.ts \
  src/features/opportunity-email/draft-guardrails.test.ts
```

- [ ] **Step 4: Implement resolver + pure guardrails**

Territory hold states are NM, OR, CA, KS, OK, TX. A same-year sent introduction changes effective purpose to follow-up/reply when evidence supports it; it does not silently send a duplicate introduction. Current-year decline/not-pursuing and protected-record conditions block routine drafting.

- [ ] **Step 5: Add wording contract tests**

Assert generation input contains the exact current pricing/insurance/pay-for-play constraints and forbids guarantee/sponsorship-purchase language. Keep these as structured generation rules, not string replacement after generation.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/opportunity-email/draft-context-resolver.test.ts \
  src/features/opportunity-email/draft-guardrails.test.ts
git add artifacts/api-server/src/features/opportunity-email
git commit -m "feat: validate opportunity draft context"
```

---

### Task 3: Implement explicit Create Draft and reopen/update orchestration

**Files:**
- Create: `artifacts/api-server/src/features/opportunity-email/opportunity-draft-service.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/opportunity-draft-service.test.ts`
- Reuse: existing Google Workspace Gmail draft/create/update service and approved communication-template/generation infrastructure.

**Interfaces:**

```ts
export type CreateOpportunityDraftResult =
  | { ok: true; draft: OpportunityEmailRecord; reopened: boolean }
  | { ok: false; blocker: DraftBlocker };

createDraft(input: {
  opportunityId: string;
  requestedPurpose: OpportunityDraftPurpose;
}): Promise<CreateOpportunityDraftResult>;

saveDraft(input: {
  opportunityId: string;
  draftId: string;
  subject: string;
  body: string;
}): Promise<OpportunityEmailRecord>;
```

- [ ] **Step 1: Write failing explicit-action tests**

Test that no service path auto-generates a draft from merely reaching `ready_to_contact`, and `createDraft` is the only generation entry point.

- [ ] **Step 2: Write failing reopen/update tests**

An existing current draft for the Opportunity is returned/reopened and updated rather than creating a second Gmail draft.

- [ ] **Step 3: Write failing blocker-to-Needs-Review test**

When guardrails return a blocker, the service does not call Gmail draft creation and requests/records a Release 1 Opportunity `needs_review` state plus a Today Needs Attention source.

- [ ] **Step 4: Run service tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunity-email/opportunity-draft-service.test.ts
```

- [ ] **Step 5: Implement generation orchestration**

Flow: load Opportunity/context -> evaluate guardrails -> reopen existing draft or call the existing generator with structured Adventure Zone rules -> create/update Gmail draft -> persist app-side linkage -> return composer DTO.

- [ ] **Step 6: Verify Save Draft does not create a follow-up**

Add a test asserting Release 1 follow-up service is untouched on save.

- [ ] **Step 7: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunity-email/opportunity-draft-service.test.ts
git add artifacts/api-server/src/features/opportunity-email
git commit -m "feat: create opportunity email drafts"
```

---

### Task 4: Add in-place AI rewrite actions with one-step Undo

**Files:**
- Modify: `artifacts/api-server/src/features/opportunity-email/opportunity-draft-service.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/opportunity-draft-service.test.ts`
- Create or reuse generator helper under the same feature if the existing rewrite service cannot preserve selected draft content safely.

**Interfaces:**

```ts
export type DraftRewriteAction =
  | "shorter"
  | "more_casual"
  | "more_direct"
  | "rewrite_opening"
  | "more_personal"
  | "stronger_follow_up"
  | "fix_wording";

rewriteDraft(input: {
  opportunityId: string;
  draftId: string;
  action: DraftRewriteAction;
  subject: string;
  body: string;
}): Promise<{ draft: OpportunityEmailRecord; undoBody: string; undoSubject: string }>;
```

- [ ] **Step 1: Write failing tests for all seven rewrite actions**

Assert each action calls the rewrite adapter with the current user-edited content, not the originally generated body.

- [ ] **Step 2: Write a failing Rewrite Opening boundary test**

Assert unrelated body paragraphs stay byte-for-byte unchanged except the opening paragraph and minimal continuity edits explicitly returned by the rewrite adapter.

- [ ] **Step 3: Implement rewrite persistence**

Persist rewritten subject/body to the same Gmail draft and return the prior content as a one-step undo snapshot.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunity-email/opportunity-draft-service.test.ts
git add artifacts/api-server/src/features/opportunity-email
git commit -m "feat: add opportunity draft rewrites"
```

---

### Task 5: Add authenticated Opportunity draft API routes

**Files:**
- Create: `artifacts/api-server/src/routes/opportunity-drafts.ts`
- Test: `artifacts/api-server/src/routes/opportunity-drafts.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces / routes:**

```text
POST  /opportunities/:id/drafts
GET   /opportunities/:id/draft
PATCH /opportunities/:id/draft
POST  /opportunities/:id/draft/rewrite
POST  /opportunities/:id/draft/send
POST  /opportunities/:id/draft/schedule
POST  /opportunities/:id/draft/retry
```

- [ ] **Step 1: Write failing auth + validation tests**

Require owner/admin auth, UUID validation, strict purpose/action enums, non-empty recipient/subject/body where applicable, valid future schedule timestamps, and draft ownership by requested Opportunity.

- [ ] **Step 2: Run route tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/opportunity-drafts.test.ts
```

- [ ] **Step 3: Implement Create/Get/Patch/Rewrite routes**

Map blockers to a 409-style workflow response with `{ blocker }`, not generic 500. Unknown Opportunity/draft returns 404.

- [ ] **Step 4: Stub Send/Schedule/Retry only through service interfaces already defined for Task 6**

Do not duplicate Gmail send logic in the route.

- [ ] **Step 5: Run route tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/opportunity-drafts.test.ts
git add artifacts/api-server/src/routes/opportunity-drafts.ts artifacts/api-server/src/routes/opportunity-drafts.test.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: expose opportunity draft API"
```

---

### Task 6: Implement idempotent send, schedule, retry, and post-outreach follow-up reference times

**Files:**
- Modify: `artifacts/api-server/src/features/opportunity-email/opportunity-draft-service.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/opportunity-draft-service.test.ts`
- Reuse: existing Gmail send/update APIs, Activity repository, Release 1 Opportunity transition service, follow-up service.

**Interfaces:**

```ts
sendDraft(input: {
  opportunityId: string;
  draftId: string;
  requestKey: string;
}): Promise<{ draft: OpportunityEmailRecord; followUpReferenceAt: Date }>;

scheduleDraft(input: {
  opportunityId: string;
  draftId: string;
  requestKey: string;
  scheduledFor: Date;
}): Promise<{ draft: OpportunityEmailRecord; followUpReferenceAt: Date }>;

retryDraft(input: {
  opportunityId: string;
  draftId: string;
  requestKey: string;
}): Promise<{ draft: OpportunityEmailRecord; followUpReferenceAt: Date | null }>;
```

- [ ] **Step 1: Write failing successful-send tests**

Assert Gmail confirmation marks state `sent`, records outbound activity, advances eligible first outreach to `contacted`, moves the source work to Completed Today, and returns actual send time for follow-up choices.

- [ ] **Step 2: Write failing schedule tests**

Assert scheduling records `scheduled`, retains the row in Outbox, does not mark sent/contacted prematurely, and returns `scheduledFor` as the follow-up interval reference.

- [ ] **Step 3: Write failing failure-preservation tests**

On create/update/send/schedule failure: body/subject persist, Opportunity does not advance, failure metadata is recorded, Needs Attention is emitted, retry references the existing draft.

- [ ] **Step 4: Write failing idempotency/uncertain-outcome tests**

Same request key returns reconciled prior outcome; timeout/unknown outcome queries Gmail before resend and does not send twice.

- [ ] **Step 5: Implement send/schedule/retry orchestration**

Use Gmail response as the authority before changing workflow state. Keep all Opportunity/status/activity/failure updates after confirmed Gmail outcomes.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunity-email/opportunity-draft-service.test.ts src/routes/opportunity-drafts.test.ts
git add artifacts/api-server/src/features/opportunity-email artifacts/api-server/src/routes/opportunity-drafts.ts
git commit -m "feat: send and schedule opportunity drafts"
```

---

### Task 7: Build configurable scheduling presets and deterministic Morning Stagger

**Files:**
- Create: `artifacts/api-server/src/features/opportunity-email/send-window.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/send-window.test.ts`
- Reuse or extend: existing Booking/settings persistence for morning start/end and timezone defaults.

**Interfaces:**

```ts
export type SendWindowSettings = {
  morningStart: string; // HH:mm
  morningEnd: string;   // HH:mm
  weekdaysOnly: boolean;
  businessTimeZone: string;
};

export function tomorrowMorning(input: {
  now: Date;
  settings: SendWindowSettings;
  recipientTimeZone: string | null;
}): Date;

export function morningStagger(input: {
  now: Date;
  settings: SendWindowSettings;
  drafts: Array<{ id: string; recipientTimeZone: string | null }>;
}): Array<{ draftId: string; scheduledFor: Date }>;
```

- [ ] **Step 1: Write failing Tomorrow Morning tests**

Cover weekday rollover, Friday-to-Monday behavior, known recipient timezone, and business-timezone fallback.

- [ ] **Step 2: Write failing Morning Stagger tests**

Use a fixed ordered draft list and assert deterministic, evenly distributed timestamps inside the configured window without weak timezone guessing.

- [ ] **Step 3: Implement pure scheduling helpers**

Keep them independent from Gmail and database calls.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/opportunity-email/send-window.test.ts
git add artifacts/api-server/src/features/opportunity-email/send-window.ts artifacts/api-server/src/features/opportunity-email/send-window.test.ts
git commit -m "feat: add booking email send windows"
```

---

### Task 8: Build Ready to Send projection and bulk endpoints

**Files:**
- Create: `artifacts/api-server/src/features/opportunity-email/ready-to-send-service.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/ready-to-send-service.test.ts`
- Create: `artifacts/api-server/src/routes/today-ready-to-send.ts`
- Test: `artifacts/api-server/src/routes/today-ready-to-send.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**

```ts
export type ReadyToSendItem = {
  draftId: string;
  opportunityId: string;
  organizationId: string;
  eventName: string;
  recipientEmail: string;
  recipientName: string | null;
  purpose: OpportunityDraftPurpose;
  opportunityStatus: OpportunityStatus;
  state: OpportunityEmailState;
  scheduledFor: string | null;
  warning: string | null;
};

export type ReadyToSendSummary = {
  total: number;
  newOutreach: number;
  followUps: number;
  replies: number;
  items: ReadyToSendItem[];
};
```

Routes:

```text
GET  /today/ready-to-send
POST /today/ready-to-send/send
POST /today/ready-to-send/schedule
```

- [ ] **Step 1: Write failing summary/count tests**

Routine draft/scheduled rows appear; sent/cancelled rows do not. Counts split by purpose.

- [ ] **Step 2: Write failing bulk prevalidation tests**

Every selected draft must be owner-visible, belong to its Opportunity, be non-blocked, and be in an eligible state before execution begins.

- [ ] **Step 3: Write failing partial-failure tests**

Return item-level `{ draftId, ok, error? }` results. Successful rows remain successful even if another row fails; failed rows preserve draft/failure state and do not get falsely completed.

- [ ] **Step 4: Implement service/routes**

Bulk schedule supports explicit timestamps plus preset-generated timestamps from Task 7.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/opportunity-email/ready-to-send-service.test.ts \
  src/routes/today-ready-to-send.test.ts
git add artifacts/api-server/src/features/opportunity-email artifacts/api-server/src/routes
git commit -m "feat: add ready to send outbox API"
```

---

### Task 9: Build Event Profile draft composer and quick actions

**Files:**
- Create: `artifacts/adventure-zone/src/features/opportunity-email/opportunity-email-types.ts`
- Create: `artifacts/adventure-zone/src/components/opportunities/opportunity-draft-composer.tsx`
- Test: `artifacts/adventure-zone/src/components/opportunities/opportunity-draft-composer.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/opportunities/current-opportunity-card.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Test: `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx`

**Interfaces:**

Composer minimum UI:

```text
From
To
Subject
Body
Opportunity/event context strip
Saved / Scheduled / Sent / Failed state
Last failure
[Shorter] [More casual] [More direct] [Rewrite opening]
[More personal] [Stronger follow-up] [Fix wording] [Undo AI change]
[Save Draft] [Schedule] [Send]
```

- [ ] **Step 1: Write failing Current Opportunity Create Draft navigation test**

Create Draft must call the explicit create endpoint and open composer state only after success; blockers render review guidance instead of an empty composer.

- [ ] **Step 2: Write failing composer edit/save tests**

User typing changes local subject/body; Save sends current edited values and does not show a follow-up prompt.

- [ ] **Step 3: Write failing AI action + Undo tests**

Each quick action updates only returned subject/body. Undo restores the immediately previous AI-produced snapshot and does not roll back arbitrary typing history.

- [ ] **Step 4: Implement composer + profile integration**

Preserve existing Call/Add Note/Schedule Follow-Up/status controls and Release 1 Back to Today return context.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/opportunities/opportunity-draft-composer.test.tsx \
  src/pages/EventProfilePage.test.tsx
git add artifacts/adventure-zone/src/features/opportunity-email artifacts/adventure-zone/src/components/opportunities artifacts/adventure-zone/src/pages/EventProfilePage.tsx
git commit -m "feat: add opportunity email composer"
```

---

### Task 10: Add post-send/schedule follow-up prompt

**Files:**
- Create: `artifacts/adventure-zone/src/components/opportunities/follow-up-after-send.tsx`
- Test: `artifacts/adventure-zone/src/components/opportunities/follow-up-after-send.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/opportunities/opportunity-draft-composer.tsx`

**Interfaces:**

```ts
type FollowUpChoice =
  | { kind: "days"; days: 3 | 7 }
  | { kind: "date"; dueAt: string }
  | { kind: "none" };
```

- [ ] **Step 1: Write failing timing tests**

Save Draft never opens the prompt. Send uses actual sent timestamp. Schedule uses scheduled delivery timestamp.

- [ ] **Step 2: Write failing Release 1 follow-up integration tests**

3 days/7 days/custom creates one future follow-up linked to the same Opportunity. No follow-up creates none.

- [ ] **Step 3: Implement prompt**

Reuse the existing follow-up endpoint/service; do not create a second task type.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/opportunities/follow-up-after-send.test.tsx \
  src/components/opportunities/opportunity-draft-composer.test.tsx
git add artifacts/adventure-zone/src/components/opportunities
git commit -m "feat: prompt follow up after outreach"
```

---

### Task 11: Replace Today Ready to Send placeholder with functional Outbox

**Files:**
- Create: `artifacts/adventure-zone/src/components/today/ready-to-send-section.tsx`
- Test: `artifacts/adventure-zone/src/components/today/ready-to-send-section.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/master-work-queue.test.tsx`
- Remove or retire: Release 1 `ready-to-send-placeholder.tsx` only after integration tests are green.

- [ ] **Step 1: Write failing summary/expansion tests**

Assert collapsed `Ready to Send`, total count, purpose counts, and expansion to rows.

- [ ] **Step 2: Write failing selection/send tests**

Checkbox selection sends only selected eligible rows and refreshes the section after per-item outcomes.

- [ ] **Step 3: Write failing scheduling UI tests**

Support Send now, Tomorrow morning, Morning stagger, Pick date & time; show a concise preview before bulk schedule confirmation.

- [ ] **Step 4: Implement functional section between Needs Attention and Active Queue**

Routine drafts live here instead of duplicating into Active Queue. Important reply/hot-lead work may still have a Needs Attention source.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/today/ready-to-send-section.test.tsx \
  src/components/today/master-work-queue.test.tsx
git add artifacts/adventure-zone/src/components/today artifacts/adventure-zone/src/pages/TodayPage.tsx
git commit -m "feat: add today ready to send outbox"
```

---

### Task 12: Wire email failures/blockers into Needs Attention and Activity Timeline

**Files:**
- Modify: `artifacts/api-server/src/features/today/master-work-queue-repository.ts`
- Modify: `artifacts/api-server/src/features/today/master-work-queue.ts`
- Test: `artifacts/api-server/src/features/today/master-work-queue.test.ts`
- Reuse/modify: existing Activity repository/service used by Event Profile timeline.
- Modify: Event Profile timeline UI only if current activity renderer lacks email scheduled/failed labels.

- [ ] **Step 1: Write failing Needs Attention projection tests**

Blocked draft, protected-record review, territory exception, send failure, schedule failure, and important reply draft rank into Needs Attention with meaningful reason text.

- [ ] **Step 2: Write failing Activity tests**

Draft created/updated meaningfully, scheduled, sent, failed, and follow-up-created-after-outreach appear as activity records linked to Opportunity where supported. Keystroke edits do not.

- [ ] **Step 3: Implement projections/activity writes**

Do not duplicate routine Ready to Send rows into Active Queue.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/today/master-work-queue.test.ts \
  src/features/opportunity-email/opportunity-draft-service.test.ts
git add artifacts/api-server/src/features/today artifacts/api-server/src/features/opportunity-email
git commit -m "feat: surface email attention and activity"
```

---

### Task 13: Add focused Release 2 CI and regression acceptance

**Files:**
- Create: `.github/workflows/booking-master-work-queue-release-2-ci.yml`
- Modify tests only where behavior intentionally changed.

- [ ] **Step 1: Add focused API verification**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/opportunity-email \
  src/features/opportunities \
  src/features/today \
  src/features/follow-ups \
  src/routes/opportunity-drafts.test.ts \
  src/routes/today-ready-to-send.test.ts \
  src/routes/today.test.ts
```

- [ ] **Step 2: Add focused web verification**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/opportunities \
  src/components/today \
  src/pages/EventProfilePage.test.tsx
```

- [ ] **Step 3: Add build verification**

```bash
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

- [ ] **Step 4: Add typecheck discipline without hiding baseline debt**

Run package typechecks as informational if main still has known unrelated failures, then add a guard that fails when errors originate in the Release 2 touched feature/route/component paths. Do not mark global debt as fixed unless it is actually fixed.

- [ ] **Step 5: Run the Release 1 regression set**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/opportunities \
  src/features/today \
  src/features/follow-ups \
  src/routes/today.test.ts \
  src/routes/opportunities.test.ts

pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/today \
  src/pages/EventProfilePage.test.tsx \
  src/components/calls
```

- [ ] **Step 6: Manual acceptance flow**

Verify this exact sequence in the deployed/test app:

1. Open Today and enter a current Opportunity.
2. Create Draft from Event Profile.
3. Confirm clear context generates directly into editable composer.
4. Confirm missing/ambiguous recipient produces Needs Review instead of a guessed draft.
5. Edit subject/body and Save Draft; confirm no follow-up is created.
6. Reopen the same Opportunity and confirm the same current draft is reopened.
7. Run each quick AI action and one-step Undo.
8. Return to Today and confirm the draft appears in Ready to Send, not routine Active Queue.
9. Schedule one draft for Tomorrow morning.
10. Batch-schedule multiple drafts with Morning stagger and confirm preview.
11. Send one draft and verify Opportunity/Completed Today/activity update only after Gmail confirmation.
12. Choose a 3-day follow-up and verify a future Release 1 follow-up is created.
13. Force a send/schedule failure and verify draft preservation + Needs Attention + retry from the same draft.
14. Navigate back to Today and confirm prior queue context is restored.

- [ ] **Step 7: Commit CI/acceptance changes**

```bash
git add .github/workflows/booking-master-work-queue-release-2-ci.yml artifacts
git commit -m "test: verify booking email release 2"
```

---

## Completion Criteria

Release 2 is complete only when all of the following are true:

- Create Draft is explicit and Opportunity-linked.
- Draft context is relationship-aware and calendar-aware without inventing facts.
- Territory/protected/duplicate/decline ambiguity becomes Needs Review instead of guessed outreach.
- Existing drafts reopen instead of duplicating.
- Composer supports Save Draft, Schedule, Send, seven quick AI actions, and one-step AI Undo.
- Ready to Send is functional on Today with individual/bulk selection and approved scheduling presets.
- Successful Gmail outcomes drive Opportunity/Completed Today/activity updates; failed or uncertain outcomes do not falsely advance state.
- Follow-up prompt appears only after send/schedule and reuses Release 1 follow-ups.
- Failed drafts remain editable/retryable and appear in Needs Attention.
- Release 1 queue/profile/follow-up/call behavior remains green in focused regression tests.
- Focused API/web tests and builds pass.
- No new TypeScript errors exist in Release 2 touched files; unrelated pre-existing repo debt is reported accurately rather than hidden.
