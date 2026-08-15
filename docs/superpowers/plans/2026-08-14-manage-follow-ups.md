# Manage Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit follow-up details and permanently delete one follow-up while safely unlinking it from every related record.

**Architecture:** Add a focused follow-up input/service/repository boundary rather than expanding booking mutation code. The repository performs locked, transactional edit and delete operations; deletion clears only nullable inbound references before removing the target. A reusable mobile-friendly follow-up controls component is used on Today, booking detail, and event-profile screens.

**Tech Stack:** TypeScript, Express, Zod, Drizzle ORM/PostgreSQL, React, Wouter, Vitest, Testing Library, pnpm.

## Global Constraints

- Deleting a follow-up permanently deletes only that follow-up.
- Calls, contacts, profiles, bookings, and neighboring follow-ups must remain.
- Inbound nullable references are cleared in the same transaction.
- The deletion audit retains identifier, action, and timestamp but no deleted note/private content.
- The initiating screen updates immediately; other views update on refresh.
- Tests must be written and observed failing before production changes.

---

### Task 1: Create the follow-up mutation service

**Files:**
- Create: `artifacts/api-server/src/features/follow-ups/follow-up-input.ts`
- Create: `artifacts/api-server/src/features/follow-ups/follow-up-types.ts`
- Create: `artifacts/api-server/src/features/follow-ups/follow-up-repository.ts`
- Create: `artifacts/api-server/src/features/follow-ups/follow-up-service.ts`
- Create: `artifacts/api-server/src/features/follow-ups/follow-up-service.test.ts`
- Create: `artifacts/api-server/src/features/follow-ups/follow-up-repository.pglite.test.ts`

**Interfaces:**
- Produces: `EditFollowUpInput`
- Produces: `FollowUpService.edit(input)`
- Produces: `FollowUpService.delete(followUpId)`
- Produces: `FollowUpMutationResult = Result<FollowUpRecord, FollowUpError>`

- [ ] **Step 1: Write failing input and service tests**

Define expected usage in tests:

```ts
const result = await service.edit({
  followUpId,
  kind: "phone_call",
  dueAt: new Date("2026-09-01T15:00:00.000Z"),
  completed: true,
  outcome: "Spoke with organizer",
});
```

Assert blank kinds, invalid dates, and completed follow-ups without an outcome return `INVALID_FOLLOW_UP_INPUT`. Assert incomplete follow-ups normalize outcome to `null`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/follow-up-service.test.ts
```

Expected: FAIL because the mutation service does not exist.

- [ ] **Step 3: Add the types and Zod schemas**

Use these public types:

```ts
export type EditFollowUpInput = {
  followUpId: string;
  kind: string;
  dueAt: Date;
  completed: boolean;
  outcome: string | null;
};

export type FollowUpRecord = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
  outcome: string | null;
};

export type FollowUpError =
  | { code: "FOLLOW_UP_NOT_FOUND" }
  | { code: "INVALID_FOLLOW_UP_INPUT"; message: string };
```

The schema trims `kind` and `outcome`, requires a valid `Date`, and requires a nonblank outcome only when `completed` is true.

- [ ] **Step 4: Write the real PGlite deletion tests**

Seed:

- target follow-up A;
- neighboring follow-up B with `next_follow_up_id = A`;
- a call session whose `follow_up_id` and/or `next_follow_up_id` references A;
- a booking, contact, and organization related to A.

Assert deletion removes A, sets inbound nullable references to `null`, keeps B and all business parent rows, and writes only a minimal delete audit payload. Add a forced-failure test proving unlinking and deletion roll back together.

- [ ] **Step 5: Run the repository tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/follow-up-repository.pglite.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 6: Implement locked edit and delete transactions**

Edit transaction:

```ts
const completedAt = input.completed ? new Date() : null;
await tx.update(followUps).set({
  kind: input.kind,
  dueAt: input.dueAt,
  completedAt,
  outcome: input.completed ? input.outcome : null,
  updatedAt: now,
});
```

Delete transaction order:

1. lock target row with `FOR UPDATE`;
2. set `follow_ups.next_follow_up_id` to null where it equals target;
3. set `call_sessions.follow_up_id` and `call_sessions.next_follow_up_id` to null where they equal target;
4. record `{ entityType: "follow_up", entityId, action: "delete", before: null, after: null }`;
5. delete target;
6. return not-found without changing data when target is missing.

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/follow-up-service.test.ts src/features/follow-ups/follow-up-repository.pglite.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS with zero skips in the PGlite test.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/follow-ups
git commit -m "feat: add safe follow-up editing and deletion"
```

