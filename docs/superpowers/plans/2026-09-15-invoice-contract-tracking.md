# Invoice and Contract Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-friendly Invoices & Contracts workspace that uploads invoice PDFs, tracks deposits and balance payments, calculates overdue work, reuses the existing contract lifecycle, and surfaces both record types on profiles and bookings.

**Architecture:** Add a focused invoice ledger and payment history to `@workspace/db`, while keeping invoice files in the canonical Business Documents store and all contract state in the existing contract subsystem. Expose role-scoped invoice routers through one shared service, then reuse one React workspace and summary card with owner, office, and boss API adapters.

**Tech Stack:** TypeScript 5.9, PostgreSQL, Drizzle ORM, Express 5, Zod, React 19, Wouter, Tailwind, Vitest, Testing Library, PGlite, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-15-invoice-contract-tracking-design.md`

## Global Constraints

- The first release uploads and tracks existing invoices; it does not generate or email invoice PDFs.
- Invoice PDFs remain in Business Documents. Do not introduce a second file store.
- Contracts remain in the existing contract lifecycle. Do not create a parallel contract table.
- Owner, office coordinator, and boss/Dave have invoice and contract access; manager and crew roles do not.
- `overdue` is a calculated display state, not a persisted invoice status.
- Payments are voided, never deleted.
- All currency values are integer cents and use `USD` in this release.
- Mobile layouts must not require horizontal scrolling.
- Follow test-driven development: each production change follows a failing focused test.

---

## File Structure

### Database

- Create `lib/db/src/invoice-schema.ts`: invoice and payment tables, values, and exported types.
- Create `lib/db/migrations/20260915_invoice_contract_tracking.sql`: forward-only SQL migration.
- Modify `lib/db/src/business-document-schema.ts`: add `invoice` to the canonical document category.
- Modify `lib/db/src/index.ts`: register and export the invoice schema.
- Modify `lib/db/package.json`: export `./invoice-schema`.

### API

- Create `artifacts/api-server/src/features/invoices/invoice-types.ts`: stable request/response contracts used by routes and services.
- Create `artifacts/api-server/src/features/invoices/invoice-calculations.ts`: pure totals, next-due-date, effective-state, and transition functions.
- Create `artifacts/api-server/src/features/invoices/invoice-repository.ts`: Drizzle persistence and transactions.
- Create `artifacts/api-server/src/features/invoices/invoice-service.ts`: validation, orchestration, audit, and document linkage.
- Create `artifacts/api-server/src/routes/invoices.ts`: shared router factory.
- Create `artifacts/api-server/src/routes/office-invoices.ts` and `boss-invoices.ts`: role middleware and prefixes.
- Modify `artifacts/api-server/src/routes/contracts-runtime.ts` and `features/contracts/contract-query-repository.ts`: read-only workspace contract listing.
- Modify `artifacts/api-server/src/routes/index.ts`: mount the owner, office, and boss routes.

### Frontend

- Create `artifacts/adventure-zone/src/features/invoices/invoice-types.ts`: frontend record types.
- Create `artifacts/adventure-zone/src/lib/invoices-api.ts`: owner client plus prefix-based office/boss clients.
- Create `artifacts/adventure-zone/src/components/invoices/invoice-status-badge.tsx`.
- Create `artifacts/adventure-zone/src/components/invoices/invoice-card.tsx`.
- Create `artifacts/adventure-zone/src/components/invoices/invoice-editor.tsx`.
- Create `artifacts/adventure-zone/src/components/invoices/payment-editor.tsx`.
- Create `artifacts/adventure-zone/src/components/invoices/invoice-contract-summary-card.tsx`.
- Create `artifacts/adventure-zone/src/pages/InvoicesContractsPage.tsx`.
- Create `artifacts/adventure-zone/src/pages/OfficeInvoicesContractsPage.tsx` and `BossInvoicesContractsPage.tsx` as thin client adapters.
- Modify `artifacts/adventure-zone/src/App.tsx`, `components/navigation/app-menu.tsx`, `components/office/office-shell.tsx`, and `components/boss/boss-shell.tsx` for routes and navigation.
- Modify `artifacts/adventure-zone/src/pages/EventProfilePage.tsx` and `BookingDetailPage.tsx` for scoped summary cards.
- Modify Business Document frontend category unions, upload choices, filters, and grouping labels to recognize `invoice`.

---

### Task 1: Persist invoices, payments, and the invoice document category

**Files:**
- Create: `lib/db/src/invoice-schema.ts`
- Create: `lib/db/migrations/20260915_invoice_contract_tracking.sql`
- Modify: `lib/db/src/business-document-schema.ts`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/package.json`
- Test: `artifacts/api-server/src/features/invoices/invoice-schema.test.ts`

