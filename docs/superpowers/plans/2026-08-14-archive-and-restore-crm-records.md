# Archive and Restore CRM Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recoverable archive/restore controls for contacts, event profiles, and bookings while preserving all linked history and relationships.

**Architecture:** Add nullable `archived_at` timestamps to the three primary tables and a record-lifecycle service with explicit type-specific repository methods. Active query boundaries exclude archived rows; a dedicated authenticated archive endpoint lists and restores them. Detail pages use shared archive controls, while existing record-specific edit pages remain authoritative.

**Tech Stack:** PostgreSQL migrations, Drizzle ORM, TypeScript, Express, Zod, React, Wouter, Vitest, Testing Library, PGlite, pnpm.

## Global Constraints

- Contacts, profiles, and bookings are archived, never hard-deleted.
- Archiving one record must not archive connected records.
- Archived records are excluded from normal lists, search, caller matching, and Today.
- Linked activity history and relationships remain stored.
- Archived records can be viewed and restored without duplicate relationships.
- Every lifecycle mutation is authenticated, transactional, and audited.
- Tests must be written and observed failing before production changes.

---

### Task 1: Add archive state and lifecycle repository

**Files:**
- Create: `lib/db/migrations/033_crm_record_archiving.sql`
- Modify: `lib/db/src/migrations.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/src/features/record-lifecycle/record-lifecycle-input.ts`
- Create: `artifacts/api-server/src/features/record-lifecycle/record-lifecycle-types.ts`
- Create: `artifacts/api-server/src/features/record-lifecycle/record-lifecycle-repository.ts`
- Create: `artifacts/api-server/src/features/record-lifecycle/record-lifecycle-service.ts`
- Create: `artifacts/api-server/src/features/record-lifecycle/record-lifecycle.pglite.test.ts`

**Interfaces:**
- Produces: `RecordType = "contact" | "profile" | "booking"`
- Produces: `archive(recordType, recordId, at)`
- Produces: `restore(recordType, recordId, at)`
- Produces: `listArchived(): ArchivedRecordSummary[]`

- [ ] **Step 1: Write the failing real-database lifecycle test**

Seed one contact, profile, booking, their relationships, and activity history. Assert:

```ts
await service.archive("contact", contactId, now);
await service.archive("profile", organizationId, now);
await service.archive("booking", bookingId, now);
```

sets only each target’s `archived_at`, leaves related rows and activities intact, and records audit entries. Then restore all three and assert the same relationship IDs still exist exactly once.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/record-lifecycle/record-lifecycle.pglite.test.ts
```

Expected: FAIL because the migration columns and lifecycle service do not exist.

- [ ] **Step 3: Add the additive migration and schema fields**

Migration:

```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS contacts_archived_at_idx ON contacts (archived_at);
CREATE INDEX IF NOT EXISTS organizations_archived_at_idx ON organizations (archived_at);
CREATE INDEX IF NOT EXISTS bookings_archived_at_idx ON bookings (archived_at);
```

Register migration 033 after migration 032. Add nullable Drizzle timestamp fields to the three tables.

- [ ] **Step 4: Implement explicit lifecycle methods**

Lock the target row, return `RECORD_NOT_FOUND` when absent, update `archivedAt`, and write an audit entry in one transaction. Restore sets `archivedAt: null`. No method may update a related table except the audit table.

`listArchived` returns:

```ts
export type ArchivedRecordSummary = {
  id: string;
  type: "contact" | "profile" | "booking";
  name: string;
  archivedAt: Date;
};
```

- [ ] **Step 5: Run migration, lifecycle tests, and typechecks**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/record-lifecycle/record-lifecycle.pglite.test.ts
pnpm --filter @workspace/libs typecheck
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS with zero skipped lifecycle tests.

- [ ] **Step 6: Commit**

```bash
git add lib/db artifacts/api-server/src/features/record-lifecycle
git commit -m "feat: add recoverable CRM record archiving"
```

### Task 2: Exclude archived records from active workflows

**Files:**
- Modify: `artifacts/api-server/src/features/contacts/contact-repository.ts`
- Modify: `artifacts/api-server/src/features/contacts/contact-repository.test.ts`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`
- Create: `artifacts/api-server/src/features/event-profiles/event-profile-archive.test.ts`
- Modify: `artifacts/api-server/src/features/bookings/booking-repository.ts`
- Create: `artifacts/api-server/src/features/bookings/booking-archive.test.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`
- Create: `artifacts/api-server/src/features/follow-ups/today-query-archive.test.ts`
- Modify: `artifacts/api-server/src/features/caller-finder/caller-finder-service.ts`
- Modify: `artifacts/api-server/src/features/caller-finder/caller-finder-service.test.ts`
- Modify: `artifacts/api-server/src/features/contacts/quick-caller-service.ts`
- Modify: `artifacts/api-server/src/features/contacts/quick-caller-service.test.ts`
- Modify: `artifacts/api-server/src/routes/calendar.ts`
- Create: `artifacts/api-server/src/routes/calendar-archive.test.ts`

