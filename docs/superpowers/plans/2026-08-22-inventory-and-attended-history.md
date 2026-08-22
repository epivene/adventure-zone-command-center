# Inventory + Attended History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable asset identity fields for the nine known inflatables and import the attended-calendar workbook into reviewable, profile-linked historical attendance without creating duplicate profiles or silently guessing uncertain matches.

**Architecture:** Extend the existing `resources` model with optional manufacturer identity fields, then stage the nine source assets in a small candidate table so exact existing-resource matches can be applied without inventing unknown operational values. Separately, convert the uploaded workbook into committed normalized source rows, stage one row per event/month occurrence plus one year-status record per X/B/C cell, run conservative profile/location matching, and require owner review before uncertain rows become historical attendance.

**Tech Stack:** TypeScript, Express, React/Vite, PostgreSQL/Drizzle, Zod, Vitest/Testing Library, existing resource settings, organizations/event families/`organization_locations`, existing forgiving organization search, artifact_tool for one-time workbook extraction during implementation.

**Spec:** `docs/superpowers/specs/2026-08-22-business-drive-source-integration-design.md`

## Global Constraints

- The source asset list contains nine known inflatables; it is not assumed to be the complete company inventory.
- Never fabricate setup time, teardown time, travel-leg assignment, package tags, or operational availability merely to create an asset from the source list.
- Match an existing resource before proposing a new one.
- Exact unique name matches may apply year/make/model/serial metadata automatically; ambiguous/no-match candidates remain owner-review items.
- Asset identity fields remain editable and auditable.
- The attended workbook has columns `Month`, `Event Name`, `Location`, and years 2020-2030; source data currently contains 107 event/month rows and 193 status cells: 184 `X`, 1 `B`, and 8 `C`.
- Workbook meanings are exactly: `X = attended`, `B = blacklisted`, `C = cancelled last minute`.
- Repeated names in different months/locations are separate source occurrences until review proves otherwise.
- Blacklisted history is sensitive owner-level history and must not automatically set Do Not Call.
- Confident match adds history to the existing profile/location; possible match remains review; no match becomes a new-profile/location candidate only after owner action.
- Original event name/location text and workbook row provenance must be preserved.

---

### Task 1: Extend resource identity fields and settings UI

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/20260822_resource_asset_identity.sql`
- Modify: `artifacts/api-server/src/features/resources/resource-input.ts`
- Modify: `artifacts/api-server/src/features/resources/resource-repository.ts`
- Modify: `artifacts/adventure-zone/src/features/resources/resource-repository.ts`
- Modify: `artifacts/adventure-zone/src/components/resources/resource-inventory-editor.tsx`
- Test: `artifacts/api-server/src/features/resources/resource-asset-identity.test.ts`
- Test: `artifacts/adventure-zone/src/components/resources/resource-inventory-editor.test.tsx`

**Interfaces:**

Add these fields to the existing resource input and inventory-record types:

```ts
yearBuilt: number | null;
make: string | null;
model: string | null;
serialNumber: string | null;
inspectionIdentityNotes: string | null;
```

Validation:

```ts
yearBuilt: z.number().int().min(1900).max(2100).nullable(),
make: z.string().trim().max(120).nullable(),
model: z.string().trim().max(120).nullable(),
serialNumber: z.string().trim().max(120).nullable(),
inspectionIdentityNotes: z.string().trim().max(2000).nullable(),
```

- [ ] **Step 1: Write failing input/repository tests**

```ts
expect(resourceInputSchema.safeParse({ ...validResource, yearBuilt: 2019, make: "Inflatable", model: "Maze", serialNumber: "001", inspectionIdentityNotes: null }).success).toBe(true);
expect(resourceInputSchema.safeParse({ ...validResource, yearBuilt: 1800 }).success).toBe(false);
```

Assert list/upsert returns the same identity fields.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/resources/resource-asset-identity.test.ts
```

- [ ] **Step 3: Add nullable columns + indexes**