**Interfaces:**
- Produces: `invoiceStatusValues`, `invoices`, `invoicePayments`, `InvoiceStatus`, `InvoiceRow`, and `InvoicePaymentRow` from `@workspace/db/invoice-schema`.
- Consumes: `organizations`, `bookings`, `businessDocuments`, and the existing audit/document foreign-key patterns.

- [ ] **Step 1: Write the failing schema test**

Create a PGlite test that applies the invoice migration and proves constraints reject invalid data:

```ts
it("stores an invoice and immutable payment history", async () => {
  const invoice = await sql<{ id: string }>`
    insert into invoices (
      organization_id, document_id, invoice_number, status,
      currency, total_cents, deposit_cents, issue_date, created_by
    ) values (
      ${organizationId}, ${documentId}, 'AZ-2027-001', 'sent',
      'USD', 750000, 300000, '2026-09-15', 'owner:test'
    ) returning id
  `;
  await sql`insert into invoice_payments
    (invoice_id, amount_cents, received_date, method, created_by)
    values (${invoice.rows[0].id}, 300000, '2026-09-15', 'check', 'owner:test')`;
  expect(await scalar("select count(*) from invoice_payments")).toBe(1);
});

it.each([-1, -100])("rejects negative payment %s", async (amountCents) => {
  await expect(insertPayment(amountCents)).rejects.toThrow();
});

it("rejects a deposit larger than the invoice total", async () => {
  await expect(insertInvoice({ totalCents: 10000, depositCents: 10001 })).rejects.toThrow();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices/invoice-schema.test.ts
```

Expected: FAIL because the migration and `invoices` tables do not exist.

- [ ] **Step 3: Add the schema and migration**

Define the persisted values exactly:

```ts
export const invoiceStatusValues = [
  "draft", "sent", "deposit_due", "deposit_paid", "paid", "cancelled",
] as const;

export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  documentId: uuid("document_id").notNull().references(() => businessDocuments.id, { onDelete: "restrict" }),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status").$type<InvoiceStatus>().default("draft").notNull(),
  currency: text("currency").default("USD").notNull(),
  totalCents: integer("total_cents").notNull(),
  depositCents: integer("deposit_cents").default(0).notNull(),
  issueDate: date("issue_date").notNull(),
  depositDueDate: date("deposit_due_date"),
  balanceDueDate: date("balance_due_date"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (table) => [
  unique("invoices_profile_number_unique").on(table.organizationId, table.invoiceNumber),
  check("invoices_amounts_valid", sql`${table.totalCents} >= 0 and ${table.depositCents} >= 0 and ${table.depositCents} <= ${table.totalCents}`),
  check("invoices_currency_usd", sql`${table.currency} = 'USD'`),
]);
```

Add `invoice` to both the TypeScript category array and SQL check in `business-document-schema.ts`. Export the schema through the DB package.

- [ ] **Step 4: Run schema tests and type checking**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices/invoice-schema.test.ts
pnpm --filter @workspace/db run build
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit the database foundation**

```bash
git add lib/db artifacts/api-server/src/features/invoices/invoice-schema.test.ts
git commit -m "feat: add invoice and payment schema"
```

---

### Task 2: Calculate balances, overdue state, and safe transitions

**Files:**
- Create: `artifacts/api-server/src/features/invoices/invoice-types.ts`
- Create: `artifacts/api-server/src/features/invoices/invoice-calculations.ts`
- Test: `artifacts/api-server/src/features/invoices/invoice-calculations.test.ts`

**Interfaces:**
- Produces:
  - `summarizeInvoice(invoice, payments, today): InvoiceSummary`
  - `nextStatus(invoice, payments, requestedStatus?): InvoiceStatus`
  - `InvoiceSummary` with `paidCents`, `remainingCents`, `creditCents`, `effectiveStatus`, and `nextDueDate`.
