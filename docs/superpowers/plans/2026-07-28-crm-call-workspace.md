# CRM and Call Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organization-level Last Resort handling, editable activity history, Quick Add, and a Five9-inspired call workflow that saves the note, result, and next action together.

**Architecture:** Extend the local CRM with focused organization, activity, and call modules. The Call Workspace composes those modules with existing contacts, bookings, and follow-ups; it does not contain duplicate persistence logic. Local completion is transactional, while later telephone and Act! history connectors consume the same call/activity interfaces.

**Tech Stack:** Next.js 16 App Router and server actions, React 19, TypeScript 6, Drizzle ORM/PostgreSQL, Clerk owner authorization, Zod 4, Vitest/Testing Library, Playwright.

## Global Constraints

- Phase 1 has no telephone-provider integration, predictive dialing, recording, transcription, agent monitoring, Gmail, or Outlook connection.
- No call, email, calendar write, or Act! change occurs automatically.
- Every server read and mutation requires `requireOwner()`.
- Last Resort applies to the organization/event account and requires a reason.
- Edited activities retain collapsed revision history.
- Completing a call saves its note, result, next action, and approved updates in one local transaction.
- Active opportunities retain the existing dated-next-action invariant.
- All new important mutations write audit entries.
- Existing contacts, bookings, Act! identities, and follow-ups must be preserved.
- New screens must work at phone and desktop widths and remain keyboard accessible.

---

## File Structure

- `features/organizations/last-resort-input.ts` — validates Last Resort changes.
- `features/organizations/organization-repository.ts` — organization summary and Last Resort persistence.
- `features/organizations/organization-service.ts` — confirmation, reason, and audit rules.
- `features/activities/activity-types.ts` — activity and revision view models.
- `features/activities/activity-input.ts` — note/activity validation.
- `features/activities/activity-repository.ts` — timeline reads, creates, edits, and revisions.
- `features/activities/activity-service.ts` — revision and audit policy.
- `features/calls/call-types.ts` — call dispositions and workspace/completion contracts.
- `features/calls/call-input.ts` — completion and caller-search validation.
- `features/calls/call-repository.ts` — atomic call completion transaction.
- `features/calls/call-service.ts` — call result, next-action, and Last Resort rules.
- `features/contacts/phone-normalization.ts` — canonical phone matching.
- `components/activities/activity-timeline.tsx` — compact timeline and revision disclosure.
- `components/calls/call-workspace.tsx` — focused call form.
- `components/contacts/quick-add-caller.tsx` — minimal first-call intake.

### Task 1: Add organization, activity, and call persistence

**Files:**

- Modify: `db/schema.ts`
- Modify: `features/import/act-matcher.ts`
- Modify: `features/act-sync/sync-repository.ts`
- Create: `db/migrations/0006_daily_crm_foundation.sql`
- Modify: `db/migrations/meta/_journal.json`
- Create: `db/migrations/meta/0006_snapshot.json`
- Modify: `tests/unit/schema-contract.test.ts`
- Create: `tests/integration/daily-crm-migration.test.ts`

**Interfaces:**

- Produces: `organizations.lastResort`, `organizations.lastResortReason`, `organizations.lastResortChangedAt`
- Produces: `contacts.normalizedPhone`
- Produces: `activities`, `activityRevisions`, and `callSessions` Drizzle tables
- Produces: follow-ups linked to at least one booking, organization, or contact
- Consumes: existing `organizations`, `contacts`, `bookings`, `followUps`, and `auditEntries`

- [ ] **Step 1: Write failing schema and migration tests**

Add assertions for:

```ts
expect(organizations.lastResort).toBeDefined();
expect(organizations.lastResortReason).toBeDefined();
expect(contacts.normalizedPhone).toBeDefined();
expect(activities.organizationId).toBeDefined();
expect(activities.contactId).toBeDefined();
expect(activities.bookingId).toBeDefined();
expect(activityRevisions.activityId).toBeDefined();
expect(callSessions.disposition).toBeDefined();
```