Add `year_built`, `make`, `model`, `serial_number`, `inspection_identity_notes`. Add a non-unique index on normalized/lower serial number only if present; do not assume manufacturer serial numbers are globally unique.

- [ ] **Step 4: Add an `Asset identity` section to the resource editor**

Keep operational resource fields separate from identity fields. Serial/year data must not change package count, availability, or travel behavior.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/resources/resource-asset-identity.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/resources/resource-inventory-editor.test.tsx
pnpm run typecheck
git add lib/db/src/schema/index.ts lib/db/migrations/20260822_resource_asset_identity.sql artifacts/api-server/src/features/resources/resource-input.ts artifacts/api-server/src/features/resources/resource-repository.ts artifacts/adventure-zone/src/features/resources/resource-repository.ts artifacts/adventure-zone/src/components/resources/resource-inventory-editor.tsx artifacts/api-server/src/features/resources/resource-asset-identity.test.ts artifacts/adventure-zone/src/components/resources/resource-inventory-editor.test.tsx
git commit -m "feat: add inflatable asset identity fields"
```

---

### Task 2: Stage and match the nine source inflatable identities

**Files:**
- Create: `lib/db/src/resource-source-candidate-schema.ts`
- Create: `lib/db/migrations/20260822_resource_source_candidates.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Create: `artifacts/api-server/src/features/resources/resource-source-candidates.ts`
- Create: `artifacts/api-server/src/features/resources/resource-source-candidate-seed.ts`
- Test: `artifacts/api-server/src/features/resources/resource-source-candidate-seed.test.ts`

**Schema:**

```text
resource_source_candidates
  id uuid PK
  source_document_id uuid NOT NULL FK business_source_documents cascade
  source_name text NOT NULL
  normalized_name text NOT NULL
  year_built integer NOT NULL
  make text NOT NULL
  model text NOT NULL
  serial_number text NOT NULL
  matched_resource_id uuid NULL FK resources set null
  match_state text NOT NULL CHECK pending|exact_match|applied|ignored
  match_note text NULL
  created_at / updated_at timestamptz
  UNIQUE(source_document_id, serial_number)
```

**Exact source data:**

```ts
const SOURCE_ASSETS = [
  { name: "Labyrinth Maze", yearBuilt: 2019, make: "Inflatable", model: "Maze", serialNumber: "001" },
  { name: "Choo Choo Playhouse", yearBuilt: 2018, make: "Inflatable", model: "Train", serialNumber: "002" },
  { name: "Slide From The Castle", yearBuilt: 2018, make: "Inflatable", model: "3 In 1 Combo", serialNumber: "003" },
  { name: "Beautiful Balloon", yearBuilt: 2020, make: "Inflatable", model: "Combo", serialNumber: "004" },
  { name: "Arctic Blast", yearBuilt: 2020, make: "Inflatable", model: "Slide", serialNumber: "005" },
  { name: "Run For The Hills", yearBuilt: 2018, make: "Inflatable", model: "Obstacle Course", serialNumber: "006" },
  { name: "Purple House", yearBuilt: 2019, make: "Inflatable", model: "Combo", serialNumber: "007" },
  { name: "Eliminator", yearBuilt: 2019, make: "Inflatable", model: "Interactive Amusement", serialNumber: "008" },
  { name: "Take Me Out To The Ballgame", yearBuilt: 2018, make: "Inflatable", model: "Slide", serialNumber: "009" },
] as const;
```

**Matching rule:**

```ts
function normalizeAssetName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
```

If exactly one existing non-archived resource has the same normalized name, mark `exact_match`; if zero or multiple matches, keep `pending`. Do not fuzzy-auto-match different names.

- [ ] **Step 1: Write candidate seed/match tests**

