# Finance Reporting Release 1 — Evidence & Admin Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins inspect every manager-submitted expense together with its receipt image/details, correct mistakes with an audit trail, keep General / Unassigned records visible, and show event-linked expenses directly inside Event Wrap-up.

**Architecture:** Extend the existing leg-manager finance tables instead of creating report copies. Add assignment provenance plus an append-only expense audit table, expose one normalized admin expense-record contract from the API, enrich receipt images with short-lived signed URLs using the existing object-storage abstraction, then reuse the same normalized records in Finance and Event Wrap-up.

**Tech Stack:** TypeScript, React, Express, Drizzle ORM, PostgreSQL, Google Cloud Storage, Vitest, Testing Library, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-17-finance-reporting-system-design.md`

## Global Constraints

- One expense remains one source row; reassignment never clones an expense or receipt.
- Do not start automatic between-event travel assignment in Release 1.
- Existing manager receipt/expense creation and offline sync must remain compatible.
- Receipt signed-URL failures must degrade to `imageUrl: null` and a warning/status, never blank the entire finance/event payload.
- Existing event source fingerprints already include `leg_expenses.updated_at` and `leg_receipts.updated_at`; admin edits must update `leg_expenses.updated_at` so reviewed Event Wrap-ups naturally become `sourceDataChanged`.
- Existing explicit booking/trip/trip-segment references are preserved during migration.
- Existing records with any booking/trip/trip-segment reference backfill `assignment_source = 'legacy'`; records with none backfill `assignment_source = 'unassigned'`.
- Admin audit entries are append-only through normal application flows.
- GitHub Actions with zero executed steps are not a passing CI result.

---

## File structure

### Database

- Create: `lib/db/migrations/044_finance_admin_evidence.sql` — add assignment metadata and `leg_finance_audit`.
- Modify: `lib/db/src/migrations.ts` — register migration 044 with a marker.
- Modify: `lib/db/src/schema/index.ts` — Drizzle schema for new columns/table.
- Test: `lib/db/src/migrations.test.ts` — migration registration/marker coverage if this file exists on current main; otherwise add focused migration assertions beside the existing migration tests used by this package.

### API finance model

- Create: `artifacts/api-server/src/features/leg-manager/admin-finance-types.ts` — normalized response/update types.
- Create: `artifacts/api-server/src/features/leg-manager/admin-finance-record-service.ts` — receipt enrichment and normalization.
- Create: `artifacts/api-server/src/features/leg-manager/admin-finance-record-service.test.ts`.
- Modify: `artifacts/api-server/src/features/leg-manager/finance-repository.ts` — admin list/get/update/audit queries while retaining existing summary methods.
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts` — list/detail/update admin finance endpoints.
- Test: `artifacts/api-server/src/routes/leg-manager-admin.finance-records.test.ts`.

### Admin Finance UI

- Create: `artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.tsx` — expandable receipt/details/edit card.
- Create: `artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.test.tsx`.
- Modify: `artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.tsx` — filters + individual records below totals.
- Modify: `artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.test.tsx`.

### Event Wrap-up

- Modify: `artifacts/api-server/src/features/leg-manager/event-wrap-up-source.ts` — expose normalized evidence records while keeping calculations unchanged.
- Test: `artifacts/api-server/src/features/leg-manager/event-wrap-up-source.finance-evidence.test.ts`.
- Create: `artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.tsx` — read/edit reuse wrapper for event-linked records.
- Create: `artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.test.tsx`.
- Modify: `artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.tsx`.
- Modify: `artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.test.tsx`.

---

### Task 1: Add finance assignment provenance and audit schema

**Files:**
- Create: `lib/db/migrations/044_finance_admin_evidence.sql`
- Modify: `lib/db/src/migrations.ts`
- Modify: `lib/db/src/schema/index.ts`
- Test: `lib/db/src/migrations.test.ts`

**Interfaces:**
- Produces DB columns on `leg_expenses`: `assignment_source`, `assignment_reason`, `assignment_updated_at`.
- Produces table `leg_finance_audit` with expense before/after snapshots.
- Later tasks consume Drizzle exports `legFinanceAudit` and the new `legExpenses` fields.

- [ ] **Step 1: Write a failing migration registration test**

Add a test asserting migration loading includes `044_finance_admin_evidence.sql` and its marker checks both the new expense column and audit table.