The integration test must migrate a database containing existing contacts,
bookings, follow-ups, and Act! links and then assert those record counts and IDs
are unchanged.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npx vitest run tests/unit/schema-contract.test.ts tests/integration/daily-crm-migration.test.ts
```

Expected: FAIL because the fields and tables do not exist.

- [ ] **Step 3: Add the schema and generated migration**

Add:

```ts
export const activityKindValues = [
  "call",
  "note",
  "follow_up",
  "status_change",
  "booking_update",
  "contract_update",
  "calendar",
  "act_history",
  "approved_suggestion",
] as const;

export const callDispositionValues = [
  "no_answer",
  "left_voicemail",
  "follow_up_needed",
  "interested",
  "proposal_sent",
  "booked",
  "declined",
  "last_resort",
] as const;
```

`activities` contains nullable organization/contact/booking links, kind, body,
occurred-at, created-at, and updated-at. `activity_revisions` contains the
activity ID, prior body, replacement body, reason, and created-at.
`call_sessions` contains organization/contact/booking/follow-up links,
disposition, note activity ID, started-at, ended-at, and created-at.

Make `follow_ups.booking_id` nullable, add nullable organization/contact links,
backfill them from existing bookings, and add a check requiring at least one
parent. Add and index `contacts.normalized_phone`; backfill normalized U.S.
numbers without changing the displayed phone. Update Act! import/sync writers
so future remote changes maintain the normalized field.

Add checks that an activity has at least one parent link and that Last Resort
cannot be true with a blank reason.

- [ ] **Step 4: Generate and inspect migration metadata**

Run:

```bash
npx drizzle-kit generate
```

Rename only the newly generated migration to
`0006_daily_crm_foundation.sql` if necessary. Verify it only adds the specified
columns, enums/checks, tables, indexes, and foreign keys.

- [ ] **Step 5: Run schema, migration, preflight, and type checks**

Run:

```bash
npx vitest run tests/unit/schema-contract.test.ts tests/integration/daily-crm-migration.test.ts
npm run db:preflight
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db features/import/act-matcher.ts features/act-sync/sync-repository.ts tests/unit/schema-contract.test.ts tests/integration/daily-crm-migration.test.ts
git commit -m "feat: add daily CRM schema"
```

### Task 2: Implement organization-level Last Resort

**Files:**

- Create: `features/organizations/last-resort-input.ts`
- Create: `features/organizations/organization-repository.ts`
- Create: `features/organizations/organization-service.ts`
- Create: `tests/unit/last-resort-input.test.ts`
- Create: `tests/integration/organization-service.test.ts`
- Create: `app/(private)/organizations/page.tsx`
- Create: `app/(private)/organizations/[organizationId]/page.tsx`
- Create: `app/(private)/organizations/actions.ts`
- Create: `components/organizations/organization-list.tsx`
- Create: `components/organizations/last-resort-control.tsx`
- Create: `components/organizations/last-resort-warning.tsx`
- Create: `tests/unit/last-resort-control.test.tsx`

**Interfaces:**

- Consumes: organization fields and `recordAuditEntry`
- Produces:

```ts
export type SetLastResortInput = {
  organizationId: string;
  enabled: boolean;
  reason: string;
};

export interface OrganizationRepository {
  setLastResort(input: SetLastResortInput, changedAt: Date): Promise<boolean>;
  getOrganizationSummary(organizationId: string): Promise<OrganizationSummary | null>;
}