Assert nine candidate rows are seeded once; exact unique name sets `matchedResourceId`; no match stays pending; two same-normalized resources stay pending.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/resources/resource-source-candidate-seed.test.ts
```

- [ ] **Step 3: Implement schema/seed/matcher**

Reference the `Inflatable List.pdf` source-document row from Phase 1 by `original_filename`, not by a hard-coded UUID.

- [ ] **Step 4: Auto-apply exact unique matches only**

For `exact_match`, update only nullable identity fields or fields already equal to the same source value. If an existing resource has conflicting non-null year/make/model/serial data, leave the candidate in `pending` with a conflict note.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/resources/resource-source-candidate-seed.test.ts
pnpm run typecheck
git add lib/db/src/resource-source-candidate-schema.ts lib/db/migrations/20260822_resource_source_candidates.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/resources/resource-source-candidates.ts artifacts/api-server/src/features/resources/resource-source-candidate-seed.ts artifacts/api-server/src/features/resources/resource-source-candidate-seed.test.ts
git commit -m "feat: stage source inflatable identities"
```

---

### Task 3: Add owner review for unmatched resource candidates

**Files:**
- Create: `artifacts/api-server/src/routes/resource-source-candidates.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/adventure-zone/src/pages/SettingsPackagesResourcesPage.tsx`
- Create: `artifacts/adventure-zone/src/components/resources/resource-source-candidate-review.tsx`
- Test: `artifacts/api-server/src/routes/resource-source-candidates.test.ts`
- Test: `artifacts/adventure-zone/src/components/resources/resource-source-candidate-review.test.tsx`

**Owner routes:**

```text
GET  /settings/resource-source-candidates
POST /settings/resource-source-candidates/:candidateId/link { resourceId }
POST /settings/resource-source-candidates/:candidateId/ignore { reason }
```

Link behavior copies only year/make/model/serial identity into the chosen resource after presenting any existing conflicting values. Do not add a `Create resource automatically` endpoint because the source file does not provide required setup/teardown/transfer/package configuration.

- [ ] **Step 1: Write strict link/ignore tests**

Link to unknown resource -> 404. Linking conflicting identity -> 409 with current/source values. Ignore requires a reason.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/resource-source-candidates.test.ts
```

- [ ] **Step 3: Implement owner-only routes**

Mount after owner middleware.

- [ ] **Step 4: Add a collapsed `Imported asset details` section to Packages & Resources**

Show source name, year/make/model/serial, suggested match, status, Link, Ignore, and a shortcut to create a normal resource manually if no resource exists. Creating the resource must still use the existing full resource form.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/resource-source-candidates.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/resources/resource-source-candidate-review.test.tsx
pnpm run typecheck
git add artifacts/api-server/src/routes/resource-source-candidates.ts artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/pages/SettingsPackagesResourcesPage.tsx artifacts/adventure-zone/src/components/resources/resource-source-candidate-review.tsx artifacts/api-server/src/routes/resource-source-candidates.test.ts artifacts/adventure-zone/src/components/resources/resource-source-candidate-review.test.tsx
git commit -m "feat: review imported inflatable identities"
```

---

### Task 4: Add attendance import/history schema

**Files:**
- Create: `lib/db/src/event-attendance-history-schema.ts`
- Create: `lib/db/migrations/20260822_event_attendance_history.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Test: `artifacts/api-server/src/features/attendance/event-attendance-schema.test.ts`

**Schema:**

```text
attendance_import_rows
  id uuid PK
  source_document_id uuid NOT NULL FK business_source_documents cascade
  source_row_number integer NOT NULL
  month text NOT NULL
  original_event_name text NOT NULL
  original_location text NOT NULL
  normalized_event_name text NOT NULL
  normalized_location text NOT NULL
  matched_organization_id uuid NULL FK organizations set null
  matched_location_id uuid NULL FK organization_locations set null
  match_state text NOT NULL CHECK pending|confident|approved|new_profile_candidate|rejected
  match_confidence numeric(4,3) NULL
  match_reason text NULL
  created_at / updated_at
  UNIQUE(source_document_id, source_row_number)

attendance_import_year_statuses
  id uuid PK
  import_row_id uuid NOT NULL FK cascade
  year integer NOT NULL
  status text NOT NULL CHECK attended|blacklisted|cancelled_last_minute
  UNIQUE(import_row_id, year)