**Interfaces:**
- Consumes: nullable `archivedAt` fields
- Produces: active-only default list, detail, Today, calendar, caller-finder, and duplicate checks

- [ ] **Step 1: Write failing active-query tests**

For each repository/query, seed one active and one archived record. Assert archived records are absent from:

```ts
listContacts()
listOrganizations()
listBookings()
getTodayDashboard()
findCallerCandidates()
quickCallerDuplicateCheck()
calendarActivity()
```

Also assert direct active detail lookup returns not-found for an archived record, while the lifecycle repository can still retrieve it for the Archived records screen.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/contacts/contact-repository.test.ts   src/features/event-profiles/event-profile-archive.test.ts   src/features/bookings/booking-archive.test.ts   src/features/follow-ups/today-query-archive.test.ts   src/features/caller-finder/caller-finder-service.test.ts   src/features/contacts/quick-caller-service.test.ts   src/routes/calendar-archive.test.ts
```

Expected: FAIL because active queries include archived rows.

- [ ] **Step 3: Add explicit active predicates**

Use `isNull(table.archivedAt)` at every active record boundary. For joins, place the predicate on the joined record that controls visibility. Do not filter activity history rows or delete relationship rows.

Caller matching must exclude an archived contact and an archived parent profile. Today must exclude follow-ups belonging to an archived contact, profile, or booking. Calendar must exclude archived booking events but retain unrelated standalone activities.

- [ ] **Step 4: Run focused and expanded query tests**

Run the focused command from Step 2, then:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/today-query-archive.test.ts src/routes/caller-finder-zip.integration.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/contacts artifacts/api-server/src/features/event-profiles artifacts/api-server/src/features/bookings artifacts/api-server/src/features/follow-ups artifacts/api-server/src/features/caller-finder artifacts/api-server/src/routes/calendar.ts artifacts/api-server/src/routes/calendar-archive.test.ts
git commit -m "feat: hide archived records from active workflows"
```

### Task 3: Add lifecycle routes and Archived records page

**Files:**
- Create: `artifacts/api-server/src/routes/record-lifecycle.ts`
- Create: `artifacts/api-server/src/routes/record-lifecycle.test.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Create: `artifacts/adventure-zone/src/actions/record-lifecycle.ts`
- Create: `artifacts/adventure-zone/src/features/record-lifecycle/record-lifecycle-types.ts`
- Create: `artifacts/adventure-zone/src/pages/ArchivedRecordsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ArchivedRecordsPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`

**Interfaces:**
- Produces: `GET /record-lifecycle/archived`
- Produces: `POST /record-lifecycle/archive`
- Produces: `POST /record-lifecycle/restore`
- Produces: protected web route `/archived`

- [ ] **Step 1: Write failing authenticated API tests**

Assert all lifecycle endpoints return 401 without a session. Assert archive/restore validates:

```ts
{
  recordType: z.enum(["contact", "profile", "booking"]),
  recordId: z.string().uuid(),
}
```

Assert missing records return 404 and success returns the updated archive state.

- [ ] **Step 2: Run and verify route RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/record-lifecycle.test.ts
```

Expected: FAIL with 404 because routes are missing.

- [ ] **Step 3: Implement API routes and web actions**

Return stable envelopes:

```ts
{ ok: true, archivedRecords }
{ ok: true, record: { id, type, archivedAt } }
{ ok: false, error: "Record not found." }
```

Use the existing authenticated `apiGet` and `apiPost` helpers.

- [ ] **Step 4: Write failing Archived page tests**

Assert the page groups Contacts, Profiles, and Bookings, shows archived dates, restores only after confirmation, removes a successfully restored row immediately, and keeps the row with an inline error when restore fails.