- Consumes: `InvoiceStatus` from `@workspace/db/invoice-schema`.

- [ ] **Step 1: Write failing calculation tests**

Cover the rules with table-driven tests:

```ts
it.each([
  { paid: 0, expected: { remainingCents: 750000, effectiveStatus: "deposit_due" } },
  { paid: 300000, expected: { remainingCents: 450000, effectiveStatus: "deposit_paid" } },
  { paid: 750000, expected: { remainingCents: 0, effectiveStatus: "paid" } },
  { paid: 760000, expected: { remainingCents: 0, creditCents: 10000, effectiveStatus: "paid" } },
])("summarizes payment total $paid", ({ paid, expected }) => {
  expect(summarizeInvoice(invoice(), payments(paid), new Date("2026-09-15T12:00:00Z")))
    .toMatchObject(expected);
});

it("calculates overdue without persisting an overdue status", () => {
  const result = summarizeInvoice(
    invoice({ status: "sent", balanceDueDate: "2026-09-14" }),
    [],
    new Date("2026-09-15T12:00:00Z"),
  );
  expect(result.effectiveStatus).toBe("overdue");
  expect(result.storedStatus).toBe("sent");
});

it("ignores voided payments", () => {
  expect(summarizeInvoice(invoice(), [{ amountCents: 300000, voidedAt: "2026-09-15" }], today).paidCents).toBe(0);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices/invoice-calculations.test.ts
```

Expected: FAIL because calculation exports do not exist.

- [ ] **Step 3: Implement pure calculations**

Use this public shape:

```ts
export type InvoiceEffectiveStatus = InvoiceStatus | "overdue";
export type InvoiceSummary = {
  storedStatus: InvoiceStatus;
  effectiveStatus: InvoiceEffectiveStatus;
  paidCents: number;
  remainingCents: number;
  creditCents: number;
  nextDueDate: string | null;
};

export function summarizeInvoice(
  invoice: InvoiceCalculationSource,
  payments: InvoicePaymentSource[],
  today: Date,
): InvoiceSummary;
```

Normalize comparisons to calendar dates, exclude voided payments, cap `remainingCents` at zero, and expose excess as `creditCents`.

- [ ] **Step 4: Run calculation tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices/invoice-calculations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit calculation behavior**

```bash
git add artifacts/api-server/src/features/invoices
git commit -m "feat: calculate invoice balances and due states"
```

---

### Task 3: Add the invoice repository and service

**Files:**
- Create: `artifacts/api-server/src/features/invoices/invoice-repository.ts`
- Create: `artifacts/api-server/src/features/invoices/invoice-service.ts`
- Test: `artifacts/api-server/src/features/invoices/invoice-repository.test.ts`
- Test: `artifacts/api-server/src/features/invoices/invoice-service.test.ts`

**Interfaces:**
- Produces `InvoiceService` methods:
  - `list(filters, today)`
  - `detail(invoiceId, today)`
  - `create(input, actor, today)`
  - `update(invoiceId, patch, actor, today)`
  - `recordPayment(invoiceId, input, actor, today)`
  - `voidPayment(invoiceId, paymentId, actor, today)`
  - `summary(scope, today)`
- Consumes: Task 1 tables and Task 2 calculation functions.

- [ ] **Step 1: Write failing repository transaction tests**

Test real PGlite persistence:

```ts
it("creates an invoice linked to the selected profile, booking, and invoice document", async () => {
  const created = await repository.create({
    organizationId, bookingId, documentId, invoiceNumber: "AZ-2027-001",
    status: "sent", totalCents: 750000, depositCents: 300000,
    issueDate: "2026-09-15", depositDueDate: "2026-10-15",
    balanceDueDate: "2027-07-22", notes: null, createdBy: "owner:test",
  });
  expect(created).toMatchObject({ organizationId, bookingId, documentId });
});

it("voids a payment without deleting it", async () => {
  const payment = await repository.addPayment(invoiceId, paymentInput, "owner:test");
  await repository.voidPayment(invoiceId, payment.id, "owner:test");
  expect(await repository.payments(invoiceId)).toContainEqual(expect.objectContaining({ id: payment.id, voidedAt: expect.any(Date) }));
});
```