event_attendance_history
  id uuid PK
  organization_id uuid NOT NULL FK organizations restrict
  organization_location_id uuid NULL FK organization_locations set null
  source_import_row_id uuid NOT NULL FK attendance_import_rows restrict
  year integer NOT NULL
  month text NOT NULL
  status text NOT NULL CHECK attended|blacklisted|cancelled_last_minute
  original_event_name text NOT NULL
  original_location text NOT NULL
  approved_by text NOT NULL
  approved_at timestamptz NOT NULL
  created_at timestamptz NOT NULL
  UNIQUE(source_import_row_id, year)
```

- [ ] **Step 1: Write failing schema tests**

Assert blacklisted is an attendance-history status only and there is no FK or trigger to Do Not Call/contact-preference state.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/attendance/event-attendance-schema.test.ts
```

- [ ] **Step 3: Implement migration/exports**

Index import match state, normalized event/location, history organization/year, and history status/year.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm run typecheck
git add lib/db/src/event-attendance-history-schema.ts lib/db/migrations/20260822_event_attendance_history.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/attendance/event-attendance-schema.test.ts
git commit -m "feat: add structured attendance history model"
```

---

### Task 5: Convert the uploaded workbook to a committed normalized source fixture

**Files:**
- Create during execution: `artifacts/api-server/src/features/attendance/data/adventure-zone-attended-calendar-2026.json`
- Create: `artifacts/api-server/src/features/attendance/attendance-source-fixture.ts`
- Test: `artifacts/api-server/src/features/attendance/attendance-source-fixture.test.ts`

**Source workbook contract:**

```text
Sheet1!A1:N129
A = Month
B = Event Name
C = Location
D:N = years 2020..2030
Legend: X=Attended, B=Blacklisted, C=Cancelled Last Minute
Expected event/month rows: 107
Expected status entries: 193
Expected status counts: attended=184, blacklisted=1, cancelled_last_minute=8
```

- [ ] **Step 1: Write fixture validation test first**

```ts
it("preserves the complete attended-calendar source", () => {
  expect(source.rows).toHaveLength(107);
  const statuses = source.rows.flatMap((row) => row.statuses);
  expect(statuses).toHaveLength(193);
  expect(statuses.filter((x) => x.status === "attended")).toHaveLength(184);
  expect(statuses.filter((x) => x.status === "blacklisted")).toHaveLength(1);
  expect(statuses.filter((x) => x.status === "cancelled_last_minute")).toHaveLength(8);
});
```

- [ ] **Step 2: Extract the workbook with artifact_tool, not openpyxl/pandas**

Use the uploaded `/mnt/data/Adventure Zone Attended Calendar.xlsx`. Parse month header rows, then event rows beneath them. Preserve exact source strings and 1-based spreadsheet row numbers. Ignore blank year cells; map only exact X/B/C values.

Output shape:

```json
{
  "sourceFile": "Adventure Zone Attended Calendar.xlsx",
  "sheet": "Sheet1",
  "rows": [
    {
      "sourceRowNumber": 4,
      "month": "JANUARY",
      "eventName": "WYO Bounce Lab",
      "location": "Cheyenne WY",
      "statuses": [{ "year": 2026, "status": "attended" }]
    }
  ]
}
```

- [ ] **Step 3: Run fixture test and inspect known repeated occurrences**

Assert `WYO Bounce Lab` appears as separate January, February, and March source rows; `Beaverhead County Fair` appears in August and September; `Donkey Derby Days` appears in June and August. These must remain distinct rows.

- [ ] **Step 4: Commit the normalized JSON fixture**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/attendance/attendance-source-fixture.test.ts
git add artifacts/api-server/src/features/attendance/data/adventure-zone-attended-calendar-2026.json artifacts/api-server/src/features/attendance/attendance-source-fixture.ts artifacts/api-server/src/features/attendance/attendance-source-fixture.test.ts
git commit -m "data: normalize attended event calendar"
```

