# Manager Event Lifecycle + Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Leg Manager operational flow with permanent worker deletion, receipt capture with AI-assisted field extraction, event check-in/check-out, and resumable post-event wrap-up.

**Architecture:** Reuse the existing crew, finance, receipt, review, incident, and wrap-up systems rather than creating parallel feature stacks. Add one small booking+leg lifecycle record for check-in/out and overall wrap-up status; all domain data stays in its existing source-of-truth tables. Extend the existing provider-agnostic AI client with an image-capable receipt-extraction path, but require human confirmation before any expense is saved.

**Tech Stack:** React + TypeScript, Wouter, Express, Drizzle ORM/PostgreSQL, Vitest + Testing Library, IndexedDB/offline manager queues, Google Cloud receipt object storage, existing Anthropic/OpenAI provider infrastructure.

## Global Constraints

- Lifecycle order is **Booked → Check in → At event → Check out → Wrap-up incomplete → Finished**.
- Worker deletion is permanent and requires a second explicit named confirmation action.
- A Leg Manager may permanently delete only a worker associated with their own leg; Admin may permanently delete any worker.
- Worker deletion removes worker-owned work history, ratings, manager notes, and worker-specific event links, but never unrelated bookings, trips, finance entries, events, or workers.
- Receipt capture must work from camera or existing image and preserve the original image.
- AI receipt extraction only proposes merchant, total, tax, and transaction date; the manager must review/edit before saving.
- Receipt extraction failure falls back to manual entry without losing the captured image.
- Offline expense sync occurs before receipt metadata/image upload; upload failure must not roll back the saved expense.
- Check-in/out ownership is booking + leg and must not depend on a Trip record.
- GPS is optional and may never block check-in or check-out.
- Check-out persists before wrap-up navigation occurs.
- Existing due-review behavior remains authoritative and must not be duplicated.
- Finish later preserves every already-saved wrap-up section.
- Cross-leg permissions are server-enforced.
- Do not introduce payroll/timeclock functionality or geofence requirements.

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
- Modify: `artifacts/adventure-zone/src/pages/ManagerCrewAdminPage.tsx`

**Interfaces:**
- Produce `workerBelongsToLeg(workerId: string, legId: string): Promise<boolean>`.
- Produce `deleteWorker(workerId: string): Promise<boolean>` that transactionally removes worker-owned child rows then the worker.
- Manager route: `DELETE /manager/crew/:workerId`.
- Admin route: `DELETE /manager-admin/crew/:workerId`.

- [ ] **Step 1: Write failing repository tests**

Create two workers and two legs. Attach work history and manager notes to worker A for leg A. Assert:

```ts
expect(await repo.workerBelongsToLeg(workerA.id, legA.id)).toBe(true);
expect(await repo.workerBelongsToLeg(workerA.id, legB.id)).toBe(false);
expect(await repo.deleteWorker(workerA.id)).toBe(true);
expect(await repo.getWorker(workerA.id)).toBeNull();
expect(await repo.getWorkHistory(historyA.id)).toBeNull();
expect(await repo.getManagerNote(noteA.id)).toBeNull();
expect(await repo.getWorker(workerB.id)).not.toBeNull();
```

