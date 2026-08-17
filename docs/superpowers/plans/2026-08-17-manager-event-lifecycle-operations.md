# Manager Event Lifecycle + Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Leg Manager operational flow with permanent worker deletion, receipt capture with AI-assisted field extraction, event check-in/check-out, and resumable post-event wrap-up.

**Architecture:** Reuse the existing crew, finance, receipt, review, incident, and wrap-up systems rather than creating parallel feature stacks. Add one small booking+leg lifecycle record for check-in/out and wrap-up status; all domain data stays in its existing source-of-truth tables. Extend the existing provider-agnostic AI client with an image-capable receipt-extraction path, but require human confirmation before any expense is saved.

**Tech Stack:** React + TypeScript, Wouter, Express, Drizzle ORM/PostgreSQL, Vitest + Testing Library, IndexedDB/offline manager queues, Google Cloud receipt object storage, existing Anthropic/OpenAI provider infrastructure.

## Global Constraints

- Lifecycle order is **Booked → Check in → At event → Check out → Wrap-up incomplete → Finished**.
- Worker deletion is permanent and requires a second explicit named confirmation action.
- A Leg Manager may permanently delete only a worker associated with their own leg; Admin may permanently delete any worker.
- Worker deletion removes worker-owned work history, ratings, manager notes, and worker-specific event links, but never unrelated bookings, trips, finance entries, events, or workers.
- Receipt capture must work from camera or existing image and must preserve the original image.
- AI receipt extraction only proposes merchant, total, tax, and transaction date; the manager must review/edit before saving.
- Receipt extraction failure must fall back to manual entry without losing the captured image.
- Offline expense sync must occur before receipt metadata/image upload; upload failure must not roll back the saved expense.
- Check-in/out ownership is booking + leg and must not depend on a Trip record.
- GPS is optional and may never block check-in or check-out.
- Check-out must persist before wrap-up navigation occurs.
- Existing due-review behavior remains authoritative and must not be duplicated.
- Finish later preserves all already-saved wrap-up section data.
- Cross-leg permissions are server-enforced.
- Do not introduce payroll/timeclock functionality or geofence requirements.

---

## File Structure

**Worker deletion**
- Modify: `artifacts/api-server/src/features/leg-manager/crew-repository.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/crew-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Create: `artifacts/api-server/src/routes/leg-manager-worker-delete.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/ManagerWorkerPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerWorkerPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.tsx`

**Receipt entry + extraction**
- Modify: `artifacts/api-server/src/features/ai-suggestions/ai-client.ts`
- Create: `artifacts/api-server/src/features/leg-manager/receipt-extraction.ts`
- Create: `artifacts/api-server/src/features/leg-manager/receipt-extraction.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Create: `artifacts/adventure-zone/src/components/manager/receipt-expense-form.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/receipt-expense-form.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/manager/receipt-capture.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerReceiptsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerReceiptsPage.test.tsx`

**Event lifecycle persistence**
- Modify: `lib/db/src/schema/index.ts`
- Add migration using the repository's next numbered migration file under `lib/db/migrations/`
- Create: `artifacts/api-server/src/features/leg-manager/event-lifecycle-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-lifecycle-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`

**Check-in/out + wrap-up UI**
- Create: `artifacts/adventure-zone/src/features/manager/event-location.ts`
- Create: `artifacts/adventure-zone/src/features/manager/event-location.test.ts`
- Create: `artifacts/adventure-zone/src/components/manager/event-lifecycle-action.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/event-lifecycle-action.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerEventReviewPage.tsx`

---

### Task 1: Permanent Worker Deletion With Server-Enforced Scope

