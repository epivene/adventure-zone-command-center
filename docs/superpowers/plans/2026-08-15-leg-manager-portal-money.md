# Leg Manager Portal Money and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add leg-scoped event income, expenses, receipts, cash reconciliation, owner/manager settlement, mileage, RV park, food, and maintenance tracking on top of the Release 1 manager portal/offline-sync foundation.

**Architecture:** Use append-oriented ledger records as the source of financial truth and derive totals on read. Every manager-created row carries `legId`, optional `tripId`/`tripSegmentId`/`bookingId`, `clientMutationId`, timestamps, and revision metadata. Receipt images attach to expense records but upload independently so an image failure cannot lose the expense. Manual Square/card totals use stable fields that a future Square integration can populate without changing the accounting model.

**Tech Stack:** TypeScript, Express, Drizzle/PostgreSQL, React, Vitest, Testing Library, existing manager IndexedDB queue.

## Global Constraints

- Release 1 must already be merged.
- Financial records are server-scoped to the authenticated leg.
- Summary numbers are derived; managers do not directly edit settlement totals.
- Payment source is one of `adventure_zone_cash`, `adventure_zone_debit`, `personal`.
- Personal approved expenses increase “Adventure Zone owes manager.”
- Company debit expenses do not create personal reimbursement.
- Cash advances and cash returned/turned-in flow through the cash ledger.
- Manual Square numbers are supported now; no live Square API in this release.
- Receipt image capture works offline; OCR is not required in this release.

---

### Task 1: Add operational finance schema and typed domain model

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/006_leg_manager_finance.sql`
- Create: `artifacts/api-server/src/features/leg-manager/finance-types.ts`
- Create: `artifacts/api-server/src/features/leg-manager/finance-math.ts`
- Create: `artifacts/api-server/src/features/leg-manager/finance-math.test.ts`

**Interfaces:**
- Tables: `leg_event_income`, `leg_expenses`, `leg_cash_entries`, `leg_mileage_entries`, `leg_receipts`.
- Produces `calculateSettlement()` and `calculateCashPosition()` pure functions.

- [ ] **Step 1: Write failing ledger math tests**

```ts
expect(calculateSettlement([
  { kind: "personal_expense", amountCents: 5000 },
  { kind: "manager_repaid", amountCents: 2000 },
])).toEqual({ ownerOwesManagerCents: 3000, managerOwesOwnerCents: 0, netCents: 3000 });
```

Also test company debit expense = zero settlement effect and owner cash advance = manager owes owner until accounted for.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/finance-math.test.ts
```

- [ ] **Step 3: Add schema**

Use integer cents for currency. Core expense fields: `category`, `merchant`, `amountCents`, `taxCents`, `paymentSource`, `occurredAt`, `notes`, optional booking/trip/segment links, `employeeNote`, `clientMutationId`, `revision`.

Income fields: `cashCents`, `squareCents`, `otherCents`, optional `otherLabel`, booking/trip links. Do not store a mutable `totalCents`; derive it.

Cash entries use explicit kinds: `event_cash_collected`, `expense_paid_cash`, `advance_received`, `cash_turned_in`, `cash_returned`, `adjustment`.

- [ ] **Step 4: Implement pure settlement/cash calculations**

Return signed/net values plus human-readable direction derived by the API/UI.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/finance-math.test.ts
git add lib/db/src/schema/index.ts lib/db/migrations/006_leg_manager_finance.sql artifacts/api-server/src/features/leg-manager/finance-types.ts artifacts/api-server/src/features/leg-manager/finance-math.ts artifacts/api-server/src/features/leg-manager/finance-math.test.ts
git commit -m "feat: add leg finance ledger model"
```

---

### Task 2: Add leg-scoped finance repository and idempotent mutation endpoints

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/finance-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/finance-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`

**Interfaces:**
- Manager: `GET /manager/money/summary?tripId=`
- Manager: `POST /manager/income`
- Manager: `POST /manager/expenses`
- Manager: `POST /manager/cash`
- Manager: `POST /manager/mileage`
- Owner: `GET /manager-admin/legs/:legId/money/summary`
- Owner: `GET /manager-admin/money/summary` for cross-leg totals.