export class OrganizationService {
  setLastResort(input: SetLastResortInput): Promise<Result<void, LastResortError>>;
}
```

- [ ] **Step 1: Write failing policy and repository tests**

Cover:

```ts
it("requires a reason when enabling Last Resort")
it("trims and preserves the reason")
it("writes one organization audit entry")
it("shows the inherited warning through every associated contact and booking")
it("allows a deliberate audited removal")
it("returns ORGANIZATION_NOT_FOUND without writing")
it("filters the organization list to Last Resort accounts")
it("filters Last Resort organizations by associated leg")
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
npx vitest run tests/unit/last-resort-input.test.ts tests/unit/last-resort-control.test.tsx tests/integration/organization-service.test.ts
```

Expected: FAIL because the organization module is missing.

- [ ] **Step 3: Implement validation, service, and repository**

Use:

```ts
export const setLastResortInputSchema = z.object({
  organizationId: z.uuid(),
  enabled: z.boolean(),
  reason: z.string().trim().max(2_000),
}).superRefine((value, context) => {
  if (value.enabled && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Add a Last Resort reason" });
  }
});
```

Perform the update and audit write in one database transaction. Contact and
booking detail queries read the organization flag; do not copy the flag onto
every contact. Add owner-protected organization list/detail pages with search,
Last Resort, and leg filters. Enabling requires a confirmation and reason;
clearing is deliberate and audited.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npx vitest run tests/unit/last-resort-input.test.ts tests/unit/last-resort-control.test.tsx tests/integration/organization-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/organizations app/'(private)'/organizations components/organizations tests/unit/last-resort-input.test.ts tests/unit/last-resort-control.test.tsx tests/integration/organization-service.test.ts
git commit -m "feat: add organization Last Resort workflow"
```

### Task 3: Add editable activity timelines with revision history

**Files:**

- Create: `features/activities/activity-types.ts`
- Create: `features/activities/activity-input.ts`
- Create: `features/activities/activity-repository.ts`
- Create: `features/activities/activity-service.ts`
- Create: `tests/unit/activity-input.test.ts`
- Create: `tests/integration/activity-service.test.ts`

**Interfaces:**

- Produces:

```ts
export type ActivityParent = {
  organizationId?: string;
  contactId?: string;
  bookingId?: string;
};

export type CreateActivityInput = ActivityParent & {
  kind: ActivityKind;
  body: string;
  occurredAt: Date;
};

export type EditActivityInput = {
  activityId: string;
  body: string;
  reason: string;
};

export interface ActivityRepository {
  listTimeline(parent: ActivityParent): Promise<ActivityTimelineItem[]>;
  create(input: CreateActivityInput): Promise<ActivityTimelineItem>;
  edit(input: EditActivityInput): Promise<Result<ActivityTimelineItem, ActivityError>>;
}
```

- [ ] **Step 1: Write failing activity tests**

Cover nonblank text, at least one parent, newest-first order, create audit,
revision containing before/after text, edit audit, collapsed revision data, and
missing activity behavior.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/activity-input.test.ts tests/integration/activity-service.test.ts
```

Expected: FAIL because activity files do not exist.

- [ ] **Step 3: Implement the focused activity module**

`edit()` must lock the activity, insert one revision, update the current body,
and write one audit entry in one transaction. Timeline records expose
`revisionCount` but load full revisions only when the disclosure is opened.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run tests/unit/activity-input.test.ts tests/integration/activity-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/activities tests/unit/activity-input.test.ts tests/integration/activity-service.test.ts
git commit -m "feat: add editable CRM activity timeline"
```

### Task 4: Implement transactional call completion

**Files:**

- Create: `features/calls/call-types.ts`
- Create: `features/calls/call-input.ts`
- Create: `features/calls/call-repository.ts`
- Create: `features/calls/call-service.ts`
- Create: `tests/unit/call-input.test.ts`
- Create: `tests/integration/call-service.test.ts`

**Interfaces:**

- Consumes: `ActivityRepository`, organization Last Resort transaction support,
  existing booking/follow-up rules
- Produces:

