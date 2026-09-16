# Invoice and Contract Tracking Design

Date: 2026-09-15
Status: Approved in chat for specification

## Goal

Add one practical workspace where Adventure Zone staff can upload and track invoices and review contract progress. The same financial and agreement records must also be visible from the related event profile and booking.

The first release tracks documents and payment progress. It does not create invoices, send email, collect payments, or synchronize payment status from Gmail or a payment processor.

## Existing System

- Business Documents stores protected files and links them to profiles, bookings, or event families. It supports contracts but has no invoice category.
- The contract subsystem already stores contract versions, files, and lifecycle states such as draft, sent for signature, partially signed, and completed.
- Profiles and bookings already expose linked records and documents.
- Owner, office, and boss workspaces have established authenticated document APIs and upload patterns.

The implementation will reuse those systems instead of introducing a second file store or duplicating contract state.

## Chosen Approach

Create a dedicated **Invoices & Contracts** workspace backed by a new invoice ledger and the existing contract lifecycle.

Alternatives considered:

1. Store invoices only as generic Business Documents. This is simple, but cannot reliably track balances, payments, due dates, or overdue work.
2. Store invoice fields directly on bookings. This cannot support replacement invoices, revisions, multiple invoices, or an auditable payment history.
3. Create a separate invoice ledger linked to Business Documents, profiles, and bookings. This keeps files in the canonical document store while giving invoice and payment data a clear home. This is the selected approach.

## User Experience

### Main workspace

Add **Invoices & Contracts** to the owner navigation. The page has two compact tabs:

- **Invoices**: searchable and filterable by status, profile, booking, event date, and due date.
- **Contracts**: shows the existing contract lifecycle and files in the same operational workspace.

The top of the page shows attention counts for:

- overdue invoice balances;
- deposits due;
- invoices with a remaining balance;
- contracts awaiting signatures.

Desktop may use a table where useful. Mobile uses stacked cards with the most important fields and actions visible without horizontal scrolling.

### Invoice workflow

The **Add invoice** action opens a form that requires:

- event profile;
- related booking when one exists;
- invoice number or reference;
- total amount;
- deposit amount when applicable;
- issue date;
- deposit due date when applicable;
- final balance due date when applicable;
- invoice PDF;
- optional notes.

Creating the record uploads the PDF to Business Documents with category `invoice` and links it to the selected profile and booking. Staff can replace the document version without deleting invoice or payment history.

Staff can record payments with an amount, received date, optional method, and optional note. The app calculates amount paid and remaining balance from payment records.

### Invoice states

Stored states:

- `draft`
- `sent`
- `deposit_due`
- `deposit_paid`
- `paid`
- `cancelled`

**Overdue** is calculated rather than stored. An invoice is overdue when it is not paid or cancelled, a relevant due date has passed, and a balance remains. This prevents stale status values when time advances.

State safeguards:

- A zero remaining balance changes the invoice to `paid` and records `paidAt`.
- Removing or correcting a payment can move a paid invoice back to the appropriate unpaid state.
- A cancelled invoice is excluded from due and overdue counts.
- Payment totals cannot be negative.
- Overpayments are allowed but shown clearly as a credit balance rather than silently discarded.

### Profile and booking views

Each event profile and booking receives a compact **Invoices & Contracts** card containing:

- current invoice status;
- total, paid, and remaining amounts;
- next due date;
- contract status;
- links to open the uploaded invoice and contract files;
- a link to the full workspace filtered to that profile or booking.

When multiple records exist, the card shows the newest/current record first and keeps prior records accessible.

## Data Model

### Business Documents

Add `invoice` to `businessDocumentCategoryValues`, database constraints, upload choices, filters, grouping labels, and document import classification.

Invoice PDFs continue to use the existing Business Document blob, version, source, audit, and link tables.

### Invoices

Add an `invoices` table with:

- `id`
- `organizationId` (required)
- `bookingId` (optional)
- `documentId` (required after successful creation)
- `invoiceNumber`
- `status`
- `currency` (USD in this release)
- `totalCents`
- `depositCents`
- `issueDate`
- `depositDueDate`
- `balanceDueDate`
- `sentAt`
- `paidAt`
- `notes`
- `createdBy`
- `createdAt`
- `updatedAt`
- `cancelledAt`

Constraints ensure nonnegative amounts, a deposit no greater than the total, valid status values, and valid profile/booking relationships.

### Payments

Add an `invoice_payments` table with:

- `id`
- `invoiceId`
- `amountCents`
- `receivedDate`
- `method`
- `notes`
- `createdBy`
- `createdAt`
- `voidedAt`
- `voidedBy`

Payments are voided rather than deleted so corrections retain an audit trail. Invoice totals use only non-voided payments.

## API and Services

Add authenticated invoice routes for:

- listing and filtering invoices;
- loading one invoice with payments and file metadata;
- creating an invoice and attaching its uploaded Business Document;
- updating invoice metadata and status;
- recording and voiding payments;
- replacing the invoice PDF;
- retrieving workspace summary counts;
- retrieving profile- and booking-scoped summaries.

The invoice service owns validation, derived balances, overdue calculation, and safe status transitions. Route handlers remain thin and return stable response objects.

The contract tab reads existing contract query services. It must not create a parallel contract table or duplicate contract lifecycle logic.

## Permissions

- Owner: full invoice and contract access.
- Office coordinator: view, upload, edit, and record payments using the existing office authorization pattern.
- Boss/Dave: the same document and tracking access already granted in the boss document workspace.
- Manager/crew roles: no invoice or contract access.

Every create, update, payment, void, document replacement, and status change records an audit event without exposing private storage keys.

## Error Handling

- File upload and invoice creation act as one user operation. If metadata creation fails after an upload, the API must clean up or quarantine the orphaned upload.
- Duplicate invoice numbers are rejected within the same event profile unless the earlier invoice is cancelled and the replacement is intentionally confirmed.
- Invalid amounts and impossible date combinations return field-level validation messages.
- File-open failures do not change invoice, payment, or review status.
- Concurrent payment updates are serialized or protected by a transaction so balances cannot be lost.

## Migration and Backfill

- Add the new tables, indexes, foreign keys, and `invoice` Business Document category in a forward-only migration.
- Do not automatically classify existing `other` documents as invoices.
- Existing files can be reclassified and attached to a new invoice record manually.
- Existing contract documents and contract lifecycle records remain unchanged.

## Testing

Implementation follows test-driven development.

Required coverage:

- database constraints and migrations;
- invoice balance and overdue calculations;
- deposit and paid state transitions;
- overpayment and voided-payment behavior;
- duplicate invoice protection;
- API authentication and role permissions;
- upload rollback/quarantine behavior;
- invoice workspace filters and attention counts;
- mobile card rendering;
- profile and booking summary cards;
- regression tests proving existing Business Documents and contract workflows still work.

Before completion, run focused tests, the relevant full workspace suites, type checking, and the production build.

## Out of Scope

- generating invoice PDFs;
- emailing or scheduling invoices;
- processing credit cards or ACH payments;
- Gmail-based automatic status updates;
- accounting-system synchronization;
- automatic late fees, taxes, or reminders;
- changing Adobe Sign behavior.

These can be added later without replacing the invoice ledger introduced here.

## Success Criteria

The feature is successful when staff can upload an invoice, link it to the correct profile and booking, record deposit and balance payments, see the accurate remaining amount and overdue state, and review the related contract status from both the shared workspace and the event record on desktop and mobile.
