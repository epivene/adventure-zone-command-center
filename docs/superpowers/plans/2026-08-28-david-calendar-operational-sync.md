# David Operational Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `TheAdventureZone12@gmail.com`, import David's existing operational calendar into the CRM without duplicating event profiles, and then keep confirmed app bookings synchronized back to his calendar in the familiar Adventure Zone format.

**Architecture:** Extend the existing Google Workspace connection/calendar sync system with a second operational calendar source and a write-capable confirmed-booking sync adapter. Initial import parses David's legacy title/description conventions, matches and updates existing event profiles first, preserves Google event IDs, and separates actual `EVENT DATES` from the larger Google reserved block. Going forward, the app is authoritative; meaningful manual Google edits become review items instead of silently overwriting CRM data.

**Tech Stack:** TypeScript, Express 5, PostgreSQL/Drizzle, `googleapis`, React/Vite/Wouter, TanStack Query, Vitest/PGlite/Supertest.

**Spec:** `docs/superpowers/specs/2026-08-28-leg-auto-assignment-and-david-calendar-sync-design.md`

## Global Constraints

- David's source remains separate from Amy's `zone.pirate.warrior@gmail.com` source.
- Import must match existing profiles before creating anything new.
- Plain manager-prefixed operational rows are confirmed/booked; `PLACEHOLDER`, `CANCELLED`, `NEED CONTACT`, and research/action rows are not blindly confirmed.
- Multiple package rows for one event map to one CRM event profile.
- `EVENT DATES` are actual public dates; the Google bar span is the operational reserved travel/setup/teardown block.
- The app becomes source of truth after cleanup.
- Cold leads and ordinary potentials are not pushed to David's confirmed calendar.
- Confirmed bookings sync using a familiar manager-first title and labeled description format.
- Existing Google event IDs are reused on update.
- Core calendar edits from Google become review items rather than last-write-wins overwrites.
- Google failure never deletes or downgrades CRM data.

---

### Task 1: Add operational-calendar connection role and write scope

**Files:**
- Modify existing Google Workspace connection/scope schema and OAuth configuration used by `docs/superpowers/plans/2026-08-22-google-workspace-connection-scope.md`.
- Modify: `docs/operations/google-workspace-readonly-setup.md` or replace with a targeted operational-calendar setup section.
- Add focused connection/scope tests in the existing Google Workspace feature tests.

**Interfaces:**
- Add a source/connection role such as `operational_calendar` with an explicit calendar identifier/email.
- Preserve existing read-only Gmail/Drive behavior; calendar write permission is granted only to the operational calendar connection.

- [ ] **Step 1: Write failing tests** proving Amy and David connections remain distinct and only David's operational-calendar connection exposes calendar write capability.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Extend OAuth/scope validation minimally** to request the calendar mutation scope only for this connection role.
- [ ] **Step 4: Run connection tests and typecheck.**
- [ ] **Step 5: Commit:** `git commit -m "feat: add operational calendar connection role"`.

---

### Task 2: Parse legacy David calendar titles and descriptions

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/david-calendar-parser.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/david-calendar-parser.test.ts`

**Interfaces:**
- Produces:
```ts
export type ParsedOperationalCalendarEvent = {
  managerToken: string | null;
  eventName: string;
  city: string | null;
  region: string | null;
  packageKey: "zone" | "pirates" | "warrior" | "unknown";
  calendarState: "confirmed" | "placeholder" | "cancelled" | "action_required";
  actualEventDateText: string | null;
  contactText: string | null;
  addressText: string | null;
  attractionText: string | null;
  additionalInfo: string | null;
  paymentInfo: string | null;
  invoiceSent: string | null;
  contractSigned: string | null;
  depositReceived: string | null;
  amountDue: string | null;
  originalDescription: string | null;
};
```

- [ ] **Step 1: Write tests from the approved screenshots** covering `KRISTY ... (Zone)`, `HULK ...`, `MIKEY Blanding City Fall Festival - Blanding UT (Zone)`, `PLACEHOLDER`, `CANCELLED`, `NEED CONTACT & PH`, and labeled description fields.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement tolerant parsing** that never invents missing values and always preserves the original description.
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit:** `git commit -m "feat: parse legacy operational calendar events"`.

---

### Task 3: Match imported rows to existing event profiles

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-matcher.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-matcher.pglite.test.ts`
- Reuse existing event-profile/family matching utilities where available.

**Interfaces:**
- Produces:
```ts
export type OperationalMatch =
  | { kind: "matched"; eventProfileId: string; confidence: "high" | "medium" }
  | { kind: "review"; candidateProfileIds: string[]; reason: string }
  | { kind: "new" };
```

- [ ] **Step 1: Seed tests** for exact event family + city + dates, existing profile with slightly different title, ambiguous same-name events, and no match.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement matching using event family/profile identity, normalized name, city/state, actual dates, manager/leg clue, and package rows as evidence.**
- [ ] **Step 4: Ensure ambiguous matches become review items rather than new duplicates.**
- [ ] **Step 5: Run tests and commit:** `git commit -m "feat: match operational calendar rows to profiles"`.

---

### Task 4: Persist source identity, actual dates, and reserved blocks

**Files:**
- Modify Google Calendar archive/source schema from the existing calendar sync plan.
- Modify booking/event-profile schema if an explicit operational reserved start/end is not already present.
- Add migration and schema contract tests.