```ts
export type CallDisposition =
  | "no_answer"
  | "left_voicemail"
  | "follow_up_needed"
  | "interested"
  | "proposal_contract_sent"
  | "booked"
  | "declined"
  | "move_to_last_resort";

export type CompleteCallInput = {
  organizationId: string;
  contactId: string | null;
  bookingId: string | null;
  followUpId: string | null;
  note: string;
  disposition: CallDisposition;
  resultingBookingStatus: BookingStatus | null;
  startedAt: Date;
  endedAt: Date;
  nextAction: { kind: string; dueAt: Date } | null;
  lastResortReason: string | null;
  approvedContactUpdates: Partial<ContactFields> | null;
  approvedBookingUpdates: Partial<BookingEditInput> | null;
};

export class CallService {
  complete(input: CompleteCallInput): Promise<Result<CompletedCall, CallError>>;
}
```

- [ ] **Step 1: Write failing call-workflow tests**

Cover every disposition, end-before-start rejection, Last Resort reason,
required next action for active results, optional next action for declined/Last
Resort, already-completed follow-up protection, and rollback when any local
write fails.

- [ ] **Step 2: Run the focused tests**

Run:

```bash
npx vitest run tests/unit/call-input.test.ts tests/integration/call-service.test.ts
```

Expected: FAIL because the call domain does not exist.

- [ ] **Step 3: Implement the call transaction**

In one repository transaction:

1. Lock linked follow-up/booking/organization records.
2. Create the call activity.
3. Create the call session.
4. Complete and link the current follow-up when supplied.
5. Create the next follow-up when supplied.
6. Apply the mapped booking status when the result requires it.
7. Apply only the explicitly approved contact/booking field updates.
8. Apply Last Resort only for `move_to_last_resort`.
9. Write audit entries.

Return typed errors instead of throwing expected policy failures.

- [ ] **Step 4: Run call, booking, and follow-up regression tests**

Run:

```bash
npx vitest run tests/unit/call-input.test.ts tests/integration/call-service.test.ts tests/integration/booking-service.test.ts tests/unit/follow-up-policy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/calls tests/unit/call-input.test.ts tests/integration/call-service.test.ts
git commit -m "feat: add transactional call completion"
```

### Task 5: Add phone matching and minimal Quick Add

**Files:**

- Create: `features/contacts/phone-normalization.ts`
- Modify: `features/contacts/contact-repository.ts`
- Modify: `features/contacts/contact-types.ts`
- Create: `components/contacts/quick-add-caller.tsx`
- Create: `app/(private)/quick-add/page.tsx`
- Create: `app/(private)/quick-add/actions.ts`
- Modify: `components/navigation/app-shell.tsx`
- Create: `tests/unit/phone-normalization.test.ts`
- Create: `tests/unit/quick-add-caller.test.tsx`
- Modify: `tests/integration/contact-repository.test.ts`

**Interfaces:**

- Produces:

```ts
export function normalizeNorthAmericanPhone(value: string): string | null;

export type PhoneMatch =
  | { kind: "one"; contact: ContactListRecord }
  | { kind: "many"; contacts: ContactListRecord[] }
  | { kind: "none"; normalizedPhone: string };

export function findContactsByPhone(phone: string): Promise<PhoneMatch>;
```

- [ ] **Step 1: Write failing phone and Quick Add tests**