- [ ] **Step 2: Run repository tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices/invoice-repository.test.ts
```

Expected: FAIL because `InvoiceRepository` does not exist.

- [ ] **Step 3: Implement repository transactions**

Make payment writes and invoice-status reconciliation one database transaction. Lock the invoice row during payment updates with `SELECT ... FOR UPDATE` through the transaction client before summing payments.

- [ ] **Step 4: Run repository tests and verify GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices/invoice-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing service tests**

```ts
it("rejects a booking that does not belong to the selected profile", async () => {
  await expect(service.create(input({ organizationId, bookingId: otherProfileBookingId }), actor, today))
    .rejects.toMatchObject({ code: "INVOICE_BOOKING_PROFILE_MISMATCH" });
});

it("rejects duplicate active invoice numbers for one profile", async () => {
  await service.create(input({ invoiceNumber: "AZ-2027-001" }), actor, today);
  await expect(service.create(input({ invoiceNumber: "AZ-2027-001" }), actor, today))
    .rejects.toMatchObject({ code: "INVOICE_NUMBER_EXISTS" });
});

it("reconciles paid status after a payment", async () => {
  const result = await service.recordPayment(invoiceId, { amountCents: 750000, receivedDate: "2026-09-15" }, actor, today);
  expect(result.invoice).toMatchObject({ storedStatus: "paid", remainingCents: 0 });
});
```

- [ ] **Step 6: Run service tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices/invoice-service.test.ts
```

Expected: FAIL because service validation and orchestration are missing.

- [ ] **Step 7: Implement the service**

Use Zod request schemas at the service boundary, validate profile/booking/document relationships, write audit records, and call Task 2 calculations for every response.

- [ ] **Step 8: Run invoice feature tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices
```

Expected: PASS.

- [ ] **Step 9: Commit the service layer**

```bash
git add artifacts/api-server/src/features/invoices
git commit -m "feat: add invoice ledger service"
```

---

### Task 4: Expose owner, office, and boss invoice APIs

**Files:**
- Create: `artifacts/api-server/src/routes/invoices.ts`
- Create: `artifacts/api-server/src/routes/invoices.test.ts`
- Create: `artifacts/api-server/src/routes/office-invoices.ts`
- Create: `artifacts/api-server/src/routes/office-invoices.test.ts`
- Create: `artifacts/api-server/src/routes/boss-invoices.ts`
- Create: `artifacts/api-server/src/routes/boss-invoices.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- Produces routes under `/invoices`, `/office/invoices`, and `/boss/invoices` with identical response shapes.
- Consumes: `InvoiceService` from Task 3 and existing role middleware.

- [ ] **Step 1: Write failing shared-router tests**

Build the router with a fake service and assert request mapping:

```ts
it("creates an invoice from a linked uploaded document", async () => {
  const response = await request(ownerApp())
    .post("/invoices")
    .send({
      organizationId, bookingId, documentId, invoiceNumber: "AZ-2027-001",
      status: "sent", totalCents: 750000, depositCents: 300000,
      issueDate: "2026-09-15", depositDueDate: "2026-10-15",
      balanceDueDate: "2027-07-22",
    })
    .expect(201);
  expect(response.body.invoice.invoiceNumber).toBe("AZ-2027-001");
});

it("records a payment", async () => {
  await request(ownerApp()).post(`/invoices/${invoiceId}/payments`)
    .send({ amountCents: 300000, receivedDate: "2026-10-15", method: "check", notes: null })
    .expect(201);
});
```

Cover list filters, detail, patch, summary, payment void, 400 validation, 404, and conflict responses.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/invoices.test.ts
```

Expected: FAIL because the router is missing.

- [ ] **Step 3: Implement `createInvoicesRouter`**

Expose:

```text
GET    /invoices
GET    /invoices/summary
GET    /invoices/:invoiceId
POST   /invoices
PATCH  /invoices/:invoiceId
POST   /invoices/:invoiceId/payments
POST   /invoices/:invoiceId/payments/:paymentId/void
```

Return errors as `{ error, code, fields? }`. Never return storage keys.

- [ ] **Step 4: Write failing role authentication tests**

Assert owner tokens fail on office/boss routes, office tokens fail on boss routes, and valid role sessions reach the shared router with `createdBy` derived from the authenticated account.

- [ ] **Step 5: Run and verify role tests fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/office-invoices.test.ts src/routes/boss-invoices.test.ts
```