**Files:**
- Modify: `artifacts/api-server/src/features/leg-manager/crew-repository.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/crew-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Create: `artifacts/api-server/src/routes/leg-manager-worker-delete.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/ManagerWorkerPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerWorkerPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.tsx`

**Interfaces:**
- Produce `crew.workerBelongsToLeg(workerId: string, legId: string): Promise<boolean>`.
- Produce `crew.deleteWorker(workerId: string): Promise<boolean>` that transactionally removes worker-owned children then the worker.
- Manager route: `DELETE /manager/crew/:workerId`.
- Admin route: `DELETE /manager-admin/crew/:workerId`.

- [ ] **Step 1: Add failing repository tests for scoped ownership and cascade delete**

Add tests that create two workers and two legs, attach work-history and manager-note rows to one worker, then assert:

```ts
expect(await repo.workerBelongsToLeg(workerA.id, legA.id)).toBe(true);
expect(await repo.workerBelongsToLeg(workerA.id, legB.id)).toBe(false);
expect(await repo.deleteWorker(workerA.id)).toBe(true);
expect(await repo.getWorker(workerA.id)).toBeNull();
expect(await repo.getWorkHistory(historyA.id)).toBeNull();
expect(await repo.getManagerNote(noteA.id)).toBeNull();
expect(await repo.getWorker(workerB.id)).not.toBeNull();
```

- [ ] **Step 2: Run the focused repository test**

Run:
```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts
```
Expected: FAIL because worker-level delete/ownership methods do not yet exist.

- [ ] **Step 3: Implement repository ownership + transactional delete**

In `crew-repository.ts`, add `getWorker`, `workerBelongsToLeg`, and `deleteWorker`. Ownership is true when any worker work-history or manager-note row belongs to the supplied leg. Delete worker-owned child records first inside one database transaction, then delete the worker row. Return false when the worker does not exist.

- [ ] **Step 4: Add failing route permission tests**

Create `leg-manager-worker-delete.test.ts` covering:
- own-leg manager gets 204
- unrelated-leg manager gets 403
- missing worker gets 404
- admin delete gets 204 regardless of leg

- [ ] **Step 5: Implement manager/admin delete routes**

Manager route:
```ts
router.delete("/manager/crew/:workerId", requireManager, async (req, res) => {
  const workerId = routeParam(req.params.workerId);
  if (!(await crew.workerBelongsToLeg(workerId, req.legManager!.legId))) {
    res.status(403).json({ error: "This worker is not associated with your leg" });
    return;
  }
  if (!(await crew.deleteWorker(workerId))) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  res.status(204).end();
});
```

Admin route performs only existence/delete checks and has no leg restriction.

- [ ] **Step 6: Add UI test for two-step named confirmation**

Test that the first **Delete worker** click does not call DELETE, then the confirmation renders `Delete <worker name>`, and only that second action calls the route and returns to `/manager/crew`.

- [ ] **Step 7: Implement manager/admin destructive confirmation UI**

On `ManagerWorkerPage`, add a danger section after ordinary worker tools. The first button reveals a warning containing the worker name and that history/notes will also be permanently deleted. The second button must be exactly `Delete ${worker.name}`. On success navigate to `/manager/crew`.

In `ManagerAftermathAdminPage`, expose the same named confirmation next to workers in the existing admin crew area using `/manager-admin/crew/:workerId`.

- [ ] **Step 8: Run focused tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts src/routes/leg-manager-worker-delete.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerWorkerPage.test.tsx
```

Commit:
```bash
git add artifacts/api-server/src/features/leg-manager/crew-repository.ts artifacts/api-server/src/features/leg-manager/crew-repository.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/routes/leg-manager-worker-delete.test.ts artifacts/adventure-zone/src/pages/ManagerWorkerPage.tsx artifacts/adventure-zone/src/pages/ManagerWorkerPage.test.tsx artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.tsx
git commit -m "feat: add scoped permanent worker deletion"
```

---

### Task 2: Receipt-First Expense Entry With AI Suggestions