- [ ] **Step 5: Run and verify UI RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ArchivedRecordsPage.test.tsx
```

Expected: FAIL because the page and route do not exist.

- [ ] **Step 6: Implement the page and navigation**

Add protected route `/archived`. Add `Archived records` under the existing Settings/navigation area. Use a single-column mobile layout with grouped cards and a `Restore` button. Confirmation text:

```ts
"Restore this record to normal lists and searches?"
```

- [ ] **Step 7: Run route/page tests and typechecks**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/record-lifecycle.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ArchivedRecordsPage.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/routes/record-lifecycle.ts artifacts/api-server/src/routes/record-lifecycle.test.ts artifacts/api-server/src/app.ts artifacts/adventure-zone/src/actions/record-lifecycle.ts artifacts/adventure-zone/src/features/record-lifecycle artifacts/adventure-zone/src/pages/ArchivedRecordsPage.tsx artifacts/adventure-zone/src/pages/ArchivedRecordsPage.test.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation/app-shell.tsx
git commit -m "feat: add archived records workspace"
```

### Task 4: Add archive controls to record detail pages

**Files:**
- Create: `artifacts/adventure-zone/src/components/record-lifecycle/archive-record-button.tsx`
- Create: `artifacts/adventure-zone/src/components/record-lifecycle/archive-record-button.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ContactDetailPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ContactDetailPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BookingDetailPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/BookingDetailPage.test.tsx`

**Interfaces:**
- Consumes: `archiveRecordAction(recordType, recordId)`
- Produces: confirmed Archive action and redirect to the relevant active list

- [ ] **Step 1: Write failing shared-control tests**

Assert the button displays the record-specific warning:

```ts
const warnings = {
  contact: "Archive this contact? Call history will remain, but the contact will leave normal lists and caller matching.",
  profile: "Archive this profile? Its contacts and bookings will remain active.",
  booking: "Archive this booking? Its profile, contacts, and history will remain.",
};
```

Confirm success redirects to `/contacts`, `/profiles`, or `/bookings`. Cancel does nothing. Failure stays on the page and shows an alert.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/record-lifecycle/archive-record-button.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement and integrate controls**

Place `Archive` beside the existing Edit action in all three detail headers. Use a rose/destructive secondary style, a minimum mobile tap height matching existing buttons, disabled state while archiving, and inline error text.

Keep existing `Edit contact`, `Edit profile`, and `Edit booking` links unchanged.

- [ ] **Step 4: Run page regressions, full typechecks, and builds**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run   src/components/record-lifecycle/archive-record-button.test.tsx   src/pages/ContactDetailPage.test.tsx   src/pages/EventProfilePage.test.tsx   src/pages/BookingDetailPage.test.tsx   src/pages/ArchivedRecordsPage.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/record-lifecycle artifacts/adventure-zone/src/pages/ContactDetailPage.tsx artifacts/adventure-zone/src/pages/ContactDetailPage.test.tsx artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx artifacts/adventure-zone/src/pages/BookingDetailPage.tsx artifacts/adventure-zone/src/pages/BookingDetailPage.test.tsx
git commit -m "feat: add archive controls to CRM records"
```

### Task 5: Final cross-feature verification

**Files:**
- Modify only files required by failures caused by Tasks 1–4.
- Do not mask failures with skips, exclusions, or weakened assertions.

**Interfaces:**
- Verifies all archive/restore contracts and existing CRM behavior.

- [ ] **Step 1: Run the complete relevant API suite**

```bash
pnpm --filter @workspace/api-server test
```

Expected: PASS except tests already documented as externally skipped by the repository.

- [ ] **Step 2: Run the complete web suite**

```bash
pnpm --filter @workspace/adventure-zone test
```

Expected: PASS.

- [ ] **Step 3: Run all workspace typechecks and production builds**

```bash
pnpm -r typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 4: Verify migration idempotency**

Apply migrations twice to a fresh PGlite/PostgreSQL test database and assert the second run succeeds without changing archive state.

- [ ] **Step 5: Commit any verified integration corrections**

```bash
git add lib/db artifacts/api-server/src/features/record-lifecycle artifacts/api-server/src/features/contacts artifacts/api-server/src/features/event-profiles artifacts/api-server/src/features/bookings artifacts/api-server/src/features/follow-ups artifacts/api-server/src/features/caller-finder artifacts/api-server/src/routes artifacts/adventure-zone/src/actions/record-lifecycle.ts artifacts/adventure-zone/src/features/record-lifecycle artifacts/adventure-zone/src/components/record-lifecycle artifacts/adventure-zone/src/pages artifacts/adventure-zone/src/App.tsx
git commit -m "fix: integrate CRM record lifecycle controls"
```

Skip this commit when no integration correction is needed.
