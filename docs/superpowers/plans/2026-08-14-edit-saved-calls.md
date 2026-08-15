# Edit Saved Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit a saved call note and outcome together without replaying or reversing any original call side effects.

**Architecture:** Extend activity timeline DTOs with nullable linked-call outcome metadata. The activity repository owns an atomic edit transaction that locks the activity and optional call session, updates only the note body and disposition, and records existing revision/audit data. The existing timeline component renders a call-specific editor when a linked session exists and keeps note-only editing for imported calls.

**Tech Stack:** TypeScript, Express, Zod, Drizzle ORM/PostgreSQL, React, Wouter, Vitest, Testing Library, pnpm.

## Global Constraints

- A call edit changes only the saved note and linked call-session disposition.
- It must not change bookings, contacts, DNC state, follow-ups, or any other original call effect.
- Imported or manual call activities without a call session remain note-editable.
- Mutations require the existing authenticated API session.
- Mobile controls use the existing button and form styles.
- Tests must be written and observed failing before production changes.

---

### Task 1: Expose linked call outcomes in activity timelines

**Files:**
- Modify: `artifacts/api-server/src/features/activities/activity-types.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-repository.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-repository.test.ts`
- Modify: `artifacts/adventure-zone/src/features/activities/activity-types.ts`
- Modify: `artifacts/adventure-zone/src/actions/activities.ts`

**Interfaces:**
- Produces: `ActivityTimelineItem.callOutcome: PersistedCallDisposition | null`
- Produces: `ActivityTimelineItem.hasLinkedCallSession: boolean`
- Consumes: `callSessions.noteActivityId` and `callSessions.disposition`

- [ ] **Step 1: Write the failing repository projection test**

Add a test that creates one call activity linked through `call_sessions.note_activity_id` and one unlinked call activity, then asserts:

```ts
expect(linked).toMatchObject({
  callOutcome: "left_voicemail",
  hasLinkedCallSession: true,
});
expect(unlinked).toMatchObject({
  callOutcome: null,
  hasLinkedCallSession: false,
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/activities/activity-repository.test.ts
```

Expected: FAIL because timeline items do not contain linked call metadata.

- [ ] **Step 3: Add the typed projection**

Add to both activity type files:

```ts
import type { PersistedCallDisposition } from "@/features/calls/call-types";

export type ActivityTimelineItem = {
  // existing fields
  callOutcome: PersistedCallDisposition | null;
  hasLinkedCallSession: boolean;
};
```

Update the repository timeline query to left join `callSessions` on:

```ts
eq(callSessions.noteActivityId, activities.id)
```

Project the call-session disposition and map it to the two new fields. Keep unlinked imported activities nullable. Update the web action coercion without changing the outcome string.

- [ ] **Step 4: Run the focused test and typechecks**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/activities/activity-repository.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/activities artifacts/adventure-zone/src/features/activities artifacts/adventure-zone/src/actions/activities.ts
git commit -m "feat: expose saved call outcomes in history"
```

### Task 2: Atomically edit a call note and outcome

**Files:**
- Modify: `artifacts/api-server/src/features/activities/activity-input.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-types.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-service.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-repository.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-service.test.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/activities.ts`
- Modify: `artifacts/adventure-zone/src/features/activities/activity-types.ts`

**Interfaces:**
- Produces: `EditActivityInput.callOutcome?: PersistedCallDisposition`
- Produces: atomic `ActivityRepository.edit(input)` result
- Preserves: existing `POST /activities/edit` route and response envelope

- [ ] **Step 1: Write failing validation and transaction tests**

Add service tests asserting an invalid disposition returns `INVALID_ACTIVITY_INPUT`. Add repository tests asserting:

```ts
await repository.edit({
  activityId,
  body: "Corrected note",
  reason: "Corrected the saved call",
  callOutcome: "spoke_with_contact",
});
```

updates the linked activity and call session, increases the activity revision count, and leaves seeded booking, contact-phone DNC, follow-up, and booking-status rows byte-for-byte unchanged.

Add a second test proving `callOutcome` on an unlinked activity returns a safe invalid-input error and does not update the note.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/activities/activity-service.test.ts src/features/activities/activity-repository.test.ts
```