**Files:**
- Modify: `artifacts/api-server/src/features/ai-suggestions/ai-client.ts`
- Create: `artifacts/api-server/src/features/leg-manager/receipt-extraction.ts`
- Create: `artifacts/api-server/src/features/leg-manager/receipt-extraction.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Create: `artifacts/adventure-zone/src/components/manager/receipt-expense-form.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/receipt-expense-form.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/manager/receipt-capture.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerReceiptsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerReceiptsPage.test.tsx`

**Interfaces:**
- Extend AI client with optional `completeImage(input: { prompt: string; mimeType: string; base64: string }): Promise<string>` using the same provider-selection order as `complete()`.
- Produce `extractReceiptFields(image): Promise<{ merchant: string | null; totalCents: number | null; taxCents: number | null; occurredAt: string | null }>`.
- Manager route: `POST /manager/receipts/extract` with raw image bytes and image content type.
- New form accepts optional `initialImage: File` and optional extraction suggestions, then creates an expense before queueing the receipt metadata/image.

- [ ] **Step 1: Add failing extraction parser tests**

Cover valid JSON, fenced JSON, missing fields, malformed provider response, and impossible negative values. Expected normalized result example:

```ts
expect(result).toEqual({
  merchant: "Pilot Travel Center",
  totalCents: 4876,
  taxCents: 276,
  occurredAt: "2026-08-17",
});
```

Malformed extraction returns all-null suggestions instead of throwing away the image flow.

- [ ] **Step 2: Extend the existing AI provider client for images**

For Anthropic, use one user message containing an image block plus text prompt. For OpenAI, use a user message containing text plus a `data:<mime>;base64,...` image URL. Keep provider priority unchanged and keep `complete()` behavior unchanged for existing callers.

- [ ] **Step 3: Implement `receipt-extraction.ts`**

Prompt requires JSON only:
```json
{"merchant":null,"totalCents":null,"taxCents":null,"occurredAt":null}
```
Validate and normalize with Zod. Never infer cents from ambiguous text client-side; provider output must already be integer cents.

- [ ] **Step 4: Add and implement `/manager/receipts/extract`**

Use `express.raw({ type: "image/*", limit: "12mb" })`. If no AI provider is configured, return HTTP 200 with `{ suggestions: null, unavailable: true }` so capture continues manually. Other extraction failures likewise return a safe manual-fallback payload rather than deleting the photo.

- [ ] **Step 5: Add failing Receipts empty-state/UI tests**

Assert the empty page exposes:
- `+ Add receipt`
- `Add expense manually`

For Add receipt, provide a fake image, mock extraction, and assert merchant/total/tax/date populate editable inputs before Save.

- [ ] **Step 6: Implement `ReceiptExpenseForm` and receipt-first sequencing**

Form fields:
- merchant
- total
- tax
- date
- category
- payment source
- optional booking/trip association
- notes

On receipt-first Save:
1. create `/manager/expenses` using a stable client mutation ID
2. receive the persisted expense ID
3. queue receipt metadata referencing that expense ID
4. queue image blob
5. flush expense mutation before receipt metadata/image when online

Manual expense uses the same form without an image/extraction step.

- [ ] **Step 7: Preserve existing offline semantics**

Reuse `manager-sync-queue` and `manager-blob-queue`. The image must remain locally queued when extraction is unavailable/offline; when online returns, expense sync occurs before receipt upload.

- [ ] **Step 8: Run focused tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/receipt-extraction.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/receipt-expense-form.test.tsx src/pages/ManagerReceiptsPage.test.tsx
```

Commit:
```bash
git add artifacts/api-server/src/features/ai-suggestions/ai-client.ts artifacts/api-server/src/features/leg-manager/receipt-extraction.ts artifacts/api-server/src/features/leg-manager/receipt-extraction.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/adventure-zone/src/components/manager/receipt-expense-form.tsx artifacts/adventure-zone/src/components/manager/receipt-expense-form.test.tsx artifacts/adventure-zone/src/components/manager/receipt-capture.tsx artifacts/adventure-zone/src/pages/ManagerReceiptsPage.tsx artifacts/adventure-zone/src/pages/ManagerReceiptsPage.test.tsx
git commit -m "feat: add receipt-first expense capture"
```

---

### Task 3: Persist Booking + Leg Check-In/Out State

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Add migration under: `lib/db/migrations/`
- Create: `artifacts/api-server/src/features/leg-manager/event-lifecycle-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-lifecycle-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`

**Interfaces:**
- New table `event_leg_lifecycle` keyed uniquely by `(booking_id, leg_id)`.
- Columns: `id`, `booking_id`, `leg_id`, `checked_in_at`, `check_in_latitude`, `check_in_longitude`, `check_in_location_status`, `checked_out_at`, `check_out_latitude`, `check_out_longitude`, `check_out_location_status`, `wrap_up_status`, `wrap_up_finished_at`, `created_at`, `updated_at`.
- Location status enum values: `captured | unavailable | denied | error | not_requested`.
- Wrap-up status values: `not_started | incomplete | finished`.
- Manager routes:
  - `GET /manager/events/:bookingId/lifecycle`
  - `POST /manager/events/:bookingId/check-in`
  - `POST /manager/events/:bookingId/check-out`
  - `POST /manager/events/:bookingId/wrap-up/finish-later`
  - `POST /manager/events/:bookingId/wrap-up/finish`