- [ ] **Step 1: Write failing scope/idempotency tests**

Post the same expense `clientMutationId` twice and assert one row. Attempt a Leg A expense with Leg B trip/booking ID and assert rejection.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/finance-repository.test.ts
```

- [ ] **Step 3: Implement repository validation**

Every optional foreign ID must be proven to belong to the authenticated leg before insert. Summaries group by event, segment, trip, category, and payment source.

- [ ] **Step 4: Add owner aggregate reads**

Owner combined totals may aggregate all active/archived legs by date/trip, but manager endpoints never accept arbitrary `legId` as authority; they use `req.legManager.legId`.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/finance-repository.test.ts
git add artifacts/api-server/src/features/leg-manager/finance-repository.ts artifacts/api-server/src/features/leg-manager/finance-repository.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/leg-manager-admin.ts
git commit -m "feat: add leg scoped finance APIs"
```

---

### Task 3: Build manager Money screen with event/place income and manual Square fields

**Files:**
- Create: `artifacts/adventure-zone/src/pages/ManagerMoneyPage.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/event-income-form.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/settlement-summary.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerMoneyPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`

**Interfaces:**
- Uses Release 1 `queueManagerMutation()` for writes.
- Square/card entry remains manual and uses `squareCents`.

- [ ] **Step 1: Write failing UI tests**

Test event selector, cash/Square/other fields, offline save indicator, and settlement direction copy.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerMoneyPage.test.tsx
```

- [ ] **Step 3: Implement Money page**

Top cards: Event/place income, expenses, cash on hand, settlement. Show `Adventure Zone owes you $X`, `You owe Adventure Zone $X`, or `Settled` based on server-derived result.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerMoneyPage.test.tsx
git add artifacts/adventure-zone/src/pages/ManagerMoneyPage.tsx artifacts/adventure-zone/src/components/manager/event-income-form.tsx artifacts/adventure-zone/src/components/manager/settlement-summary.tsx artifacts/adventure-zone/src/pages/ManagerMoneyPage.test.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/manager/manager-shell.tsx
git commit -m "feat: add manager money dashboard"
```

---

### Task 4: Add expense entry, payment source, and cash-flow forms

**Files:**
- Create: `artifacts/adventure-zone/src/components/manager/expense-form.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/cash-entry-form.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/expense-form.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerMoneyPage.tsx`

**Interfaces:**
- Expense categories: fuel, food, rv_park, vehicle_maintenance, trailer_maintenance, supplies, employee_related, other.
- Payment sources exactly match server enum.

- [ ] **Step 1: Write failing form tests**

Assert choosing Personal shows reimbursement explanation, Debit does not, and cash expense affects cash-on-hand explanation.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/expense-form.test.tsx
```

- [ ] **Step 3: Implement forms through offline queue**

Require amount/category/payment source; event/trip/segment selection is optional but encouraged from route context. Allow `employeeNote` for “employee made this purchase” without employee login.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/expense-form.test.tsx
git add artifacts/adventure-zone/src/components/manager/expense-form.tsx artifacts/adventure-zone/src/components/manager/cash-entry-form.tsx artifacts/adventure-zone/src/components/manager/expense-form.test.tsx artifacts/adventure-zone/src/pages/ManagerMoneyPage.tsx
git commit -m "feat: add manager expense and cash entry"
```

---

### Task 5: Add receipt photo capture/upload with independent sync

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/receipt-service.ts`
- Create: `artifacts/api-server/src/features/leg-manager/receipt-service.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Create: `artifacts/adventure-zone/src/pages/ManagerReceiptsPage.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/receipt-capture.tsx`
- Create: `artifacts/adventure-zone/src/lib/manager-blob-queue.ts`
- Create: `artifacts/adventure-zone/src/lib/manager-blob-queue.test.ts`

**Interfaces:**
- Receipt metadata row survives even if image upload fails.
- Manager: `POST /manager/receipts` metadata; `PUT /manager/receipts/:id/image` image upload.