```ts
it("registers finance admin evidence migration", async () => {
  const migrations = await loadActReviewMigrations();
  const migration = migrations.find((row) => row.name === "044_finance_admin_evidence.sql");
  expect(migration).toBeDefined();
  expect(migration?.markerSql).toContain("assignment_source");
  expect(migration?.markerSql).toContain("leg_finance_audit");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @workspace/db test -- migrations.test.ts
```

Expected: FAIL because migration 044 is not registered.

- [ ] **Step 3: Add migration SQL**

Create `lib/db/migrations/044_finance_admin_evidence.sql` with the following behavior:

```sql
ALTER TABLE leg_expenses
  ADD COLUMN IF NOT EXISTS assignment_source text,
  ADD COLUMN IF NOT EXISTS assignment_reason text,
  ADD COLUMN IF NOT EXISTS assignment_updated_at timestamptz;

UPDATE leg_expenses
SET assignment_source = CASE
  WHEN booking_id IS NOT NULL OR trip_id IS NOT NULL OR trip_segment_id IS NOT NULL THEN 'legacy'
  ELSE 'unassigned'
END,
assignment_updated_at = COALESCE(updated_at, created_at, now())
WHERE assignment_source IS NULL;

ALTER TABLE leg_expenses
  ALTER COLUMN assignment_source SET DEFAULT 'unassigned',
  ALTER COLUMN assignment_source SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE leg_expenses
    ADD CONSTRAINT leg_expenses_assignment_source_valid
    CHECK (assignment_source IN ('legacy','explicit','automatic','admin','unassigned'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS leg_finance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  actor_id text,
  actor_label text NOT NULL DEFAULT 'Authenticated admin',
  change_reason text,
  previous_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leg_finance_audit_record_type_valid CHECK (record_type IN ('expense'))
);

CREATE INDEX IF NOT EXISTS leg_finance_audit_record_idx
  ON leg_finance_audit(record_type, record_id, changed_at DESC);
```

- [ ] **Step 4: Register migration marker**

Append to `migrationFiles` in `lib/db/src/migrations.ts`:

```ts
{
  name: "044_finance_admin_evidence.sql",
  markerSql: `SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'leg_expenses'
        AND column_name = 'assignment_source'
    )
    AND to_regclass(current_schema() || '.leg_finance_audit') IS NOT NULL
    AS ready`,
},
```

- [ ] **Step 5: Update Drizzle schema**

Extend `legExpenses` with:

```ts
assignmentSource: text("assignment_source")
  .$type<"legacy" | "explicit" | "automatic" | "admin" | "unassigned">()
  .default("unassigned")
  .notNull(),
assignmentReason: text("assignment_reason"),
assignmentUpdatedAt: timestamp("assignment_updated_at", { withTimezone: true }),
```

Add:

```ts
export const legFinanceAudit = pgTable("leg_finance_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  recordType: text("record_type").$type<"expense">().notNull(),
  recordId: uuid("record_id").notNull(),
  actorId: text("actor_id"),
  actorLabel: text("actor_label").default("Authenticated admin").notNull(),
  changeReason: text("change_reason"),
  previousValues: jsonb("previous_values").$type<Record<string, unknown>>().notNull(),
  newValues: jsonb("new_values").$type<Record<string, unknown>>().notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("leg_finance_audit_record_idx").on(table.recordType, table.recordId, table.changedAt),
]);
```

- [ ] **Step 6: Run DB tests/typecheck**

```bash
pnpm --filter @workspace/db test -- migrations.test.ts
pnpm --filter @workspace/db typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/migrations/044_finance_admin_evidence.sql lib/db/src/migrations.ts lib/db/src/schema/index.ts lib/db/src/migrations.test.ts
git commit -m "feat: add finance evidence audit schema"
```

---

### Task 2: Define normalized admin expense records and repository queries

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/admin-finance-types.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/finance-repository.ts`
- Test: `artifacts/api-server/src/features/leg-manager/finance-repository.admin.test.ts`

**Interfaces:**
- Produces `AdminExpenseRow`, `AdminExpenseFilters`, `AdminExpenseUpdateInput`, `FinanceAuditView`.
- Produces repository methods `listAdminExpenses`, `getAdminExpense`, `updateAdminExpense`, `listExpenseAudit`.

- [ ] **Step 1: Define the response/update types**

Create `admin-finance-types.ts`:

```ts
export const financeAssignmentSources = ["legacy", "explicit", "automatic", "admin", "unassigned"] as const;
export type FinanceAssignmentSource = typeof financeAssignmentSources[number];