Expected: FAIL because role wrappers are missing.

- [ ] **Step 6: Implement role wrappers and mount all routers**

Follow the existing `office-documents.ts` and `boss-business-documents.ts` middleware order. Do not mount invoice routes under manager or crew routers.

- [ ] **Step 7: Run route tests and type checking**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/invoices.test.ts src/routes/office-invoices.test.ts src/routes/boss-invoices.test.ts
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 8: Commit the invoice API**

```bash
git add artifacts/api-server/src/routes
git commit -m "feat: expose invoice tracking APIs"
```

---

### Task 5: Add workspace-level contract reads without duplicating contract state

**Files:**
- Modify: `artifacts/api-server/src/features/contracts/contract-query-repository.ts`
- Modify: `artifacts/api-server/src/features/contracts/contract-types.ts`
- Modify: `artifacts/api-server/src/routes/contracts-runtime.ts`
- Modify: `artifacts/adventure-zone/src/features/contracts/contract-client.ts`
- Test: `artifacts/api-server/src/features/contracts/contract-query-repository.test.ts`
- Test: `artifacts/api-server/src/routes/contracts.test.ts`

**Interfaces:**
- Produces `listWorkspaceContracts(filters)` returning organization label, booking label, current status, dates, and safe file metadata.
- Consumes: existing `contractVersions`, `contractFiles`, bookings, and organizations.

- [ ] **Step 1: Write failing contract workspace tests**

```ts
it("lists contract lifecycle records with profile and booking labels", async () => {
  const records = await repository.listWorkspaceContracts({ status: "sent_for_signature" });
  expect(records).toContainEqual(expect.objectContaining({
    organizationId, organizationName: "Fairplay Burro Days",
    bookingId, status: "sent_for_signature",
  }));
});
```

The route test must prove it returns existing contract statuses and does not create a new record.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/contracts/contract-query-repository.test.ts src/routes/contracts.test.ts
```

Expected: FAIL because workspace listing is absent.

- [ ] **Step 3: Implement read-only contract listing**

Add `GET /contracts/workspace?status=&organizationId=&bookingId=`. Reuse existing safe file projection and lifecycle values.

- [ ] **Step 4: Run contract tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/contracts/contract-query-repository.test.ts src/routes/contracts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit contract workspace reads**

```bash
git add artifacts/api-server/src/features/contracts artifacts/api-server/src/routes/contracts-runtime.ts artifacts/adventure-zone/src/features/contracts
git commit -m "feat: list contracts for shared workspace"
```

---

### Task 6: Recognize invoice files throughout Business Documents

**Files:**
- Modify: `artifacts/adventure-zone/src/lib/business-documents-api.ts`
- Modify: `artifacts/adventure-zone/src/components/business-documents/role-business-documents-page.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BusinessDocumentsPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/business-document-organization.ts`
- Modify: `artifacts/api-server/src/features/business-documents/business-document-classifier.ts`
- Test: `artifacts/adventure-zone/src/pages/BusinessDocumentsPage.test.tsx`
- Test: `artifacts/adventure-zone/src/pages/business-document-organization.test.ts`
- Test: `artifacts/api-server/src/features/business-documents/business-document-classifier.test.ts`

**Interfaces:**
- Produces `BusinessDocumentCategory` support for `invoice` in all role upload and library paths.
- Consumes: Task 1 database category.

- [ ] **Step 1: Write failing category tests**

```ts
it("shows invoices as their own document group", () => {
  const groups = groupBusinessDocuments([document({ category: "invoice" })]);
  expect(groups[0]).toMatchObject({ key: "invoice", label: "Invoices" });
});