- [ ] **Step 1: Write failing metadata/image failure tests**

Test that a failed image upload leaves the expense + receipt metadata intact and marked `image_pending`/`image_failed` rather than deleting it.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/receipt-service.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/manager-blob-queue.test.ts
```

- [ ] **Step 3: Implement camera input and local blob queue**

Use `<input type="file" accept="image/*" capture="environment">`. Store pending blobs in IndexedDB under the authenticated leg and receipt ID; upload after metadata sync.

- [ ] **Step 4: Add missing-receipt indicators**

Expense summaries expose `receiptStatus` and the UI shows the count of expenses expected to have proof but currently missing it.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/receipt-service.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/manager-blob-queue.test.ts
git add artifacts/api-server/src/features/leg-manager/receipt-service.ts artifacts/api-server/src/features/leg-manager/receipt-service.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/adventure-zone/src/pages/ManagerReceiptsPage.tsx artifacts/adventure-zone/src/components/manager/receipt-capture.tsx artifacts/adventure-zone/src/lib/manager-blob-queue.ts artifacts/adventure-zone/src/lib/manager-blob-queue.test.ts
git commit -m "feat: add offline receipt capture"
```

---

### Task 6: Add route-segment totals, mileage, RV park, food, and maintenance details

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/operations-rollup.ts`
- Create: `artifacts/api-server/src/features/leg-manager/operations-rollup.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Create: `artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/mileage-form.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/maintenance-form.tsx`

**Interfaces:**
- `GET /manager/operations/segments?tripId=` returns segment miles plus categorized expense totals.
- RV park/food/maintenance remain expense categories with optional specialized detail JSON/columns; they are not separate accounting ledgers.

- [ ] **Step 1: Write failing rollup tests**

Seed two trip segments with fuel/food/RV expenses and mileage; assert each segment and trip total exactly once.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/operations-rollup.test.ts
```

- [ ] **Step 3: Implement rollups + specialized forms**

Mileage supports odometer start/end or entered miles. Maintenance captures vehicle/trailer label, issue, provider, notes, and links to the common expense/receipt record.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/operations-rollup.test.ts
git add artifacts/api-server/src/features/leg-manager/operations-rollup.ts artifacts/api-server/src/features/leg-manager/operations-rollup.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx artifacts/adventure-zone/src/components/manager/mileage-form.tsx artifacts/adventure-zone/src/components/manager/maintenance-form.tsx
git commit -m "feat: add trip operations and mileage rollups"
```

---

### Task 7: Add owner cross-leg finance inspection

**Files:**
- Create: `artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`

**Interfaces:**
- Consumes owner aggregate endpoints from Task 2.

- [ ] **Step 1: Write failing admin view tests**

Assert active/archived leg filtering, combined totals, and opening one leg's ledger.

- [ ] **Step 2: Implement the admin page and run tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerFinanceAdminPage.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.tsx artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.test.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/pages/RoutesPage.tsx
git commit -m "feat: add admin leg finance view"
```

---

### Task 8: Release 2 verification

- [ ] **Step 1: Run all manager finance API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/finance-math.test.ts src/features/leg-manager/finance-repository.test.ts src/features/leg-manager/receipt-service.test.ts src/features/leg-manager/operations-rollup.test.ts
```

- [ ] **Step 2: Run manager money/receipt UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerMoneyPage.test.tsx src/components/manager/expense-form.test.tsx src/lib/manager-blob-queue.test.ts src/pages/ManagerFinanceAdminPage.test.tsx
```

- [ ] **Step 3: Typecheck/build**

```bash
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```
Record any pre-existing API typecheck failures precisely and use a scoped manager config only when necessary; do not hide new errors.

- [ ] **Step 4: Verify one complete offline accounting scenario**

Offline: record event cash + Square total, personal fuel expense + receipt, company debit food expense, mileage, and cash turned in. Reconnect and assert each `clientMutationId` exists once, receipt image eventually attaches, route/trip totals reconcile, and settlement direction matches ledger math.