- Admin route: `GET /manager-admin/events/lifecycle`.

- [ ] **Step 1: Add failing repository tests**

Test:
- check-in inserts once
- repeated check-in returns same timestamp and does not duplicate
- check-out before check-in returns `NOT_CHECKED_IN`
- repeated check-out is idempotent
- GPS-null status persists
- finish-later sets incomplete
- finish sets finished with timestamp

- [ ] **Step 2: Add schema + migration**

Create the table with booking and leg foreign keys and a unique index on `(booking_id, leg_id)`. Use nullable coordinate columns and non-null location-status strings with defaults. Do not reference `trip_id`.

- [ ] **Step 3: Implement repository methods**

Produce:
```ts
getForBookingLeg(bookingId, legId)
checkIn(input)
checkOut(input)
markIncomplete(bookingId, legId)
markFinished(bookingId, legId)
listIncompleteForLeg(legId)
listAll()
```

Use transactions/upserts so duplicate mobile retries are idempotent.

- [ ] **Step 4: Add manager route tests for cross-leg protection**

Before each manager lifecycle mutation, verify `finance.refsBelongToLeg(legId, { bookingId, tripId: null, tripSegmentId: null })`. A booking on another leg returns 403.

- [ ] **Step 5: Implement lifecycle routes**

`check-out` must call repository persistence and return the stored lifecycle record before any client navigation occurs. `finish` is an explicit status action, not an inference from page navigation.

- [ ] **Step 6: Add admin lifecycle read endpoint**

Return booking/leg identity, timestamps, optional coordinates, location statuses, and wrap-up status for operational oversight. Do not mutate history in this task.

- [ ] **Step 7: Run focused tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-lifecycle-repository.test.ts
```

Commit schema, migration, repository, and routes together.

---

### Task 4: One-Tap Check-In / Check-Out With Optional Location

**Files:**
- Create: `artifacts/adventure-zone/src/features/manager/event-location.ts`
- Create: `artifacts/adventure-zone/src/features/manager/event-location.test.ts`
- Create: `artifacts/adventure-zone/src/components/manager/event-lifecycle-action.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/event-lifecycle-action.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`

**Interfaces:**
- `captureOptionalEventLocation(): Promise<{ latitude: number | null; longitude: number | null; status: EventLocationStatus }>`.
- `EventLifecycleAction` consumes booking ID + lifecycle state and emits one current action: Check in, Check out, or Finish event wrap-up.

- [ ] **Step 1: Add location helper tests**

Mock `navigator.geolocation` for:
- success → `captured` + coords
- permission denied → `denied`, null coords
- unavailable → `unavailable`, null coords
- error → `error`, null coords
- missing API → `not_requested`, null coords

No case throws to the calling check-in/out action.

- [ ] **Step 2: Implement optional location helper**

Use a bounded geolocation timeout. Resolve a status object in all cases; never reject because GPS is optional.

- [ ] **Step 3: Add lifecycle-action component tests**

Given lifecycle state:
- no check-in → only `Check in`
- checked in/no checkout → only `Check out`
- checked out/incomplete → only `Finish event wrap-up`
- finished → no urgent lifecycle button

Also assert duplicate click disables the button while the request is pending.

- [ ] **Step 4: Implement lifecycle action calls**

Check-in/out payload:
```ts
{
  occurredAt: new Date().toISOString(),
  latitude,
  longitude,
  locationStatus: status,
  clientMutationId: crypto.randomUUID()
}
```
After successful checkout, navigate immediately to `/manager/events/${bookingId}/wrap-up`.

- [ ] **Step 5: Wire Manager Home**

Load lifecycle state for the relevant assigned event and show one action at a time near the top work queue. Incomplete wrap-up gets the label **Finish event wrap-up**.

- [ ] **Step 6: Wire Manager Schedule/event detail**

In the existing schedule detail sheet, show:
- Checked in + formatted arrival time
- Checked out + formatted departure time
- current lifecycle action
- `Wrap-up incomplete` indicator after checkout until Finish

- [ ] **Step 7: Run focused frontend tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/manager/event-location.test.ts src/components/manager/event-lifecycle-action.test.tsx src/pages/ManagerHomePage.test.tsx
```