### Task 2: Add authenticated follow-up routes and web actions

**Files:**
- Create: `artifacts/api-server/src/routes/follow-ups.ts`
- Create: `artifacts/api-server/src/routes/follow-ups.test.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Create: `artifacts/adventure-zone/src/actions/follow-ups.ts`
- Create: `artifacts/adventure-zone/src/features/follow-ups/follow-up-types.ts`

**Interfaces:**
- Produces: `PATCH /follow-ups/:id`
- Produces: `DELETE /follow-ups/:id`
- Produces: `editFollowUpAction(input)`
- Produces: `deleteFollowUpAction(followUpId)`

- [ ] **Step 1: Write failing authenticated route tests**

Assert unauthenticated requests return 401. Assert valid PATCH returns the updated record, invalid PATCH returns 400, missing records return 404, and DELETE returns `{ ok: true }`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/follow-ups.test.ts
```

Expected: FAIL with missing routes or 404 responses.

- [ ] **Step 3: Implement routes and actions**

Register the router with the existing authenticated API middleware. Route responses:

```ts
{ ok: true, followUp: result.value }
{ ok: false, error: "Follow-up not found." }
{ ok: false, error: result.error.message }
```

Use `apiPatch` for edits and the existing authenticated fetch helper with method `DELETE` for deletion. Do not add an unauthenticated or generic delete endpoint.

- [ ] **Step 4: Run route tests and both typechecks**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/follow-ups.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/follow-ups.ts artifacts/api-server/src/routes/follow-ups.test.ts artifacts/api-server/src/app.ts artifacts/adventure-zone/src/actions/follow-ups.ts artifacts/adventure-zone/src/features/follow-ups/follow-up-types.ts
git commit -m "feat: expose authenticated follow-up controls"
```

### Task 3: Build reusable follow-up controls

**Files:**
- Create: `artifacts/adventure-zone/src/components/follow-ups/follow-up-controls.tsx`
- Create: `artifacts/adventure-zone/src/components/follow-ups/follow-up-controls.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/follow-up-list.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BookingDetailPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`

**Interfaces:**
- Consumes: `FollowUpRecord`
- Consumes: `editFollowUpAction` and `deleteFollowUpAction`
- Produces: `onChanged(updated)` and `onDeleted(followUpId)` callbacks

- [ ] **Step 1: Write failing component tests**

Test the mobile form labels and behavior:

```ts
fireEvent.click(screen.getByRole("button", { name: "Edit follow-up" }));
fireEvent.change(screen.getByLabelText("Due date"), {
  target: { value: "2026-09-01" },
});
fireEvent.change(screen.getByLabelText("Follow-up type"), {
  target: { value: "email" },
});
fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
expect(onChanged).toHaveBeenCalled();
```

For deletion, mock `window.confirm`, assert `Delete follow-up` calls the action once, removes only that card through `onDeleted`, and leaves the card visible on API failure.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/follow-ups/follow-up-controls.test.tsx
```

Expected: FAIL because the controls do not exist.

- [ ] **Step 3: Implement the mobile-friendly controls**

The component renders:

- collapsed `Edit follow-up` and `Delete follow-up` buttons;
- date input;
- follow-up type input/select using the currently supported kinds;
- completed checkbox;
- outcome input shown and required only when completed;
- inline error with `role="alert"`;
- disabled buttons while saving/deleting.

Confirmation text:

```ts
"Delete this follow-up permanently? Calls, contacts, profiles, bookings, and other follow-ups will remain."
```

- [ ] **Step 4: Integrate every follow-up surface**

Pass mutation callbacks from `TodayPage` so its local dashboard state replaces or removes the changed follow-up immediately. Add the same controls beside follow-ups on booking detail and event profiles, updating their local state without a full reload.

- [ ] **Step 5: Run focused web regressions**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/follow-ups/follow-up-controls.test.tsx src/components/today/call-queue-workspace.test.tsx src/pages/EventProfilePage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/follow-ups artifacts/adventure-zone/src/components/today/follow-up-list.tsx artifacts/adventure-zone/src/pages/TodayPage.tsx artifacts/adventure-zone/src/pages/BookingDetailPage.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx
git commit -m "feat: manage follow-ups across CRM screens"
```