---

### Task 6: Seed attendance import rows and build conservative profile/location matching

**Files:**
- Create: `artifacts/api-server/src/features/attendance/attendance-import-repository.ts`
- Create: `artifacts/api-server/src/features/attendance/attendance-import-seed.ts`
- Create: `artifacts/api-server/src/features/attendance/attendance-matcher.ts`
- Test: `artifacts/api-server/src/features/attendance/attendance-import-seed.test.ts`
- Test: `artifacts/api-server/src/features/attendance/attendance-matcher.test.ts`
- Reuse: `artifacts/api-server/src/routes/organization-forgiving-search.ts` normalization/search concepts

**Interfaces:**

```ts
export async function ensureAttendanceImportSeed(database: DrizzleDatabase): Promise<void>;

export type AttendanceMatchSuggestion = {
  importRowId: string;
  organizationId: string | null;
  organizationLocationId: string | null;
  confidence: number;
  reason: string;
  state: "confident" | "pending" | "new_profile_candidate";
};
```

**Matching rules:**
- Exact normalized event name + compatible city/state -> `confident` only when exactly one active profile/location fits.
- Event-family membership may support a match but cannot by itself identify a city/location occurrence.
- Exact event name with conflicting city/state -> `pending`.
- Fuzzy/forgiving search results are suggestions only -> `pending`, never auto-approved.
- No plausible active profile -> `new_profile_candidate`.
- Consolidated/retired organizations are not match targets; resolve to their active canonical profile if the repository exposes that mapping.

- [ ] **Step 1: Write idempotent seed tests**

Assert 107 import rows and 193 year-status rows after repeated runs.

- [ ] **Step 2: Write matcher tests**

Cover exact unique, ambiguous same-name, family with multiple cities, no match, and retired-profile redirect.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/attendance/attendance-import-seed.test.ts artifacts/api-server/src/features/attendance/attendance-matcher.test.ts
```

- [ ] **Step 4: Implement seed + matcher**

Do not auto-create organizations or locations. Persist suggestions/reasons so owner review is reproducible.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/attendance/attendance-import-seed.test.ts artifacts/api-server/src/features/attendance/attendance-matcher.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/attendance/attendance-import-repository.ts artifacts/api-server/src/features/attendance/attendance-import-seed.ts artifacts/api-server/src/features/attendance/attendance-matcher.ts artifacts/api-server/src/features/attendance/attendance-import-seed.test.ts artifacts/api-server/src/features/attendance/attendance-matcher.test.ts
git commit -m "feat: stage and match attended calendar history"
```

---

### Task 7: Add owner attendance-match review and approval

**Files:**
- Create: `artifacts/api-server/src/routes/attendance-history-import.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/adventure-zone/src/pages/AttendanceHistoryImportPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Test: `artifacts/api-server/src/routes/attendance-history-import.test.ts`
- Test: `artifacts/adventure-zone/src/pages/AttendanceHistoryImportPage.test.tsx`

**Owner routes:**

```text
GET  /imports/attendance-history?state=pending|confident|approved|new_profile_candidate
POST /imports/attendance-history/:rowId/approve { organizationId, organizationLocationId? }
POST /imports/attendance-history/:rowId/reject { reason }
POST /imports/attendance-history/:rowId/rematch
```

Approval creates one `event_attendance_history` row per status year for that source row in one transaction and marks the import row approved. Retrying approval is idempotent.

- [ ] **Step 1: Write approval tests**

A row with three X years creates exactly three history records. A B status remains `blacklisted` history and does not mutate contact preference. Re-approval creates no duplicates.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/attendance-history-import.test.ts
```

- [ ] **Step 3: Implement owner-only API**

Mount after owner middleware. Return source month/name/location plus suggested profile/location and all yearly statuses for review.

- [ ] **Step 4: Build import-review UI under Imports/Data**