Commit the helper, component, and page integrations.

---

### Task 5: Make Existing Event Wrap-Up Resumable and Lifecycle-Aware

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerEventReviewPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
- Modify existing wrap-up/review tests or create: `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.test.tsx`

**Interfaces:**
- Existing event review POST remains the only review record.
- Existing crew, finance/receipt, incident, and calculator data remain persisted in their current stores.
- Lifecycle `wrap_up_status` records only overall workflow status, not duplicate copies of section data.

- [ ] **Step 1: Add failing wrap-up resume tests**

Cover:
- checkout route opens correct booking wrap-up
- saved review remains present when returning
- `Finish later` calls lifecycle incomplete endpoint and returns to manager Home
- Home shows Finish event wrap-up for incomplete booking
- Schedule shows Wrap-up incomplete
- `Finish wrap-up` calls lifecycle finish endpoint

- [ ] **Step 2: Convert wrap-up page into a checklist shell around existing sections**

Render the existing event review, crew/work-history, finance/receipt, incidents/issues, and calculator sections without copying their data into lifecycle state. Each section may save independently.

- [ ] **Step 3: Add Finish later**

Call:
```text
POST /manager/events/:bookingId/wrap-up/finish-later
```
Then return to Manager Home. Do not clear any form/server state.

- [ ] **Step 4: Add Finish wrap-up**

Before marking finished, require only the explicitly required completion conditions already enforced by existing wrap-up logic. Optional receipt/incident/crew-note sections may remain empty. Call the lifecycle finish endpoint only after those checks pass.

- [ ] **Step 5: Reuse current event review**

Submitting the review from the wrap-up must use the existing review route. Returning to wrap-up fetches existing review state. Because `listDueReviewsForManager()` already excludes reviewed booking IDs, completing the review here automatically removes it from due reviews.

- [ ] **Step 6: Verify skipped review behavior**

Add API/service coverage proving an incomplete wrap-up with no review does not suppress `listDueReviewsForManager()` once the event's effective end date is due.

- [ ] **Step 7: Run focused tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerEventWrapUpPage.test.tsx src/pages/ManagerHomePage.test.tsx src/pages/ManagerEventReviewPage.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-review-repository.test.ts
```

Commit the wrap-up integration.

---

### Task 6: Release Verification and Regression Guard

**Files:**
- Modify only if needed after verification: `.github/workflows/calendar-route-handoff-ci.yml`

**Interfaces:**
- No new product interface; this task verifies all prior tasks together.

- [ ] **Step 1: Run all focused server tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts src/routes/leg-manager-worker-delete.test.ts src/features/leg-manager/receipt-extraction.test.ts src/features/leg-manager/event-lifecycle-repository.test.ts src/features/leg-manager/event-review-repository.test.ts
```

- [ ] **Step 2: Run all focused frontend tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerWorkerPage.test.tsx src/components/manager/receipt-expense-form.test.tsx src/pages/ManagerReceiptsPage.test.tsx src/features/manager/event-location.test.ts src/components/manager/event-lifecycle-action.test.tsx src/pages/ManagerHomePage.test.tsx src/pages/ManagerEventWrapUpPage.test.tsx src/pages/ManagerEventReviewPage.test.tsx
```

- [ ] **Step 3: Run package typechecks/builds**

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

- [ ] **Step 4: Manual mobile acceptance pass**

Verify on a Leg Manager session:
1. own-leg worker can be permanently deleted only after named confirmation
2. unrelated worker has no usable delete path
3. Receipts empty state allows camera/manual entry
4. captured receipt fills suggestions but remains editable
5. check-in works after denying GPS
6. check-out immediately opens wrap-up
7. Finish later returns Home and leaves a resume action
8. Schedule shows Wrap-up incomplete
9. returning to wrap-up preserves already-saved section data
10. Finish removes urgent lifecycle action

- [ ] **Step 5: Commit any test-only regression fixes**

Use a focused commit message such as:
```bash
git commit -m "test: verify manager event lifecycle release"
```