it("offers Invoice in the role upload category selector", async () => {
  render(<RoleBusinessDocumentsPage api={api} eyebrow="Office file system" />);
  await user.click(screen.getByRole("button", { name: /upload document/i }));
  expect(screen.getByRole("option", { name: "Invoice" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/BusinessDocumentsPage.test.tsx src/pages/business-document-organization.test.ts
```

Expected: FAIL because the frontend union and group omit `invoice`.

- [ ] **Step 3: Implement invoice category UI and classifier support**

Add an **Invoices** library view and keep **Contracts** unchanged. Classify filenames containing unambiguous tokens such as `invoice` as invoice; ambiguous files continue to `needs_review` rather than being guessed.

- [ ] **Step 4: Run document regression tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/BusinessDocumentsPage.test.tsx src/pages/business-document-organization.test.ts
pnpm --filter @workspace/api-server exec vitest run src/features/business-documents/business-document-classifier.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Business Documents integration**

```bash
git add artifacts/adventure-zone/src/lib/business-documents-api.ts artifacts/adventure-zone/src/components/business-documents artifacts/adventure-zone/src/pages/BusinessDocumentsPage.tsx artifacts/adventure-zone/src/pages/business-document-organization.ts artifacts/api-server/src/features/business-documents
git commit -m "feat: add invoices to business documents"
```

---

### Task 7: Build the shared Invoices & Contracts workspace

**Files:**
- Create: `artifacts/adventure-zone/src/features/invoices/invoice-types.ts`
- Create: `artifacts/adventure-zone/src/lib/invoices-api.ts`
- Create: `artifacts/adventure-zone/src/components/invoices/invoice-status-badge.tsx`
- Create: `artifacts/adventure-zone/src/components/invoices/invoice-card.tsx`
- Create: `artifacts/adventure-zone/src/components/invoices/invoice-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/invoices/payment-editor.tsx`
- Create: `artifacts/adventure-zone/src/pages/InvoicesContractsPage.tsx`
- Test: `artifacts/adventure-zone/src/pages/InvoicesContractsPage.test.tsx`
- Test: `artifacts/adventure-zone/src/components/invoices/invoice-editor.test.tsx`

**Interfaces:**
- Produces `InvoiceWorkspaceClient` and `InvoicesContractsPage({ invoiceApi, contractApi, documentApi })`.
- Consumes: Tasks 4-6 APIs and Business Document upload/open/delete operations.

- [ ] **Step 1: Write failing workspace tests**

```tsx
it("shows invoice attention counts and mobile-safe cards", async () => {
  render(<InvoicesContractsPage invoiceApi={invoiceApi} contractApi={contractApi} documentApi={documentApi} />);
  expect(await screen.findByText("Overdue balances")).toBeInTheDocument();
  expect(screen.getByText("$4,500.00 remaining")).toBeInTheDocument();
  expect(screen.getByTestId("invoice-card")).toHaveClass("grid");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("filters invoices without losing summary totals", async () => {
  await user.selectOptions(screen.getByLabelText("Invoice status"), "deposit_paid");
  expect(invoiceApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "deposit_paid" }));
  expect(screen.getByText("Overdue balances")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/InvoicesContractsPage.test.tsx
```

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement API types and the read-only workspace shell**

Define:

```ts
export type InvoiceWorkspaceClient = {
  list(filters: InvoiceFilters): Promise<{ invoices: InvoiceRecord[] }>;
  summary(filters: InvoiceScope): Promise<InvoiceAttentionSummary>;
  detail(invoiceId: string): Promise<{ invoice: InvoiceRecord }>;
  create(input: CreateInvoiceInput): Promise<{ invoice: InvoiceRecord }>;
  update(invoiceId: string, patch: UpdateInvoiceInput): Promise<{ invoice: InvoiceRecord }>;
  recordPayment(invoiceId: string, input: CreatePaymentInput): Promise<{ invoice: InvoiceRecord }>;
  voidPayment(invoiceId: string, paymentId: string): Promise<{ invoice: InvoiceRecord }>;
};
```

Render compact summary tiles, filter controls, invoice cards, and contract cards. Use cards at every breakpoint unless a later measured need justifies a desktop table.

- [ ] **Step 4: Run workspace tests and verify GREEN for reads**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/InvoicesContractsPage.test.tsx
```

Expected: PASS for loading, filtering, empty, and error states.

- [ ] **Step 5: Write failing upload/create/payment tests**

```tsx
it("uploads the PDF, creates the invoice, and rolls back the file when creation fails", async () => {
  documentApi.upload.mockResolvedValue({ documentId });
  invoiceApi.create.mockRejectedValue(new Error("Invoice number already exists"));
  render(<InvoiceEditor {...props} />);
  await completeInvoiceForm(user);
  await user.click(screen.getByRole("button", { name: "Save invoice" }));
  expect(documentApi.deleteDocument).toHaveBeenCalledWith(documentId);
  expect(screen.getByRole("alert")).toHaveTextContent("Invoice number already exists");
});

it("records a deposit and refreshes the balance", async () => {
  await user.click(screen.getByRole("button", { name: "Record payment" }));
  await user.type(screen.getByLabelText("Payment amount"), "3000");
  await user.click(screen.getByRole("button", { name: "Save payment" }));
  expect(invoiceApi.recordPayment).toHaveBeenCalledWith(invoiceId, expect.objectContaining({ amountCents: 300000 }));
});
```

- [ ] **Step 6: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/invoices/invoice-editor.test.tsx src/pages/InvoicesContractsPage.test.tsx
```

Expected: FAIL because editor actions are missing.

- [ ] **Step 7: Implement editor and payment actions**

Use integer-cent conversion at the form boundary, inline field errors, disabled busy states, and rollback through `documentApi.deleteDocument(documentId)` if invoice creation fails after upload.

- [ ] **Step 8: Run workspace tests and type checking**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/invoices src/pages/InvoicesContractsPage.test.tsx
pnpm --filter @workspace/adventure-zone run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 9: Commit the shared workspace**

```bash
git add artifacts/adventure-zone/src/features/invoices artifacts/adventure-zone/src/lib/invoices-api.ts artifacts/adventure-zone/src/components/invoices artifacts/adventure-zone/src/pages/InvoicesContractsPage.tsx
git commit -m "feat: build invoices and contracts workspace"
```

---

### Task 8: Add owner, office, and boss routes and navigation

**Files:**
- Create: `artifacts/adventure-zone/src/pages/OfficeInvoicesContractsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/BossInvoicesContractsPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Modify: `artifacts/adventure-zone/src/components/office/office-shell.tsx`
- Modify: `artifacts/adventure-zone/src/components/boss/boss-shell.tsx`
- Test: `artifacts/adventure-zone/src/App.invoice-routes.test.tsx`
- Test: `artifacts/adventure-zone/src/components/navigation/app-menu-invoices.test.tsx`

**Interfaces:**
- Produces `/invoices-contracts`, `/office/invoices-contracts`, and `/boss/invoices-contracts` pages.
- Consumes: Task 7 shared page and role-specific auth fetch helpers.

- [ ] **Step 1: Write failing route and navigation tests**

```ts
it("registers invoice and contract workspaces only for authorized roles", () => {
  expect(appSource).toContain('path="/invoices-contracts"');
  expect(appSource).toContain('path="/office/invoices-contracts"');
  expect(appSource).toContain('path="/boss/invoices-contracts"');
  expect(appSource).not.toContain('path="/manager/invoices-contracts"');
});
```

Assert the owner menu label is exactly **Invoices & Contracts**, with matching office and boss links.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/App.invoice-routes.test.tsx src/components/navigation/app-menu-invoices.test.tsx
```

Expected: FAIL because routes and links are absent.

- [ ] **Step 3: Implement thin role adapters and navigation**

Each adapter supplies the correct role-authenticated invoice, contract, and document clients to the shared page. Do not duplicate workspace JSX.

- [ ] **Step 4: Run route and existing shell tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/App.invoice-routes.test.tsx src/components/navigation/app-menu-invoices.test.tsx src/App.office-routing.test.tsx src/components/office/office-shell.test.tsx src/components/boss/boss-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit role access and navigation**

```bash
git add artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation artifacts/adventure-zone/src/components/office artifacts/adventure-zone/src/components/boss artifacts/adventure-zone/src/pages/OfficeInvoicesContractsPage.tsx artifacts/adventure-zone/src/pages/BossInvoicesContractsPage.tsx
git commit -m "feat: link invoice tracking workspaces"
```

---

### Task 9: Surface invoice and contract summaries on profiles and bookings

**Files:**
- Create: `artifacts/adventure-zone/src/components/invoices/invoice-contract-summary-card.tsx`
- Create: `artifacts/adventure-zone/src/components/invoices/invoice-contract-summary-card.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BookingDetailPage.tsx`
- Test: `artifacts/adventure-zone/src/pages/EventProfilePage.invoice-summary.test.tsx`
- Test: `artifacts/adventure-zone/src/pages/BookingDetailPage.invoice-summary.test.tsx`

**Interfaces:**
- Produces `InvoiceContractSummaryCard({ organizationId, bookingId?, invoiceApi, contractApi })`.
- Consumes: scoped list/summary methods from Tasks 4, 5, and 7.

- [ ] **Step 1: Write failing summary-card tests**

```tsx
it("shows the current invoice, remaining balance, next due date, and contract status", async () => {
  render(<InvoiceContractSummaryCard organizationId={organizationId} bookingId={bookingId} invoiceApi={invoiceApi} contractApi={contractApi} />);
  expect(await screen.findByText("Deposit paid")).toBeInTheDocument();
  expect(screen.getByText("$4,500.00 remaining")).toBeInTheDocument();
  expect(screen.getByText("Sent for signature")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View all invoices and contracts" })).toHaveAttribute(
    "href", `/invoices-contracts?organizationId=${organizationId}&bookingId=${bookingId}`,
  );
});
```

Add tests for no records, multiple records newest-first, file-open actions, and API failure isolation.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/invoices/invoice-contract-summary-card.test.tsx
```

Expected: FAIL because the card is missing.

- [ ] **Step 3: Implement the reusable summary card**

Keep invoice and contract loading independent so one failing endpoint does not hide the other record type. Show a small inline error only for the failed section.

- [ ] **Step 4: Add failing profile and booking wiring tests**

Assert both pages render the card with the correct IDs and do not add invoice access to manager or crew screens.

- [ ] **Step 5: Run page tests and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfilePage.invoice-summary.test.tsx src/pages/BookingDetailPage.invoice-summary.test.tsx
```

Expected: FAIL because pages do not render the card.

- [ ] **Step 6: Wire profile and booking pages**

Place the card near existing linked documents and contract history. Keep the existing `ContractAction` and `ContractHistoryCard`; the new summary links to them rather than replacing authoring controls.

- [ ] **Step 7: Run summary and page tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/invoices/invoice-contract-summary-card.test.tsx src/pages/EventProfilePage.invoice-summary.test.tsx src/pages/BookingDetailPage.invoice-summary.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit profile and booking integration**

```bash
git add artifacts/adventure-zone/src/components/invoices/invoice-contract-summary-card* artifacts/adventure-zone/src/pages/EventProfilePage* artifacts/adventure-zone/src/pages/BookingDetailPage*
git commit -m "feat: show invoice and contract status on events"
```

---

### Task 10: Verify the full feature and deployment safety

**Files:**
- Modify only files required to fix failures discovered by the commands below.
- Test: all focused and regression suites listed below.

**Interfaces:**
- Consumes: every prior task.
- Produces: a verified branch ready for review and deployment.

- [ ] **Step 1: Run all invoice and contract focused tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/invoices src/routes/invoices.test.ts src/routes/office-invoices.test.ts src/routes/boss-invoices.test.ts src/features/contracts/contract-query-repository.test.ts src/routes/contracts.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/invoices src/pages/InvoicesContractsPage.test.tsx src/pages/EventProfilePage.invoice-summary.test.tsx src/pages/BookingDetailPage.invoice-summary.test.tsx src/App.invoice-routes.test.tsx
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run Business Documents, office, and boss regressions**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/business-documents src/routes/business-documents.test.ts src/routes/business-documents.security.test.ts src/routes/office-documents.test.ts src/routes/boss-business-documents.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/BusinessDocumentsPage.test.tsx src/pages/business-document-organization.test.ts src/App.office-routing.test.tsx src/components/office/office-shell.test.tsx src/components/boss/boss-shell.test.tsx
```

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run type checking and production build**

```bash
pnpm run typecheck
pnpm run build
```

Expected: both commands exit 0.

- [ ] **Step 4: Inspect the final diff and migration**

```bash
git status --short
git diff --check
git diff --stat main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: no whitespace errors, no unrelated changes, and one focused commit per completed task.

- [ ] **Step 5: Commit verification-only fixes when needed**

If Step 1-4 required a code correction, rerun the affected command and then commit only that verified correction:

```bash
git add lib/db artifacts/api-server artifacts/adventure-zone
git commit -m "fix: complete invoice tracking verification"
```

If no correction was required, do not create an empty commit.