- [ ] **Step 2: Run repository test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts
```
Expected: FAIL because worker-level ownership/delete methods do not exist.

- [ ] **Step 3: Implement repository ownership and transaction**

`workerBelongsToLeg` is true when a worker has any work-history or manager-note row owned by the supplied leg. `deleteWorker` deletes worker-owned work-history/ratings, manager notes, and worker-specific links in a database transaction, then deletes the worker. Do not delete bookings, trips, finance entries, or event rows.

- [ ] **Step 4: Write failing route permission tests**

`leg-manager-worker-delete.test.ts` covers own-leg manager → 204, unrelated-leg manager → 403, missing worker → 404, and admin → 204 regardless of leg.

- [ ] **Step 5: Implement manager/admin DELETE routes**

Manager flow:

```ts
if (!(await crew.workerBelongsToLeg(workerId, req.legManager!.legId))) {
  res.status(403).json({ error: "This worker is not associated with your leg" });
  return;
}
if (!(await crew.deleteWorker(workerId))) {
  res.status(404).json({ error: "Worker not found" });
  return;
}
res.status(204).end();
```

Admin route skips the leg-scope check but still returns 404 for a missing worker.

- [ ] **Step 6: Write destructive-confirmation UI tests**

On both manager and admin crew UI, first click on **Delete worker** must not call DELETE. It reveals a warning naming the worker. Only the second action, exactly `Delete ${worker.name}`, may issue the request.

- [ ] **Step 7: Implement two-step named confirmation**

Manager success navigates back to `/manager/crew`. Admin success removes the worker immediately from `ManagerCrewAdminPage` results. Disable the second button while deleting.

- [ ] **Step 8: Verify and commit Task 1**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts src/routes/leg-manager-worker-delete.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerWorkerPage.test.tsx
```