Cover formatted/11-digit normalization, extension rejection, exact match,
multiple matches, no match preserving the entered phone, minimum New Caller
fields, and navigation accessibility.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/phone-normalization.test.ts tests/unit/quick-add-caller.test.tsx tests/integration/contact-repository.test.ts
```

Expected: FAIL because phone matching and Quick Add are missing.

- [ ] **Step 3: Implement matching and the minimal intake flow**

Quick Add asks for name, organization/event, phone or email, reason for calling,
and optional event date/location. On success it creates/reuses the organization,
creates the contact, creates a note activity, and redirects to the new Call
Workspace. If matching returns many, render a chooser; if none, prefill New
Caller.

- [ ] **Step 4: Run focused tests, lint, and typecheck**

Run:

```bash
npx vitest run tests/unit/phone-normalization.test.ts tests/unit/quick-add-caller.test.tsx tests/integration/contact-repository.test.ts
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/contacts components/contacts app/'(private)'/quick-add tests
git commit -m "feat: add quick caller intake"
```

### Task 6: Build the Call Workspace and activity timeline UI

**Files:**

- Create: `app/(private)/calls/new/page.tsx`
- Create: `app/(private)/calls/actions.ts`
- Create: `components/calls/call-workspace.tsx`
- Create: `components/activities/activity-timeline.tsx`
- Modify: `app/(private)/contacts/[contactId]/page.tsx`
- Modify: `app/(private)/bookings/[bookingId]/page.tsx`
- Create: `tests/unit/call-workspace.test.tsx`
- Create: `tests/unit/activity-timeline.test.tsx`

**Interfaces:**

- Consumes: `CompleteCallInput`, `ActivityTimelineItem`, `PhoneMatch`
- Produces: `/calls/new?contactId=&bookingId=&followUpId=` UI entry point for
  Today, contact, booking, and future telephone adapters

- [ ] **Step 1: Write failing component tests**

Assert the workspace displays identity, Last Resort warning, recent history,
call note, booking snapshot, eight dispositions, next action, full-record link,
server errors, and preserved values after a failed submission. Assert revisions
remain collapsed until **View edit history** is activated.

- [ ] **Step 2: Run component tests**

Run:

```bash
npx vitest run tests/unit/call-workspace.test.tsx tests/unit/activity-timeline.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement owner-protected page, action, and components**

Load workspace data server-side. Submit through a server action that validates
again, calls `CallService.complete()`, returns readable typed errors, and
revalidates Today, contact, booking, and organization views. Do not add fake
telephone controls; label the screen **Call Workspace** and start timing only
when the user presses **Start call note**.

- [ ] **Step 4: Run focused and accessibility tests**

Run:

```bash
npx vitest run tests/unit/call-workspace.test.tsx tests/unit/activity-timeline.test.tsx tests/unit/contact-components.test.tsx
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/'(private)'/calls components/calls components/activities app/'(private)'/contacts app/'(private)'/bookings tests/unit
git commit -m "feat: add focused Call Workspace"
```

### Task 7: Connect Today and verify the complete CRM workflow

**Files:**

- Modify: `features/follow-ups/today-query.ts`
- Modify: `components/today/next-call-card.tsx`
- Modify: `components/today/follow-up-list.tsx`
- Modify: `app/(private)/today/page.tsx`
- Modify: `tests/unit/today-components.test.tsx`
- Modify: `tests/unit/today-priority.test.ts`
- Create: `tests/e2e/call-workspace.spec.ts`
- Modify: `tests/e2e/responsive.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**

- Consumes: `/calls/new` entry point and existing `TodayDashboard`
- Produces: due-call links and pending Last Resort/next-action visibility

- [ ] **Step 1: Write failing Today and end-to-end tests**

Cover:

1. Due call opens the correct contact/booking/follow-up workspace.
2. Completing **Interested** with a next action updates Today and the timeline.
3. Completing **Declined** closes the current follow-up.
4. Moving to Last Resort requires and displays the reason.
5. Unknown caller can be Quick Added and completed.
6. Phone and desktop layouts do not overflow.
7. Keyboard-only completion has visible focus and associated labels.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npx vitest run tests/unit/today-components.test.tsx tests/unit/today-priority.test.ts
```

Expected: FAIL because Today still links to booking details.

- [ ] **Step 3: Implement Today integration**

Add the contact/organization identifiers needed to `FollowUpSummary`, link call
actions to `/calls/new`, support organization/contact-only follow-ups, and keep
non-call booking follow-ups linked to their booking.
Do not add dashboard analytics or off-app notifications.

- [ ] **Step 4: Run the full verification suite**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/call-workspace.spec.ts tests/e2e/responsive.spec.ts tests/e2e/accessibility.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/follow-ups components/today app/'(private)'/today tests
git commit -m "feat: connect calls to Today dashboard"
```
