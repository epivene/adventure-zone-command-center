# Leg Manager Portal Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Leg Manager Portal in three independently testable releases while keeping the existing Command Center, bookings, calendar, routes, trips, and travel legs as the canonical source of truth.

**Architecture:** The portal is a second role-specific frontend experience inside the existing web app, not a second application or database. Owner/admin routes keep the existing owner bearer-token flow; leg-manager routes use leg-scoped password sessions enforced on the server. Manager-created operational data references existing `travelLegs`, `trips`, `tripStops`, and `bookings` by ID and supports offline queueing with idempotent client mutation IDs.

**Tech Stack:** TypeScript, React, Wouter, Express, Drizzle ORM/PostgreSQL, Vitest, Testing Library, browser IndexedDB/service worker, Node `crypto.scrypt`/HMAC.

## Global Constraints

- One manager per leg; no individual employee accounts.
- Leg managers may see only their own leg's private operational/financial data.
- Admin retains a master view across all legs and combined totals.
- Leg manager access is password-based and does not require Clerk.
- Passwords are stored as secure hashes, never plaintext.
- Changing a leg password or using Sign Out All Devices invalidates prior manager sessions.
- The official booking/calendar/route schedule is read-only to leg managers.
- Schedule changes are reported through a dedicated issue workflow.
- Mobile-first and usable with unreliable connectivity.
- Offline writes are queued and never silently discarded.
- Conflicting edits are surfaced instead of silently overwritten.
- Travel legs are dynamic and effectively unlimited; nine is not a product limit.
- Legs are archived/restored rather than removed from normal history.
- Archived manager access stops immediately.
- Existing bookings/calendar/routes/trips remain the canonical records; do not duplicate scheduled events into portal-owned tables.
- Seasons/trips are derived from schedule/route dates and remain admin-overridable.
- Payroll is out of scope.
- Real Square API and mandatory receipt OCR are out of scope for the initial portal delivery.

## Season/trip grouping invariant

Do not add a second manager-only season or event system. The portal groups history automatically using the existing route/trip/event dates:

- `trip` remains the existing canonical `trips` record and its `tripStops`.
- portal `seasonKey` is derived from the business-time-zone calendar year of the trip start date, falling back to the booking/event start date for scheduled events not yet attached to a trip.
- default display label is `${seasonKey} Season`.
- scheduled events assigned to a leg but not yet attached to a trip appear in an **Unassigned scheduled events** group rather than disappearing.
- admin edits the existing trip/stop/leg assignment to correct grouping; the manager portal updates from those canonical records.
- if a custom season label is later needed, add an admin-only label override to the canonical trip/season presentation rather than copying bookings into a portal-owned season table.

This satisfies “calendar/route/scheduled dates drive it, but admin can edit it” without inventing a duplicate schedule.

## Offline privacy/session invariant

A device may use cached data only for the currently authenticated leg and only while the locally stored manager token has not reached its signed `expiresAt`. Manager sign-out clears leg-private IndexedDB caches and queued blobs from the device. Password reset, Sign Out All Devices, or leg archival is enforced as soon as the device reconnects and the next authenticated request validates the server-side `sessionVersion`/archive state. Never show cached data from one leg after a different leg signs in on the same device.

## Receipt image storage invariant

Release 2 stores receipt metadata separately from image bytes. The server-side receipt service must use the app's configured object-storage mechanism rather than storing image blobs in PostgreSQL. Persist only an object key/storage reference and upload status in `leg_receipts`. If the repository has no reusable object-storage adapter on the implementation branch, create `artifacts/api-server/src/features/leg-manager/leg-manager-object-storage.ts` as the single adapter boundary and wire it to the deployment's existing object-storage configuration; do not scatter provider-specific upload code through routes/components.

## Implementation-time migration allocation

The child plans use early numeric migration names as logical examples. **Do not create those literal filenames.** Current `main` already has migrations through `036_event_family_suggestion_hash_identity.sql`. If Release 1 starts from the current main line, allocate the portal migrations as follows:

- `037_unlimited_travel_legs.sql`
- `038_leg_manager_access.sql`
- `039_leg_schedule_issues.sql`
- `040_leg_manager_finance.sql`
- `041_leg_crew.sql`
- `042_event_manager_reviews.sql`
- `043_leg_incidents.sql`

Before each release branch begins, fetch latest `main`. If another migration has landed and one of these prefixes is occupied, shift the remaining portal migrations forward together to the next unused sequential prefixes and update that release's plan paths before coding. Never reuse an existing migration filename.

