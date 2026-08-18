# Unified Finance & Reporting Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one finance/reporting system where manager-submitted expenses, receipt photos, event reports, between-event travel reports, and later season/tax reports all derive from the same source records.

**Architecture:** Keep `leg_expenses`, `leg_receipts`, mileage, income, trips, and trip segments as the source of truth. Add only the metadata/audit structures needed for admin corrections and assignment provenance, then build normalized report views over those records rather than copying finance data into separate report tables.

**Tech Stack:** TypeScript, React, Express, Drizzle ORM, PostgreSQL, Google Cloud Storage signed URLs, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-finance-reporting-system-design.md`

## Global Constraints

- Do not create a second finance database or duplicate expense rows for reports.
- Existing manager offline receipt/expense submission must continue to work.
- Receipt-image enrichment failures must not blank finance lists or event reports.
- Explicit manager/admin assignments outrank automatic assignment.
- Ambiguous automatic assignment remains General / Unassigned.
- Admin edits change effective values but preserve original history through append-only audit records.
- Event and travel reports must flag source-data changes after review/finalization rather than silently becoming authoritative again.
- Existing finance records and receipt rows must remain valid; initial rollout must be non-destructive.
- All implementation work is test-first.

---

## Release sequence

### Release 1 — Finance Evidence & Admin Corrections

**Outcome:** Admin can inspect every manager-submitted expense with its receipt photo/details, edit incorrect fields with audit history, see General / Unassigned records, and inspect event-linked expenses directly inside Event Wrap-up.

**Detailed plan:** `docs/superpowers/plans/2026-08-17-finance-reporting-release-1-evidence.md`

Release 1 owns:

- normalized admin finance record model
- receipt signed-read URL enrichment with graceful fallback
- finance audit table/repository
- admin expense edits and assignment edits
- expanded Finance workspace
- Event Wrap-up Expenses & receipts section
- source-change propagation for reviewed event wrap-ups when finance source data changes

Do **not** start automatic travel assignment in Release 1.

### Release 2 — Between-Event Travel Reporting

**Outcome:** Expenses/mileage submitted between Event A checkout and Event B check-in are automatically associated with the correct travel period when confidence is high, and admins get a first-class between-event Travel Report.

Release 2 owns:

- inspect current `tripSegments` model against the approved design before changing schema
- checkout → next check-in travel-window resolver
- route/scheduled fallback windows
- automatic assignment provenance and confidence reason
- idempotent re-evaluation of previously unassigned records
- admin travel reassignment
- Travel Report API/UI
- report reviewed/finalized + source-change behavior

Before implementation, create:

`docs/superpowers/plans/2026-08-17-finance-reporting-release-2-travel.md`

That plan must explicitly decide whether `tripSegments` can represent Event A → Event B windows without a dedicated travel-period table.

### Release 3 — Season / Tax Reporting

**Outcome:** Admin can filter and aggregate the same source records by year/date/category/payment source/leg/manager/event/travel scope, drill back to receipt evidence, and export accounting data.

Release 3 owns:

- year/custom date filters
- category/payment/leg/manager filters
- Event vs Travel vs General totals
- receipt completeness metrics
- drill-down from aggregates to source records
- CSV export first
- later report/PDF packet hooks without copying finance rows

Before implementation, create:

`docs/superpowers/plans/2026-08-17-finance-reporting-release-3-tax.md`

---

## Cross-release interfaces

Release 1 should establish names later releases reuse:

```ts
export type FinanceAssignmentSource =
  | "legacy"
  | "explicit"
  | "automatic"
  | "admin"
  | "unassigned";

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
};
```

Release 2 may extend this with travel-period labels/confidence, but should not replace the normalized record contract.

---

## Release gates

Do not begin the next release until the current release has:

1. its focused test suite passing locally,
2. a clean current-main diff immediately before PR creation,
3. manual confirmation that existing manager receipt submission still works,
4. no destructive migration behavior,
5. explicit reporting of GitHub Actions status; a zero-step/billing-blocked workflow is not a green CI result.

## Final system acceptance

The full program is complete when:

- manager submissions remain one source record each,
- admins can always drill from totals to individual receipt evidence,
- event expenses appear inside Event Wrap-up,
- between-event travel records are automatically filed when confidence is sufficient,
- ambiguous records stay General / Unassigned,
- admin corrections are auditable,
- Event/Travel/Season reports reconcile to source records without duplicates,
- receipt images remain linked through reassignment/editing,
- finalized reports visibly require review when source data changes.