Expected: FAIL because the schema and repository do not accept or persist `callOutcome`.

- [ ] **Step 3: Extend input validation**

Define the editable persisted outcomes explicitly:

```ts
const editableCallOutcome = z.enum([
  "no_answer",
  "left_voicemail",
  "follow_up_needed",
  "interested",
  "proposal_sent",
  "booked",
  "declined",
  "last_resort",
  "spoke_with_contact",
  "wrong_number",
  "do_not_call",
]);

export const editActivityInputSchema = z.object({
  activityId: z.string().uuid(),
  body: activityText,
  reason: z.string().trim().min(1, "Add a reason for the edit."),
  callOutcome: editableCallOutcome.optional(),
});
```

Mirror the optional property in API and web `EditActivityInput`.

- [ ] **Step 4: Implement the atomic repository edit**

Inside the existing transaction:

1. lock the non-deleted activity;
2. when `callOutcome` is supplied, lock the call session whose `noteActivityId` matches;
3. return `INVALID_ACTIVITY_INPUT` if no linked session exists;
4. insert the body revision;
5. update `activities.body`;
6. update only `call_sessions.disposition`;
7. record before/after audit snapshots for both changed records;
8. return the updated timeline item.

Do not call `CallService.complete`, booking writers, follow-up writers, or DNC writers.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/activities/activity-service.test.ts src/features/activities/activity-repository.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/activities artifacts/api-server/src/routes/activities.ts artifacts/adventure-zone/src/features/activities/activity-types.ts
git commit -m "feat: edit saved call notes and outcomes atomically"
```

### Task 3: Add the call-specific history editor

**Files:**
- Modify: `artifacts/adventure-zone/src/components/activities/activity-timeline.tsx`
- Modify: `artifacts/adventure-zone/src/components/activities/activity-timeline.test.tsx`

**Interfaces:**
- Consumes: `ActivityTimelineItem.callOutcome` and `hasLinkedCallSession`
- Calls: existing `editActivity(input: EditActivityInput)`
- Produces: mobile-friendly “Edit call” form

- [ ] **Step 1: Write failing UI tests**

Add tests that render a linked call and assert:

```ts
expect(screen.getByText("Left voicemail")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "Edit call" }));
fireEvent.change(screen.getByLabelText("Call outcome"), {
  target: { value: "spoke_with_contact" },
});
fireEvent.change(screen.getByLabelText("Edited call note"), {
  target: { value: "Talked with Amy" },
});
fireEvent.change(screen.getByLabelText("Reason for edit"), {
  target: { value: "Corrected entry" },
});
fireEvent.click(screen.getByRole("button", { name: "Save call edit" }));
expect(editActivity).toHaveBeenCalledWith(expect.objectContaining({
  callOutcome: "spoke_with_contact",
  body: "Talked with Amy",
}));
```

Add a separate test that an unlinked imported call shows `Edit activity` and no outcome field.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/activities/activity-timeline.test.tsx
```

Expected: FAIL because call outcomes and the call-specific editor are not rendered.

- [ ] **Step 3: Implement the editor**

Extend per-item edit state with `callOutcome`. For linked call activities:

- render the formatted outcome under the `Call` heading;
- label the action `Edit call`;
- label the textarea `Edited call note`;
- render a `Call outcome` select using all persisted outcome values;
- submit `callOutcome`;
- label the submit button `Save call edit`.

For unlinked activities, keep the existing note-only editor and labels.

- [ ] **Step 4: Verify UI, typecheck, and builds**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/activities/activity-timeline.test.tsx src/pages/ContactDetailPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone build
pnpm --filter @workspace/api-server build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/activities
git commit -m "feat: edit saved calls from history"
```