```bash
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
- Extend `AiCompletionClient` with optional `completeImage(input: { prompt: string; mimeType: string; base64: string }): Promise<string>` using the existing provider priority.
- Produce `extractReceiptFields()` returning `{ merchant, totalCents, taxCents, occurredAt }` with nullable fields.
- Manager route: `POST /manager/receipts/extract`, raw `image/*`, max 12 MB.

- [ ] **Step 1: Write failing extraction parser tests**

Cover valid JSON, fenced JSON, missing fields, malformed provider output, negative values, and a normal result:

```ts
expect(result).toEqual({
  merchant: "Pilot Travel Center",
  totalCents: 4876,
  taxCents: 276,
  occurredAt: "2026-08-17",
});
```

Malformed extraction returns all-null suggestions instead of aborting receipt capture.

- [ ] **Step 2: Run extraction tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/receipt-extraction.test.ts
```

- [ ] **Step 3: Add image completion to existing AI provider abstraction**

Anthropic: send an image block plus text prompt. OpenAI: send text plus a `data:<mime>;base64,...` image input. Keep current `complete()` unchanged for every existing AI caller.

- [ ] **Step 4: Implement receipt extraction**

Require JSON matching:

```json
{"merchant":null,"totalCents":null,"taxCents":null,"occurredAt":null}
```

Validate with Zod. Values are suggestions only. Do not save an expense in the extraction function.

- [ ] **Step 5: Implement `/manager/receipts/extract` manual-fallback behavior**

If no provider is configured or provider extraction fails, return 200 with `{ suggestions: null, unavailable: true }`. The photo remains usable for manual entry.

- [ ] **Step 6: Write Receipts-page tests**

Empty state must show both **+ Add receipt** and **Add expense manually**. Camera/photo selection calls extraction when online and fills editable merchant/total/tax/date fields. Extraction failure still opens the form with the image retained.

- [ ] **Step 7: Implement `ReceiptExpenseForm`**

Fields: merchant, total, tax, date, category, payment source, optional event/trip, notes. Receipt-first Save sequence is:
1. create expense with stable mutation ID
2. obtain expense ID
3. queue receipt metadata tied to expense ID
4. queue image blob
5. flush expense before receipt image when online

Manual expense uses the same form without an image.

- [ ] **Step 8: Verify existing offline semantics**

Reuse `manager-sync-queue` and `manager-blob-queue`. Receipt upload failure never rolls back an expense. Offline capture stores the image/draft until sync resumes.

- [ ] **Step 9: Verify and commit Task 2**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/receipt-extraction.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/receipt-expense-form.test.tsx src/pages/ManagerReceiptsPage.test.tsx
```

```bash
git commit -m "feat: add receipt-first expense capture"
```

---

### Task 3: Persist Booking + Leg Event Lifecycle

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: the next numbered SQL migration under `lib/db/migrations/`
- Create: `artifacts/api-server/src/features/leg-manager/event-lifecycle-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-lifecycle-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`

**Interfaces:**
- New `event_leg_lifecycle` table, unique `(booking_id, leg_id)`.
- Columns: ID, booking/leg IDs, check-in timestamp/coords/status, checkout timestamp/coords/status, wrap-up status, wrap-up finished timestamp, created/updated timestamps.
- Location status: `captured | unavailable | denied | error | not_requested`.
- Wrap-up status: `not_started | incomplete | finished`.
- Manager routes: `GET /manager/events/:bookingId/lifecycle`, `POST /manager/events/:bookingId/check-in`, `POST /manager/events/:bookingId/check-out`, `POST /manager/events/:bookingId/wrap-up/finish-later`, `POST /manager/events/:bookingId/wrap-up/finish`.
- Admin read route: `GET /manager-admin/events/lifecycle`.

- [ ] **Step 1: Write failing repository tests**

Test first check-in, duplicate check-in idempotency, checkout-before-checkin rejection, duplicate checkout idempotency, null GPS persistence, incomplete status, and finished status/timestamp.

- [ ] **Step 2: Run lifecycle repository tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-lifecycle-repository.test.ts
```

- [ ] **Step 3: Add schema + migration**

Foreign keys point to bookings and travel legs. No `trip_id` column. Unique index on booking+leg. Coordinates nullable; status strings non-null with safe defaults.

- [ ] **Step 4: Implement repository API**

```ts
getForBookingLeg(bookingId, legId)
checkIn(input)
checkOut(input)
markIncomplete(bookingId, legId)
markFinished(bookingId, legId)
listIncompleteForLeg(legId)
listAll()
```

Use transactions/upserts so mobile retries do not create duplicate check-ins/checkouts.

- [ ] **Step 5: Write route permission tests**

Every manager lifecycle mutation verifies the booking belongs to the authenticated leg using the existing leg-reference ownership check. Cross-leg booking → 403. Checkout before check-in → 409.

- [ ] **Step 6: Implement routes**

Checkout writes the lifecycle record and returns success before the client opens wrap-up. Finish/Finish later update only lifecycle workflow state; they do not copy review/crew/finance data.

- [ ] **Step 7: Add admin lifecycle overview route**

Expose timestamps, optional coords/statuses, booking/leg identity, and wrap-up status. Read-only in this release.

- [ ] **Step 8: Verify and commit Task 3**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-lifecycle-repository.test.ts
```

```bash
git commit -m "feat: persist manager event lifecycle"
```

---

### Task 4: One-Tap Check-In / Check-Out With Optional GPS

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
- `EventLifecycleAction` consumes booking ID + lifecycle and exposes exactly one urgent action.

- [ ] **Step 1: Write optional-location tests**

Mock geolocation for success, permission denied, unavailable, error, and missing browser API. All outcomes resolve; none throw solely because GPS failed.

- [ ] **Step 2: Implement optional-location helper**

Use a bounded geolocation timeout. Return `captured`, `denied`, `unavailable`, `error`, or `not_requested` with null coords when not captured.

- [ ] **Step 3: Write lifecycle-action tests**

Expected actions: no check-in → **Check in**; checked in/no checkout → **Check out**; checked out/incomplete → **Finish event wrap-up**; finished → no urgent lifecycle action. Pending request disables the action.

- [ ] **Step 4: Implement lifecycle actions**

Payload:

```ts
{
  occurredAt: new Date().toISOString(),
  latitude,
  longitude,
  locationStatus: status,
  clientMutationId: crypto.randomUUID(),
}
```

Successful checkout immediately navigates to `/manager/events/${bookingId}/wrap-up` only after the POST returns successfully.

- [ ] **Step 5: Wire Manager Home**

For the most relevant assigned event, show one lifecycle action near the top. Checked-out incomplete events surface **Finish event wrap-up** prominently.

- [ ] **Step 6: Wire Manager Schedule/event detail**

Display check-in/out timestamps and current state. Show **Wrap-up incomplete** after checkout until finish. Reuse the same lifecycle action component.

- [ ] **Step 7: Verify and commit Task 4**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/manager/event-location.test.ts src/components/manager/event-lifecycle-action.test.tsx src/pages/ManagerHomePage.test.tsx
```

```bash
git commit -m "feat: add event check in and check out"
```

---

### Task 5: Make Existing Event Wrap-Up Resumable and Lifecycle-Aware

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.tsx`
- Create or modify: `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerEventReviewPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerEventReviewPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
- Modify: `artifacts/api-server/src/features/leg-manager/event-review-repository.test.ts`

**Interfaces:**
- Existing review POST remains the only review record.
- Existing crew, finance/receipts, incidents, and calculators remain their own sources of truth.
- Lifecycle `wrap_up_status` stores only overall workflow state.

- [ ] **Step 1: Write failing wrap-up/resume tests**

Cover checkout opening the correct booking, already-saved section data remaining on return, Finish later marking incomplete and returning Home, Home/Schedule resume indicators, and Finish marking complete.

- [ ] **Step 2: Wrap existing sections in a checklist shell**

Compose existing event review, crew/work-history, finance/receipt, incidents/issues, and calculator sections. Do not create duplicate copies of their data.

- [ ] **Step 3: Implement Finish later**

POST `/manager/events/:bookingId/wrap-up/finish-later`, then return Home. Do not clear persisted section data.

- [ ] **Step 4: Implement Finish wrap-up**

Honor the existing required completion checks. Optional receipts/incidents/crew notes may remain empty. Only after requirements pass, POST `/manager/events/:bookingId/wrap-up/finish`.

- [ ] **Step 5: Reuse current event review**

Submitting review from wrap-up uses the existing review endpoint. Returning to wrap-up reads the existing review. Because due-review logic already excludes reviewed booking IDs, the same record satisfies the later review request automatically.

- [ ] **Step 6: Verify skipped review still becomes due**

Add service/repository test proving `wrap_up_status = incomplete` without a review does not suppress `listDueReviewsForManager()` once the event end date is due.

- [ ] **Step 7: Verify and commit Task 5**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerEventWrapUpPage.test.tsx src/pages/ManagerHomePage.test.tsx src/pages/ManagerEventReviewPage.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-review-repository.test.ts
```

```bash
git commit -m "feat: make event wrap up resumable"
```

---

### Task 6: Release Verification

**Files:**
- Modify production files only if verification exposes a regression.

**Interfaces:** No new interfaces; verify Tasks 1–5 together.

- [ ] **Step 1: Run focused API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts src/routes/leg-manager-worker-delete.test.ts src/features/leg-manager/receipt-extraction.test.ts src/features/leg-manager/event-lifecycle-repository.test.ts src/features/leg-manager/event-review-repository.test.ts
```

- [ ] **Step 2: Run focused frontend tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerWorkerPage.test.tsx src/components/manager/receipt-expense-form.test.tsx src/pages/ManagerReceiptsPage.test.tsx src/features/manager/event-location.test.ts src/components/manager/event-lifecycle-action.test.tsx src/pages/ManagerHomePage.test.tsx src/pages/ManagerEventWrapUpPage.test.tsx src/pages/ManagerEventReviewPage.test.tsx
```

- [ ] **Step 3: Run typecheck/build**

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

- [ ] **Step 4: Manual mobile acceptance pass**

Verify:
1. own-leg worker requires named second confirmation before permanent deletion
2. unrelated worker cannot be deleted by manager; Admin can delete any worker
3. Receipts empty state offers camera receipt and manual expense
4. scan suggestions are editable and extraction failure still keeps photo/manual entry
5. check-in succeeds after GPS denial
6. check-out persists and opens wrap-up
7. Finish later returns Home with a resume action
8. Schedule shows **Wrap-up incomplete**
9. returning preserves already-saved review/crew/money/incident data
10. Finish removes the urgent lifecycle action

- [ ] **Step 5: Commit any verification-only corrections**

```bash
git commit -m "test: verify manager event lifecycle release"
```