## Settlement event naming invariant

Release 2 settlement math combines personal expenses with cash-ledger entries. The canonical cash-entry kinds are:

```ts
type LegCashEntryKind =
  | "event_cash_collected"
  | "expense_paid_cash"
  | "advance_received"
  | "cash_turned_in"
  | "cash_returned"
  | "manager_reimbursed"
  | "adjustment";
```

`manager_reimbursed` is the canonical name for money Adventure Zone pays back to the manager. Any child-plan example using `manager_repaid` means `manager_reimbursed` and must be implemented with the canonical name above.

Settlement effects are explicit:

- personal expense -> increases owner owes manager;
- manager reimbursed -> decreases owner owes manager;
- advance received -> increases manager owes owner/cash to account for;
- Adventure Zone cash expense -> decreases manager owes owner/cash to account for;
- cash turned in or returned -> decreases manager owes owner/cash to account for;
- Adventure Zone debit expense -> no personal settlement effect.

---

## Delivery order

### Release 1 — Portal Foundation

Plan: `docs/superpowers/plans/2026-08-15-leg-manager-portal-foundation.md`

Produces a usable leg-only portal with unlimited/archiveable legs, leg passwords, server-enforced scope, route/calendar read-only data, schedule issue reporting, and the offline queue/sync foundation.

**Exit gate:** A manager can sign in on a phone, see only their leg's current trip/events, see scheduled-but-unassigned events, report a schedule issue offline, reconnect, sync it once, and the admin can see/resolve it. Archiving the leg or resetting access prevents the old token from continuing to use the portal.

### Release 2 — Money, Receipts, Mileage, and Settlement

Plan: `docs/superpowers/plans/2026-08-15-leg-manager-portal-money.md`

Adds event/place income, manual Square totals, expenses, payment methods, receipt photos, cash flow, owner/manager settlement, mileage, RV park, food, and maintenance data. All records are leg-scoped, can attach to a trip/segment/event, and use the Release 1 offline mutation pipeline.

**Exit gate:** A manager can record income and expenses offline, attach a receipt, classify payment source, record cash turned in, and see a mathematically explainable settlement balance and trip/segment totals after sync. Admin can inspect the same ledger across all legs.

### Release 3 — Crew, Event Reviews, and Incidents

Plan: `docs/superpowers/plans/2026-08-15-leg-manager-portal-crew-aftermath.md`

Adds the shared seasonal-worker directory, location-based crew lookup, work history, rehire warning status, post-event review tasks, 0–5 star ratings, and incident records/attachments.

**Exit gate:** A manager can find prior workers near an upcoming event, add a local worker, record a completed event review and incident offline, and see that history appear on the admin side without gaining access to another leg's private finances.

---

## Dependency rules

Release 2 depends on the leg-manager auth, authorization helper, portal shell, sync queue, and idempotent mutation conventions from Release 1. Release 3 depends on the same foundation but is otherwise independent of Release 2's accounting math; it may start only after Release 1 is merged and stable.

Do not begin the real Square API integration or receipt OCR while these releases are under active construction. Manual Square fields and receipt images must use stable schemas so later integrations can populate existing records rather than force a migration/rewrite.

## Integration strategy

Each release gets its own feature branch, focused tests, production builds, PR, and merge. Do not stack all three releases into one PR. The owner/admin experience must remain deployable after each release.

Recommended branches:

- `feature/leg-manager-foundation`
- `feature/leg-manager-money`
- `feature/leg-manager-crew-aftermath`

Before Release 1 implementation starts, merge or rebase onto the latest `main`, including the Today post-event follow-up fix if PR #100 has landed.

## Final acceptance checklist

The portal is considered initially complete only when all three release exit gates pass and these cross-release invariants hold:

- No hard-coded 1–9 leg limit remains in schema, API, service, or UI.
- Archived legs are hidden by default and visible through a deliberate View Archived control.
- Leg-manager tokens cannot fetch another leg's private records even with hand-edited URLs or payloads.
- Official schedule data cannot be changed through manager endpoints.
- Scheduled events assigned to the manager's leg remain visible even before they have been attached to a trip.
- Offline queued mutations are idempotent and duplicate-free after retries.
- Manager sign-out/leg switching cannot expose the prior leg's cached private data.
- Financial summaries are derived from ledger rows, not editable summary fields.
- Receipt-image upload failure cannot delete the expense or receipt metadata.
- Event reviews and crew histories preserve individual entries over time instead of overwriting one global score/note.
- Admin can inspect every leg and combined totals while leg managers stay scoped.