Rows show source text, month, year badges, suggested match, confidence reason, Search/Change Match, Approve, Reject. `New profile candidate` opens the normal profile creation workflow; it does not create one directly from the import endpoint.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/attendance-history-import.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/pages/AttendanceHistoryImportPage.test.tsx
pnpm run typecheck
git add artifacts/api-server/src/routes/attendance-history-import.ts artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/pages/AttendanceHistoryImportPage.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation/app-menu.tsx artifacts/api-server/src/routes/attendance-history-import.test.ts artifacts/adventure-zone/src/pages/AttendanceHistoryImportPage.test.tsx
git commit -m "feat: review attended calendar matches"
```

---

### Task 8: Surface approved attendance history on profiles without cluttering system history

**Files:**
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Modify: `artifacts/api-server/src/routes/office-profiles.ts`
- Modify: `artifacts/adventure-zone/src/features/event-profiles/event-profile-repository.ts`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx`
- Create test: `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.attendance-history.test.tsx`
- Test: `artifacts/api-server/src/routes/event-profiles.attendance-history.test.ts`
- Test: `artifacts/api-server/src/routes/office-profiles.attendance-history.test.ts`

**Profile DTO:**

```ts
attendanceHistory: Array<{
  id: string;
  year: number;
  month: string;
  status: "attended" | "blacklisted" | "cancelled_last_minute";
  sourceEventName: string;
  sourceLocation: string;
  organizationLocationId: string | null;
}>;
```

- [ ] **Step 1: Write API projection tests**

Ensure only approved history appears. Owner sees blacklisted status. The Office profile projection includes attended/cancelled history but omits blacklisted rows unless a later explicit permission change authorizes that sensitive state.

- [ ] **Step 2: Add a compact `Attendance history` profile section**

Show year + status + source month/location. Keep this separate from verbose audit/system history; it represents business history, not field-change logs.

- [ ] **Step 3: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/event-profiles.attendance-history.test.ts artifacts/api-server/src/routes/office-profiles.attendance-history.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.attendance-history.test.tsx
pnpm run typecheck
git add artifacts/api-server/src/routes/event-profiles.ts artifacts/api-server/src/routes/office-profiles.ts artifacts/adventure-zone/src/features/event-profiles/event-profile-repository.ts artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.attendance-history.test.tsx artifacts/api-server/src/routes/event-profiles.attendance-history.test.ts artifacts/api-server/src/routes/office-profiles.attendance-history.test.ts
git commit -m "feat: show structured attendance history"
```

---

### Task 9: Full Phase 3 regression and source-count verification

**Files:**
- Modify only tracked files required by failures found here.

- [ ] **Step 1: Run resource/import/profile suites**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/resources/resource-asset-identity.test.ts \
  artifacts/api-server/src/features/resources/resource-source-candidate-seed.test.ts \
  artifacts/api-server/src/features/attendance/event-attendance-schema.test.ts \
  artifacts/api-server/src/features/attendance/attendance-source-fixture.test.ts \
  artifacts/api-server/src/features/attendance/attendance-import-seed.test.ts \
  artifacts/api-server/src/features/attendance/attendance-matcher.test.ts \
  artifacts/api-server/src/routes/resource-source-candidates.test.ts \
  artifacts/api-server/src/routes/attendance-history-import.test.ts \
  artifacts/api-server/src/routes/event-profiles.attendance-history.test.ts \
  artifacts/api-server/src/routes/office-profiles.attendance-history.test.ts
```

- [ ] **Step 2: Run relevant UI suites**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/resources/resource-source-candidate-review.test.tsx artifacts/adventure-zone/src/pages/AttendanceHistoryImportPage.test.tsx artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.attendance-history.test.tsx
```

- [ ] **Step 3: Assert the committed workbook fixture still has exact source counts**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/attendance/attendance-source-fixture.test.ts
```

Expected: 107 source rows; 193 statuses; 184 attended; 1 blacklisted; 8 cancelled-last-minute.

- [ ] **Step 4: Typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 5: Commit regression fixes if any**

```bash
git add -u
git diff --cached --quiet || git commit -m "test: verify inventory and attendance import"
```
