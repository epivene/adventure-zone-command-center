# Finance Reporting Release 1 — Evidence & Admin Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins inspect every manager-submitted expense together with its receipt image/details, correct mistakes with an audit trail, keep General / Unassigned records visible, and show event-linked expenses directly inside Event Wrap-up.

**Architecture:** Extend the existing leg-manager finance tables rather than copying finance rows into report tables. Add assignment provenance and an append-only audit table, expose a normalized admin expense contract, enrich uploaded receipt rows with short-lived signed URLs through the existing object-storage abstraction, and reuse that same record model in Finance and Event Wrap-up.

**Tech Stack:** TypeScript, React, Express, Drizzle ORM, PostgreSQL, Google Cloud Storage, Vitest, Testing Library, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-17-finance-reporting-system-design.md`

## Global Constraints

- One expense remains one source row; reassignment never clones an expense or receipt.
- Do not implement automatic between-event travel assignment in Release 1.
- Existing manager receipt/expense creation and offline sync must stay compatible.
- Receipt signed-URL failures must degrade to `imageUrl: null`, never blank the entire list or Event Wrap-up.
- Existing event source fingerprints already include `leg_expenses.updated_at` and `leg_receipts.updated_at`; admin edits must update `leg_expenses.updated_at` so reviewed Event Wrap-ups naturally become `sourceDataChanged`.
- Existing records with booking/trip/segment references backfill `assignment_source = 'legacy'`; records with no references backfill `assignment_source = 'unassigned'`.
- Audit records are append-only through normal app flows.
- A GitHub Actions job with zero steps is not green CI.

---

### Task 1: Add assignment provenance and finance audit schema

**Files:**
- Create: `lib/db/migrations/044_finance_admin_evidence.sql`
- Modify: `lib/db/src/migrations.ts`
- Modify: `lib/db/src/schema/index.ts`
- Test: `artifacts/api-server/src/db/finance-admin-evidence-migration.test.ts`

**Interfaces:**
- Produces `leg_expenses.assignment_source`, `assignment_reason`, `assignment_updated_at`.
- Produces `leg_finance_audit` and Drizzle export `legFinanceAudit`.

- [ ] **Step 1: Write the failing migration test**

Create `artifacts/api-server/src/db/finance-admin-evidence-migration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadActReviewMigrations } from "@workspace/db/migrations";