**Interfaces:**
- Persist per Google row: connection ID, calendar ID, Google event ID, event-profile ID, package key, source checksum/etag, reserved start/end.
- Persist actual public dates separately from reserved operational dates.

- [ ] **Step 1: Write schema tests** proving one CRM event may link to several Google package rows and Google event IDs are unique within a calendar source.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add minimal schema/migration.**
- [ ] **Step 4: Run migration/schema tests.**
- [ ] **Step 5: Commit:** `git commit -m "feat: persist operational calendar linkage"`.

---

### Task 5: Import and repair current David calendar schedule

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-service.pglite.test.ts`
- Extend existing calendar sync worker/checkpoint flow.

**Interfaces:**
```ts
export class OperationalCalendarImportService {
  importWindow(input: { connectionId: string; calendarId: string; from: Date; to: Date }): Promise<{
    matched: number;
    updated: number;
    created: number;
    review: number;
  }>;
}
```

- [ ] **Step 1: Write tests** proving existing profiles are updated, package rows merge to one profile, manager prefix repairs leg assignment, placeholder/cancelled statuses are preserved, actual and reserved dates are separated, and ambiguous events enter review.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement bounded import using the parser + matcher + linkage repository.**
- [ ] **Step 4: Preserve Google event IDs so future app->Google sync adopts existing rows.**
- [ ] **Step 5: Run tests and commit:** `git commit -m "feat: import David operational calendar"`.

---

### Task 6: Render familiar calendar titles and descriptions from app data

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-renderer.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-renderer.test.ts`

**Interfaces:**
```ts
export type RenderedOperationalCalendarRow = {
  packageKey: "zone" | "pirates" | "warrior";
  summary: string;
  description: string;
  reservedStart: Date;
  reservedEnd: Date;
};

export function renderOperationalCalendarRows(input: ConfirmedBookingProjection): RenderedOperationalCalendarRow[];
```

- [ ] **Step 1: Write tests** for manager-first title format, city/state, package shorthand, Blanding-style labeled fields, multi-package rows, and distinct `EVENT DATES` vs reserved block.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement deterministic rendering close to the legacy format without inventing unknown contact/payment fields.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit:** `git commit -m "feat: render operational calendar rows"`.

---

### Task 7: Push confirmed bookings to David's calendar

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-write-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-write-service.test.ts`
- Modify the confirmed booking mutation flow to request sync after successful CRM commit.

**Interfaces:**
```ts
export class OperationalCalendarWriteService {
  syncConfirmedBooking(eventProfileId: string): Promise<void>;
  removeOrCancelBooking(eventProfileId: string, reason: "cancelled" | "unconfirmed"): Promise<void>;
}
```

- [ ] **Step 1: Mock Google Calendar API tests** proving confirmed bookings create/update rows, existing imported event IDs are reused, package rows update independently, and cold/potential events are never written.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement idempotent create/update using stored Google event IDs and etags/checksums.**
- [ ] **Step 4: Trigger sync only after CRM transaction success; failures create visible retry state and leave CRM unchanged.**
- [ ] **Step 5: Run tests and commit:** `git commit -m "feat: sync confirmed bookings to David calendar"`.

---

### Task 8: Detect manual Google changes without overwriting CRM

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-change-review.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-change-review.test.ts`
- Extend existing Google Workspace suggestions/review storage and profile projection.

**Interfaces:**
- Produces review items for changes to actual/reserved dates, location, manager/leg, package, or status.

- [ ] **Step 1: Write tests** showing meaningful manual edits generate `Calendar change detected`; harmless whitespace/formatting does not; app-owned core values remain untouched until review acceptance.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement canonical comparison against the last app-synced checksum/snapshot.**
- [ ] **Step 4: Project review items onto owner/Office event profiles.**
- [ ] **Step 5: Run tests and commit:** `git commit -m "feat: review manual operational calendar changes"`.

---

### Task 9: Add connection/import/sync controls to admin UI

**Files:**
- Extend existing Google Workspace admin/settings pages and event profile Google Calendar panel.
- Add frontend tests.

- [ ] **Step 1: Write tests** for separate Amy/David connection status, `Connect operational calendar`, import window action, sync status, retry, and calendar-change review.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement UI using existing Google Workspace admin patterns.**
- [ ] **Step 4: Ensure manager-facing views do not expose Google metadata beyond operational event data they are already permitted to see.**
- [ ] **Step 5: Run tests and commit:** `git commit -m "feat: manage David calendar sync"`.

---

### Task 10: End-to-end verification and initial import runbook

- [ ] Run parser, matcher, import, renderer, writer, and change-review tests.
- [ ] Run existing Google Workspace calendar/profile incremental suites.
- [ ] Run API/frontend typechecks and builds.
- [ ] Verify a fixture matching the screenshot behavior: Blanding public date Sep 12 with reserved Sep 10–13, manager `MIKEY`, package `Zone`, PrePaid $9,000, contract/deposit pending.
- [ ] Verify multi-package event creates one CRM event profile and multiple linked Google rows.
- [ ] Document the safe first production sequence: connect David account -> bounded upcoming import -> review ambiguous matches -> approve cleanup -> enable app->calendar writes -> enable incremental change detection.
- [ ] Commit any final verification docs/tests as `docs: add operational calendar rollout runbook`.