export type AdminExpenseFilters = {
  legId?: string | null;
  bookingId?: string | null;
  category?: string | null;
  paymentSource?: string | null;
  assignmentSource?: FinanceAssignmentSource | null;
  receiptStatus?: "attached" | "missing" | "incomplete" | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
};

export type AdminExpenseUpdateInput = {
  merchant?: string | null;
  category?: string;
  amountCents?: number;
  taxCents?: number;
  paymentSource?: string;
  occurredAt?: Date;
  notes?: string | null;
  bookingId?: string | null;
  tripId?: string | null;
  tripSegmentId?: string | null;
  changeReason?: string | null;
};

export type FinanceAuditView = {
  id: string;
  actorId: string | null;
  actorLabel: string;
  changeReason: string | null;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedAt: Date;
};
```

- [ ] **Step 2: Write failing repository tests**

Cover:

```ts
it("lists general and event-linked expenses instead of only totals", async () => {
  const rows = await repo.listAdminExpenses({});
  expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([eventExpenseId, generalExpenseId]));
});

it("updates the same expense and appends audit history", async () => {
  const before = await repo.getAdminExpense(expenseId);
  await repo.updateAdminExpense(expenseId, { category: "vehicle_maintenance" }, {
    actorId: "admin-user-1",
    actorLabel: "Admin",
  });
  const after = await repo.getAdminExpense(expenseId);
  const audit = await repo.listExpenseAudit(expenseId);
  expect(after?.id).toBe(before?.id);
  expect(after?.category).toBe("vehicle_maintenance");
  expect(audit[0]?.previousValues.category).toBe(before?.category);
  expect(audit[0]?.newValues.category).toBe("vehicle_maintenance");
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @workspace/api-server test -- finance-repository.admin.test.ts
```

Expected: FAIL because methods do not exist.

- [ ] **Step 4: Implement list/get queries**

In `finance-repository.ts`, join `leg_expenses` to `travel_legs`, `bookings`, and `leg_receipts`. Return one row per expense, selecting the receipt record if present. Preserve all existing `summary()` behavior.

Add:

```ts
async listAdminExpenses(filters: AdminExpenseFilters): Promise<AdminExpenseRow[]>;
async getAdminExpense(id: string): Promise<AdminExpenseRow | null>;
async listExpenseAudit(id: string): Promise<FinanceAuditView[]>;
```

The list must include expenses with no booking/trip/segment references.

- [ ] **Step 5: Implement transactional admin update + audit**

`updateAdminExpense` must:

1. load the existing expense,
2. validate any changed booking/trip/segment still belongs to the same leg using `refsBelongToLeg`,
3. update only supplied editable fields,
4. set `assignmentSource = 'admin'` when any assignment field is supplied,
5. set `assignmentReason = changeReason ?? 'Admin reassignment'` for assignment changes,
6. set `assignmentUpdatedAt` and `updatedAt` to now,
7. insert one `leg_finance_audit` row containing changed-field before/after snapshots,
8. return the updated same expense ID.

Expose actor input:

```ts
type FinanceAuditActor = { actorId: string | null; actorLabel: string };
```

- [ ] **Step 6: Run tests/typecheck**

```bash
pnpm --filter @workspace/api-server test -- finance-repository.admin.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/admin-finance-types.ts artifacts/api-server/src/features/leg-manager/finance-repository.ts artifacts/api-server/src/features/leg-manager/finance-repository.admin.test.ts
git commit -m "feat: add admin expense record repository"
```

---

### Task 3: Enrich receipt evidence without making records brittle

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/admin-finance-record-service.ts`
- Test: `artifacts/api-server/src/features/leg-manager/admin-finance-record-service.test.ts`

**Interfaces:**
- Consumes repository `AdminExpenseRow` records and `LegManagerObjectStorage.getSignedReadUrl`.
- Produces `AdminExpenseRecord` used by API/UI/event wrap-up.

- [ ] **Step 1: Define normalized record contract in the service**

```ts
export type AdminExpenseRecord = {
  id: string;
  legId: string;
  legName: string;
  bookingId: string | null;
  bookingName: string | null;
  tripId: string | null;
  tripSegmentId: string | null;
  assignmentSource: FinanceAssignmentSource;
  assignmentReason: string | null;
  merchant: string | null;
  category: string;
  amountCents: number;
  taxCents: number;
  totalCents: number;
  paymentSource: string;
  occurredAt: string;
  notes: string | null;
  submittedAt: string;
  receipt: null | {
    id: string;
    imageStatus: string;
    imageUrl: string | null;
  };
  hasCorrections: boolean;
  audit: FinanceAuditView[];
};
```

- [ ] **Step 2: Write RED tests for graceful image enrichment**

```ts
it("adds a signed receipt URL when image upload is complete", async () => {
  storage.getSignedReadUrl.mockResolvedValue("https://signed.example/receipt");
  const [record] = await service.enrich([uploadedReceiptRow]);
  expect(record.receipt?.imageUrl).toBe("https://signed.example/receipt");
});

it("keeps expense details when signed URL generation fails", async () => {
  storage.getSignedReadUrl.mockRejectedValue(new Error("bucket unavailable"));
  const [record] = await service.enrich([uploadedReceiptRow]);
  expect(record.id).toBe(uploadedReceiptRow.id);
  expect(record.receipt?.imageUrl).toBeNull();
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @workspace/api-server test -- admin-finance-record-service.test.ts
```

- [ ] **Step 4: Implement enrichment**

Only call `getSignedReadUrl` when receipt `imageStatus === "image_uploaded"` and an object key exists. Use `Promise.allSettled`/per-record `try/catch` so one bad receipt cannot fail the list.

- [ ] **Step 5: Run GREEN + typecheck**

```bash
pnpm --filter @workspace/api-server test -- admin-finance-record-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/admin-finance-record-service.ts artifacts/api-server/src/features/leg-manager/admin-finance-record-service.test.ts
git commit -m "feat: enrich admin expense receipt evidence"
```

---

### Task 4: Add admin finance record API endpoints

**Files:**
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Test: `artifacts/api-server/src/routes/leg-manager-admin.finance-records.test.ts`

**Interfaces:**
- Produces `GET /manager-admin/finance/expenses`.
- Produces `GET /manager-admin/finance/expenses/:expenseId`.
- Produces `PATCH /manager-admin/finance/expenses/:expenseId`.

- [ ] **Step 1: Write failing route tests**

Cover list, detail, invalid UUID, update, outside-leg assignment rejection, and signed-URL failure fallback.

Example contract:

```ts
expect(response.body.expenses[0]).toMatchObject({
  id: expenseId,
  totalCents: 1299,
  receipt: { imageStatus: "image_uploaded" },
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- leg-manager-admin.finance-records.test.ts
```

- [ ] **Step 3: Add Zod filters/update schemas**

Use the existing finance category/payment values accepted by manager submission. Validate UUID assignment fields as nullable UUIDs and currency fields as non-negative integers.

- [ ] **Step 4: Implement list/detail routes**

List route accepts query filters:

```txt
legId
bookingId
category
paymentSource
assignmentSource
dateFrom
dateTo
receiptStatus
```

Return:

```ts
{ expenses: AdminExpenseRecord[], warning?: "receipt_images_unavailable" }
```

- [ ] **Step 5: Implement PATCH route**

Read the authenticated admin actor from the same request authentication context used by the app's existing admin middleware. Pass both stable actor identifier when available and display label to `updateAdminExpense`; if the auth layer exposes no display name, use the stable authenticated user ID as `actorLabel` rather than inventing a person name.

Return `{ expense: AdminExpenseRecord }` after re-enrichment.

- [ ] **Step 6: Verify API tests/typecheck**

```bash
pnpm --filter @workspace/api-server test -- leg-manager-admin.finance-records.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/routes/leg-manager-admin.finance-records.test.ts
git commit -m "feat: expose admin expense evidence API"
```

---

### Task 5: Expand Finance overview into an evidence workspace

**Files:**
- Create: `artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.tsx`
- Test: `artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.test.tsx`

**Interfaces:**
- Consumes `GET/PATCH /manager-admin/finance/expenses` contract.
- Produces expandable admin record UI shared conceptually with Event Wrap-up.

- [ ] **Step 1: Write failing component tests**

Verify a record card renders merchant/date/total/category/payment source, General / Unassigned scope, receipt thumbnail/open action, and edit controls.

```tsx
expect(screen.getByText("General / Unassigned")).toBeInTheDocument();
expect(screen.getByRole("link", { name: /open receipt/i })).toHaveAttribute("href", signedUrl);
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager-finance/admin-expense-record.test.tsx
```

- [ ] **Step 3: Implement `AdminExpenseRecordCard`**

Collapsed view:

- merchant or `Unknown merchant`
- date
- total
- category
- assignment label
- receipt status

Expanded view:

- amount + tax
- payment source
- leg
- event assignment
- notes
- receipt image thumbnail + `Open receipt`
- original submission timestamp
- correction history
- `Edit` button

Edit form fields:

- merchant
- category
- amount
- tax
- payment source
- occurred date/time
- notes
- event/booking UUID assignment control supplied by page data
- change reason

- [ ] **Step 4: Add Finance page record loading independently from totals**

Do not use one all-or-nothing `Promise.all` that can blank totals and records together. Load summary and expense records independently with their own errors/retry controls.

- [ ] **Step 5: Add filters**

At minimum in Release 1:

- leg
- category
- payment source
- scope: All / Event / General-Unassigned
- receipt: All / Attached / Missing-Incomplete
- date from/to

Keep existing archived-leg behavior.

- [ ] **Step 6: Wire save behavior**

After PATCH succeeds, replace only the edited record in local state and refresh summary totals so corrected amounts immediately reconcile.

- [ ] **Step 7: Run focused frontend tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager-finance/admin-expense-record.test.tsx src/pages/ManagerFinanceAdminPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.tsx artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.test.tsx artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.tsx artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.test.tsx
git commit -m "feat: show receipt evidence in admin finance"
```

---

### Task 6: Put event-linked receipt evidence directly in Event Wrap-up

**Files:**
- Modify: `artifacts/api-server/src/features/leg-manager/event-wrap-up-source.ts`
- Test: `artifacts/api-server/src/features/leg-manager/event-wrap-up-source.finance-evidence.test.ts`
- Create: `artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.tsx`
- Test: `artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.test.tsx`

**Interfaces:**
- Event payload gains `finance.expenseRecords: AdminExpenseRecord[]`.
- Existing `finance.directExpenses`, calculations, and `missingReceiptCount` remain compatible.

- [ ] **Step 1: Write RED backend test**

Assert an event expense returns its entered details plus receipt evidence while a different event/general expense does not.

```ts
expect(payload.finance.expenseRecords.map((row) => row.id)).toEqual([eventExpenseId]);
expect(payload.finance.expenseRecords[0]?.receipt?.imageUrl).toBe(signedUrl);
```

- [ ] **Step 2: Run RED backend test**

```bash
pnpm --filter @workspace/api-server test -- event-wrap-up-source.finance-evidence.test.ts
```

- [ ] **Step 3: Reuse the admin record service from Event Wrap-up**

Do not duplicate receipt-signing logic in `event-wrap-up-source.ts`. Query normalized admin rows filtered by `bookingId`, enrich them through `AdminFinanceRecordService`, and attach the records to `finance.expenseRecords`.

If image enrichment fails, keep calculations and expense records with `imageUrl: null`.

- [ ] **Step 4: Preserve source-change behavior**

Do not add a second fingerprint system. `sourceFingerprint()` already includes `leg_expenses.updated_at` and `leg_receipts.updated_at`; Task 2 updates `updatedAt`, so reviewed wrap-ups naturally report `sourceDataChanged` after an admin correction.

Add/extend a test proving a finance update changes the fingerprint.

- [ ] **Step 5: Write RED frontend Event Wrap-up test**

```tsx
expect(screen.getByRole("heading", { name: "Expenses & receipts" })).toBeInTheDocument();
expect(screen.getByText("Fuel Stop")).toBeInTheDocument();
expect(screen.getByRole("link", { name: /open receipt/i })).toBeInTheDocument();
```

- [ ] **Step 6: Implement `EventExpenseEvidence`**

Render all event-linked records directly below the current Profitability summary. Reuse the same visual information hierarchy as `AdminExpenseRecordCard`; editing may reuse the card or an extracted shared edit form rather than maintaining separate field behavior.

- [ ] **Step 7: Run backend/frontend tests + typechecks**

```bash
pnpm --filter @workspace/api-server test -- event-wrap-up-source.finance-evidence.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager-finance/event-expense-evidence.test.tsx src/pages/EventWrapUpAdminPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/event-wrap-up-source.ts artifacts/api-server/src/features/leg-manager/event-wrap-up-source.finance-evidence.test.ts artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.tsx artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.test.tsx artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.tsx artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.test.tsx
git commit -m "feat: show event receipt evidence in wrap up"
```

---

### Task 7: Backward-compatibility and regression gate

**Files:**
- Modify existing focused tests only where the new fields intentionally extend payloads.
- No production feature expansion beyond Release 1.

**Interfaces:**
- Confirms manager submission, Finance summary, and Event Wrap-up calculations remain compatible.

- [ ] **Step 1: Run existing manager money/receipt tests**

```bash
pnpm --filter @workspace/api-server test -- finance-repository.test.ts leg-manager.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerMoneyPage.test.tsx src/pages/ManagerReceiptsPage.test.tsx
```

If exact filenames have moved on current main, use Vitest's file listing to select the existing tests covering `/manager/expenses`, `/manager/receipts`, image upload, and summary calculations; do not delete coverage to make the suite pass.

- [ ] **Step 2: Add explicit regression for one-source-row reassignment**

A test must assert changing `bookingId` or clearing it:

- preserves expense ID,
- preserves receipt ID/link,
- adds an audit entry,
- changes report scope only,
- does not insert another `leg_expenses` row.

- [ ] **Step 3: Run Release 1 focused suite**

```bash
pnpm --filter @workspace/api-server test -- \
  finance-repository.admin.test.ts \
  admin-finance-record-service.test.ts \
  leg-manager-admin.finance-records.test.ts \
  event-wrap-up-source.finance-evidence.test.ts

pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/manager-finance/admin-expense-record.test.tsx \
  src/components/manager-finance/event-expense-evidence.test.tsx \
  src/pages/ManagerFinanceAdminPage.test.tsx \
  src/pages/EventWrapUpAdminPage.test.tsx
```

Expected: 0 failures.

- [ ] **Step 4: Run complete typechecks/builds**

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 5: Manual acceptance pass**

In a local/dev environment with a seeded uploaded receipt:

1. Open `/manager-finance`.
2. Confirm leg totals still render.
3. Open the manager's individual expense.
4. Confirm entered details and receipt photo appear together.
5. Edit category/amount/notes and save.
6. Confirm audit history shows the correction.
7. Confirm receipt photo remains attached.
8. Confirm an expense without booking/trip scope is visibly General / Unassigned.
9. Open that event's admin Event Wrap-up.
10. Confirm the event-linked expense and receipt photo appear under `Expenses & receipts`.
11. If the wrap-up was reviewed before the edit, confirm source-data-changed warning appears.

- [ ] **Step 6: Verify branch freshness before PR**

```bash
git fetch origin main
git log --oneline --left-right origin/main...HEAD
git diff --stat origin/main...HEAD
```

If `main` moved, inspect overlap before rebasing/transplanting. Do not open a stale/conflicted PR merely because implementation is complete.

- [ ] **Step 7: Commit final regression adjustments**

```bash
git add -A
git commit -m "test: verify finance evidence release"
```

Skip this commit only if there are genuinely no uncommitted regression/test adjustments.

---

## Release 1 completion checklist

Release 1 is complete only when all are true:

- Admin Finance shows individual manager expenses beneath totals.
- Uploaded receipt images are viewable by admin.
- Missing/broken receipt image enrichment does not hide the expense.
- General / Unassigned expenses are visible.
- Admin can edit merchant/category/amount/tax/payment/date/notes and assignment fields.
- Editing preserves the same expense and receipt IDs.
- Every admin correction appends audit history.
- Event Wrap-up shows its actual expense/receipt records, not only receipt completeness totals.
- Reviewed Event Wrap-up source-change behavior fires after finance corrections.
- Existing manager expense/receipt submission still works.
- No automatic between-event assignment has been added yet.
- No duplicate reporting finance rows have been introduced.

## Next release

After Release 1 is deployed and accepted, create the detailed Release 2 plan for between-event travel windows and automatic assignment. That plan must inspect `trip_segments`, event lifecycle check-in/check-out records, and current route ordering before deciding whether any new travel-period table is necessary.