describe("finance admin evidence migration", () => {
  it("registers assignment provenance and audit storage", async () => {
    const migrations = await loadActReviewMigrations();
    const migration = migrations.find((row) => row.name === "044_finance_admin_evidence.sql");
    expect(migration).toBeDefined();
    expect(migration?.markerSql).toContain("assignment_source");
    expect(migration?.markerSql).toContain("leg_finance_audit");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS leg_finance_audit");
  });
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/db/finance-admin-evidence-migration.test.ts
```

Expected: FAIL because migration 044 is not registered.

- [ ] **Step 3: Create migration 044**

`lib/db/migrations/044_finance_admin_evidence.sql`:

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

Extend `legExpenses`:

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

- [ ] **Step 6: Run GREEN and compile DB package**

```bash
pnpm --filter @workspace/api-server test -- src/db/finance-admin-evidence-migration.test.ts
pnpm --filter @workspace/db build
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/db/migrations/044_finance_admin_evidence.sql lib/db/src/migrations.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/finance-admin-evidence-migration.test.ts
git commit -m "feat: add finance evidence audit schema"
```

---

### Task 2: Add normalized admin expense repository methods

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/admin-finance-types.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/finance-repository.ts`
- Test: `artifacts/api-server/src/features/leg-manager/finance-repository.admin.test.ts`

**Interfaces:**
- Produces `FinanceAssignmentSource`, `AdminExpenseFilters`, `AdminExpenseUpdateInput`, `FinanceAuditView`, `AdminExpenseRow`.
- Produces repository methods `listAdminExpenses`, `getAdminExpense`, `listExpenseAudit`, `updateAdminExpense`.

- [ ] **Step 1: Define types**

```ts
export const financeAssignmentSources = ["legacy", "explicit", "automatic", "admin", "unassigned"] as const;
export type FinanceAssignmentSource = typeof financeAssignmentSources[number];

export type AdminExpenseFilters = {
  legId?: string | null;
  bookingId?: string | null;
  category?: string | null;
  paymentSource?: string | null;
  assignmentSource?: FinanceAssignmentSource | null;
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

export type FinanceAuditActor = { actorId: string | null; actorLabel: string };
```

- [ ] **Step 2: Write failing repository tests**

```ts
it("lists event-linked and unassigned expenses", async () => {
  const rows = await repo.listAdminExpenses({});
  expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([eventExpenseId, generalExpenseId]));
});

it("updates one source row and appends audit history", async () => {
  const before = await repo.getAdminExpense(expenseId);
  await repo.updateAdminExpense(
    expenseId,
    { category: "vehicle_maintenance" },
    { actorId: "admin-user-1", actorLabel: "admin-user-1" },
  );
  const after = await repo.getAdminExpense(expenseId);
  const audit = await repo.listExpenseAudit(expenseId);
  expect(after?.id).toBe(before?.id);
  expect(audit[0]?.previousValues.category).toBe(before?.category);
  expect(audit[0]?.newValues.category).toBe("vehicle_maintenance");
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/leg-manager/finance-repository.admin.test.ts
```

- [ ] **Step 4: Implement list/get/audit queries**

Join `leg_expenses` to `travel_legs`, `bookings`, and `leg_receipts`; include expenses with all assignment refs null. Keep existing `summary()` unchanged.

- [ ] **Step 5: Implement transactional update**

`updateAdminExpense` must:

1. load existing row,
2. validate changed booking/trip/segment with existing `refsBelongToLeg`,
3. update only supplied fields,
4. set `assignmentSource = 'admin'` when an assignment field is supplied,
5. set `assignmentReason = changeReason ?? 'Admin reassignment'` for assignment changes,
6. update `assignmentUpdatedAt` and `updatedAt`,
7. insert one `legFinanceAudit` row with changed-field snapshots,
8. return the same expense ID.

- [ ] **Step 6: Run GREEN/typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/leg-manager/finance-repository.admin.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/admin-finance-types.ts artifacts/api-server/src/features/leg-manager/finance-repository.ts artifacts/api-server/src/features/leg-manager/finance-repository.admin.test.ts
git commit -m "feat: add admin expense record repository"
```

---

### Task 3: Enrich receipt evidence safely

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/admin-finance-record-service.ts`
- Test: `artifacts/api-server/src/features/leg-manager/admin-finance-record-service.test.ts`

**Interfaces:**
- Consumes `AdminExpenseRow` plus `LegManagerObjectStorage.getSignedReadUrl`.
- Produces `AdminExpenseRecord`.

- [ ] **Step 1: Define `AdminExpenseRecord`**

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
  receipt: null | { id: string; imageStatus: string; imageUrl: string | null };
  hasCorrections: boolean;
  audit: FinanceAuditView[];
};
```

- [ ] **Step 2: Write failing enrichment tests**

```ts
it("adds signed receipt URL for uploaded image", async () => {
  storage.getSignedReadUrl.mockResolvedValue("https://signed.example/receipt");
  const [record] = await service.enrich([uploadedReceiptRow]);
  expect(record.receipt?.imageUrl).toBe("https://signed.example/receipt");
});

it("keeps expense when signing fails", async () => {
  storage.getSignedReadUrl.mockRejectedValue(new Error("bucket unavailable"));
  const [record] = await service.enrich([uploadedReceiptRow]);
  expect(record.id).toBe(uploadedReceiptRow.id);
  expect(record.receipt?.imageUrl).toBeNull();
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/leg-manager/admin-finance-record-service.test.ts
```

- [ ] **Step 4: Implement enrichment**

Only sign receipts whose `imageStatus === "image_uploaded"` and object key is nonblank. Catch per-record signing failures so one image never rejects the whole list.

- [ ] **Step 5: Run GREEN/typecheck and commit**

```bash
pnpm --filter @workspace/api-server test -- src/features/leg-manager/admin-finance-record-service.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/leg-manager/admin-finance-record-service.ts artifacts/api-server/src/features/leg-manager/admin-finance-record-service.test.ts
git commit -m "feat: enrich admin expense receipt evidence"
```

---

### Task 4: Expose admin finance record APIs

**Files:**
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Test: `artifacts/api-server/src/routes/leg-manager-admin.finance-records.test.ts`

**Interfaces:**
- Produces `GET /manager-admin/finance/expenses`.
- Produces `GET /manager-admin/finance/expenses/:expenseId`.
- Produces `PATCH /manager-admin/finance/expenses/:expenseId`.

- [ ] **Step 1: Write route contract tests**

Test list/detail/update, invalid UUID, outside-leg reassignment, and receipt signing failure fallback.

```ts
expect(response.body.expenses[0]).toMatchObject({
  id: expenseId,
  totalCents: 1299,
  receipt: { imageStatus: "image_uploaded" },
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/routes/leg-manager-admin.finance-records.test.ts
```

- [ ] **Step 3: Add Zod filters/update validation**

Validate optional UUID assignment fields, non-negative cent values, ISO/coercible dates, `financeAssignmentSources`, and only categories/payment sources already accepted by manager finance submission.

- [ ] **Step 4: Implement list/detail routes**

List filters: `legId`, `bookingId`, `category`, `paymentSource`, `assignmentSource`, `dateFrom`, `dateTo`, `receiptStatus`.

Return:

```ts
{ expenses: AdminExpenseRecord[], warning?: "receipt_images_unavailable" }
```

- [ ] **Step 5: Implement PATCH**

Use the app's existing authenticated-admin request context. Pass its stable user identifier as `actorId`; use the available display/email label when exposed, otherwise use that stable user ID as `actorLabel`. Do not infer a human name.

- [ ] **Step 6: Run GREEN/typecheck and commit**

```bash
pnpm --filter @workspace/api-server test -- src/routes/leg-manager-admin.finance-records.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/routes/leg-manager-admin.finance-records.test.ts
git commit -m "feat: expose admin expense evidence API"
```

---

### Task 5: Build the admin Finance evidence workspace

**Files:**
- Create: `artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.tsx`
- Test: `artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.test.tsx`

**Interfaces:**
- Consumes the new admin finance list/PATCH routes.

- [ ] **Step 1: Write failing component/page tests**

Verify merchant/date/total/category/payment source, `General / Unassigned`, receipt thumbnail/open link, edit controls, independent loading errors, and filters.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager-finance/admin-expense-record.test.tsx src/pages/ManagerFinanceAdminPage.test.tsx
```

- [ ] **Step 3: Implement `AdminExpenseRecordCard`**

Collapsed: merchant, date, total, category, scope, receipt status.

Expanded: amount, tax, payment source, leg, event assignment, notes, receipt thumbnail + `Open receipt`, submitted timestamp, audit history, Edit.

Edit: merchant/category/amount/tax/payment/date/notes/event-trip-segment assignment/change reason.

- [ ] **Step 4: Update Finance page**

Keep existing summary totals, then load individual records **independently** rather than one brittle all-or-nothing `Promise.all`.

Add filters: leg, category, payment source, scope, receipt status, date range.

- [ ] **Step 5: Wire PATCH behavior**

Replace the edited record in local state and refresh summary totals after save.

- [ ] **Step 6: Run GREEN/typecheck and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager-finance/admin-expense-record.test.tsx src/pages/ManagerFinanceAdminPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
git add artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.tsx artifacts/adventure-zone/src/components/manager-finance/admin-expense-record.test.tsx artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.tsx artifacts/adventure-zone/src/pages/ManagerFinanceAdminPage.test.tsx
git commit -m "feat: show receipt evidence in admin finance"
```

---

### Task 6: Show event-linked evidence in Event Wrap-up

**Files:**
- Modify: `artifacts/api-server/src/features/leg-manager/event-wrap-up-source.ts`
- Test: `artifacts/api-server/src/features/leg-manager/event-wrap-up-source.finance-evidence.test.ts`
- Create: `artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.tsx`
- Test: `artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.test.tsx`

**Interfaces:**
- Adds `finance.expenseRecords: AdminExpenseRecord[]` without removing `directExpenses` or changing profitability math.

- [ ] **Step 1: Write failing backend test**

```ts
expect(payload.finance.expenseRecords.map((row) => row.id)).toEqual([eventExpenseId]);
expect(payload.finance.expenseRecords[0]?.receipt?.imageUrl).toBe(signedUrl);
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/leg-manager/event-wrap-up-source.finance-evidence.test.ts
```

- [ ] **Step 3: Reuse admin record service**

Query normalized rows filtered by `bookingId`, enrich through the same receipt service, and attach `expenseRecords`. Do not duplicate signed-URL logic.

- [ ] **Step 4: Preserve source fingerprint behavior**

Add a test showing an admin finance update changes `sourceFingerprint()`. Do not build a second fingerprint system; it already includes expense/receipt `updated_at` rows.

- [ ] **Step 5: Write failing frontend test**

```tsx
expect(screen.getByRole("heading", { name: "Expenses & receipts" })).toBeInTheDocument();
expect(screen.getByText("Fuel Stop")).toBeInTheDocument();
expect(screen.getByRole("link", { name: /open receipt/i })).toBeInTheDocument();
```

- [ ] **Step 6: Implement Event Wrap-up evidence section**

Place `Expenses & receipts` below Profitability. Reuse the same record/edit behavior where practical so Finance and Event Wrap-up do not diverge.

- [ ] **Step 7: Run GREEN/typechecks and commit**

```bash
pnpm --filter @workspace/api-server test -- src/features/leg-manager/event-wrap-up-source.finance-evidence.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager-finance/event-expense-evidence.test.tsx src/pages/EventWrapUpAdminPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
git add artifacts/api-server/src/features/leg-manager/event-wrap-up-source.ts artifacts/api-server/src/features/leg-manager/event-wrap-up-source.finance-evidence.test.ts artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.tsx artifacts/adventure-zone/src/components/manager-finance/event-expense-evidence.test.tsx artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.tsx artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.test.tsx
git commit -m "feat: show event receipt evidence in wrap up"
```

---

### Task 7: Regression and acceptance gate

**Files:**
- Modify only focused tests required by intentional payload additions.

- [ ] **Step 1: Add one-source-row reassignment regression**

Assert clearing/changing event assignment preserves expense ID and receipt linkage, adds audit history, and does not add another `leg_expenses` row.

- [ ] **Step 2: Run existing receipt/money regressions**

```bash
pnpm --filter @workspace/api-server test -- src/features/leg-manager/finance-repository.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerMoneyPage.test.tsx src/pages/ManagerReceiptsPage.test.tsx
```

If an exact legacy test filename has moved on current `main`, select the existing Vitest file that covers the same endpoint/flow; do not delete coverage.

- [ ] **Step 3: Run Release 1 focused suite**

```bash
pnpm --filter @workspace/api-server test -- \
  src/db/finance-admin-evidence-migration.test.ts \
  src/features/leg-manager/finance-repository.admin.test.ts \
  src/features/leg-manager/admin-finance-record-service.test.ts \
  src/routes/leg-manager-admin.finance-records.test.ts \
  src/features/leg-manager/event-wrap-up-source.finance-evidence.test.ts

pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/manager-finance/admin-expense-record.test.tsx \
  src/components/manager-finance/event-expense-evidence.test.tsx \
  src/pages/ManagerFinanceAdminPage.test.tsx \
  src/pages/EventWrapUpAdminPage.test.tsx
```

Expected: 0 failures.

- [ ] **Step 4: Run compile/build gate**

```bash
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: all exit 0.

- [ ] **Step 5: Manual acceptance**

Using a seeded/dev uploaded receipt:

1. Open admin Finance and confirm totals still render.
2. Open an individual manager expense and see entered details + receipt photo together.
3. Edit category/amount/notes and save.
4. Confirm audit history records the correction and the receipt remains attached.
5. Confirm an unassigned expense is visible as `General / Unassigned`.
6. Open the linked Event Wrap-up and see the same expense/receipt under `Expenses & receipts`.
7. For an already-reviewed wrap-up, edit its expense and confirm the existing source-data-changed warning appears.

- [ ] **Step 6: Verify branch freshness immediately before PR**

```bash
git fetch origin main
git log --oneline --left-right origin/main...HEAD
git diff --stat origin/main...HEAD
```

If `main` moved, inspect overlap before rebasing/transplanting. Do not knowingly open a stale/conflicted PR.

- [ ] **Step 7: Commit any final regression-only adjustment**

```bash
git add -A
git commit -m "test: verify finance evidence release"
```

Skip only when there are no uncommitted changes.

---

## Release 1 completion checklist

- Admin Finance shows individual manager expenses beneath totals.
- Uploaded receipt images are viewable by admin.
- Broken/missing receipt enrichment does not hide an expense.
- General / Unassigned expenses remain visible.
- Admin can correct finance details and assignments.
- Corrections preserve the same expense/receipt IDs and append audit history.
- Event Wrap-up shows its actual expense/receipt records.
- Reviewed Event Wrap-up source-change behavior fires after relevant corrections.
- Existing manager receipt/expense submission remains compatible.
- No automatic between-event assignment is introduced yet.
- No report-specific duplicate finance rows exist.

After this release is accepted, write the separate Release 2 travel-window/automatic-assignment implementation plan before changing travel behavior.
