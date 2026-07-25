# Adventure Zone Command Center Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private, installable Daily Booking System: Today dashboard, contacts, leads, follow-ups, calendar, four configurable travel legs, filterable event map, controlled Act! CSV import, and backups.

**Architecture:** Use a single Next.js TypeScript application with server-rendered screens, server actions/API handlers, and PostgreSQL accessed through Drizzle ORM. Keep booking rules, Act! import logic, and mapping behind focused domain modules so the later intelligent-routing and two-way-sync plans can extend the system without replacing Stage 1.

**Tech Stack:** Next.js App Router, React, TypeScript, PostgreSQL, Drizzle ORM, Clerk authentication, Tailwind CSS, MapLibre GL JS, Zod, Vitest, Testing Library, Playwright, and a web-app manifest/service worker.

## Global Constraints

- Use Node.js 20.9 or newer and TypeScript 5.1 or newer, matching current Next.js requirements.
- Support Chrome 111+, Edge 111+, Firefox 111+, and Safari 16.4+.
- The initial application has exactly one authorized user.
- It must be responsive and installable on both phone and computer.
- `/today` is the authenticated default screen.
- Follow-up calls are the highest-priority risk.
- Reminders stay inside the application; no email, SMS, or push notifications.
- Every active lead must have a dated next action or appear in **Needs Follow-up Plan**.
- Model four configurable travel legs; do not hard-code the three advertised packages as routes.
- Unconfirmed events appear on the map and can be filtered by status.
- Act! remains the authoritative CRM; Stage 1 performs reviewed CSV import and never writes to Act!.
- Route, contract, contact, and equipment-location information is private.
- Route optimization, road mileage, drive-time recommendations, equipment allocation, and two-way Act! sync are outside Stage 1.

---

## Planned File Structure

```text
app/
  (auth)/sign-in/[[...sign-in]]/page.tsx
  (private)/layout.tsx
  (private)/today/page.tsx
  (private)/bookings/page.tsx
  (private)/bookings/[bookingId]/page.tsx
  (private)/calendar/page.tsx
  (private)/routes/page.tsx
  (private)/settings/import/page.tsx
  api/health/route.ts
  api/import/act/preview/route.ts
  api/import/act/apply/route.ts
  layout.tsx
  manifest.ts
components/
  navigation/app-shell.tsx
  today/follow-up-list.tsx
  today/summary-cards.tsx
  bookings/booking-form.tsx
  bookings/status-badge.tsx
  calendar/event-calendar.tsx
  routes/event-map.tsx
  routes/map-filters.tsx
  import/act-import-review.tsx
db/
  client.ts
  schema.ts
  migrations/
features/
  audit/audit-service.ts
  bookings/booking-repository.ts
  bookings/booking-service.ts
  bookings/booking-types.ts
  follow-ups/follow-up-policy.ts
  import/act-csv.ts
  import/act-matcher.ts
  import/act-types.ts
  routes/travel-leg-repository.ts
  routes/map-query.ts
lib/
  auth/require-owner.ts
  env.ts
  result.ts
public/
  icons/
  sw.js
tests/
  unit/
  integration/
  e2e/
drizzle.config.ts
  proxy.ts
playwright.config.ts
vitest.config.ts
```

Each feature directory owns its rules and data access. UI components consume
feature interfaces rather than querying PostgreSQL directly.

---

### Task 1: Application Foundation and Quality Gates

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `postcss.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx`
- Create: `app/api/health/route.ts`
- Create: `tests/unit/health-contract.test.ts`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: `GET /api/health -> { status: "ok" }`
- Produces: package scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`

- [ ] **Step 1: Initialize the application and install exact dependency categories**

Run:

```bash
npm init -y
npm install next react react-dom zod drizzle-orm postgres @clerk/nextjs maplibre-gl
npm install -D typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss eslint eslint-config-next vitest @testing-library/react @testing-library/jest-dom jsdom @playwright/test drizzle-kit
```

Expected: `package.json` and lockfile are created without audit errors that block installation.

- [ ] **Step 2: Add deterministic scripts and strict TypeScript settings**

Set the scripts in `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

Set `tsconfig.json` to `"strict": true`, `"noUncheckedIndexedAccess": true`,
and the standard Next.js path alias `"@/*": ["./*"]`. Configure
`eslint.config.mjs` with the flat-config exports from
`eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`.
Configure `postcss.config.mjs` with `@tailwindcss/postcss` and import
`tailwindcss` from `app/globals.css`.

- [ ] **Step 3: Write the failing health contract test**

```ts
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health endpoint", () => {
  it("returns an ok status", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 4: Run the test and verify the missing route failure**

Run:

```bash
npm test -- tests/unit/health-contract.test.ts
```

Expected: FAIL because `app/api/health/route.ts` does not exist.

- [ ] **Step 5: Implement the minimum health route and root redirect**

```ts
// app/api/health/route.ts
export function GET() {
  return Response.json({ status: "ok" as const });
}
```

```ts
// app/page.tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/today");
}
```

- [ ] **Step 6: Run all foundation checks**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all commands exit successfully.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs postcss.config.mjs vitest.config.ts playwright.config.ts app .env.example .gitignore tests
git commit -m "chore: scaffold command center"
```

---

### Task 2: Database Schema and Seeded Travel Legs

**Files:**
- Create: `db/client.ts`
- Create: `db/schema.ts`
- Create: `drizzle.config.ts`
- Create: `db/migrations/`
- Create: `db/seed.ts`
- Create: `features/bookings/booking-types.ts`
- Create: `tests/unit/schema-contract.test.ts`

**Interfaces:**
- Produces: `bookingStatusValues` string tuple
- Produces: tables `contacts`, `organizations`, `bookings`, `followUps`, `travelLegs`, `auditEntries`, `actImportRuns`, `actExternalLinks`
- Produces: four initial travel-leg rows named `Leg 1` through `Leg 4`

- [ ] **Step 1: Write the schema contract test**

```ts
import { describe, expect, it } from "vitest";
import { bookingStatusValues } from "@/features/bookings/booking-types";

describe("booking status contract", () => {
  it("contains the approved workflow in order", () => {
    expect(bookingStatusValues).toEqual([
      "new_lead", "researching", "contact_due", "contacted", "interested",
      "possible", "unlikely", "quote_sent", "pending_decision",
      "pending_contract", "contract_received", "confirmed", "declined",
      "cancelled", "completed", "renewal_due"
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/unit/schema-contract.test.ts
```

Expected: FAIL because `booking-types.ts` does not exist.

- [ ] **Step 3: Define shared status and probability types**

```ts
export const bookingStatusValues = [
  "new_lead", "researching", "contact_due", "contacted", "interested",
  "possible", "unlikely", "quote_sent", "pending_decision",
  "pending_contract", "contract_received", "confirmed", "declined",
  "cancelled", "completed", "renewal_due"
] as const;

export type BookingStatus = (typeof bookingStatusValues)[number];
export const probabilityValues = ["likely", "possible", "unlikely"] as const;
export type Probability = (typeof probabilityValues)[number];
```

- [ ] **Step 4: Create normalized Drizzle tables**

In `db/schema.ts`, define UUID primary keys, timestamps with timezone, and:

```ts
export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  primaryContactId: uuid("primary_contact_id").references(() => contacts.id),
  name: text("name").notNull(),
  venueName: text("venue_name"),
  address1: text("address_1"),
  city: text("city").notNull(),
  region: text("region").notNull(),
  postalCode: text("postal_code"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  status: bookingStatusEnum("status").default("new_lead").notNull(),
  probability: probabilityEnum("probability").default("possible").notNull(),
  travelLegId: uuid("travel_leg_id").references(() => travelLegs.id),
  actRecordId: text("act_record_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});
```

Define `followUps` with `bookingId`, `kind`, `dueAt`, `completedAt`, `outcome`,
and `nextFollowUpId`. Define `auditEntries` with entity type/id, action,
before/after JSON, and timestamp.

- [ ] **Step 5: Generate and apply the migration**

Run:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

Expected: migration creates all Stage 1 tables.

- [ ] **Step 6: Seed exactly four configurable legs**

```ts
const legs = [
  { name: "Leg 1", color: "#DC3B3B", sortOrder: 1 },
  { name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
  { name: "Leg 3", color: "#7B4DDB", sortOrder: 3 },
  { name: "Leg 4", color: "#15956B", sortOrder: 4 }
];
```

Use an upsert keyed by `sortOrder` so reseeding is safe.

- [ ] **Step 7: Run schema tests and commit**

Run:

```bash
npm test -- tests/unit/schema-contract.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add db drizzle.config.ts features/bookings/booking-types.ts tests/unit/schema-contract.test.ts
git commit -m "feat: add booking data model"
```

---

### Task 3: Single-Owner Authentication and Private App Shell

**Files:**
- Create: `proxy.ts`
- Create: `lib/env.ts`
- Create: `lib/auth/require-owner.ts`
- Create: `app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- Create: `app/(private)/layout.tsx`
- Create: `components/navigation/app-shell.tsx`
- Test: `tests/unit/require-owner.test.ts`

**Interfaces:**
- Consumes: Clerk `auth()`
- Produces: `requireOwner(): Promise<{ userId: string }>`
- Produces: authenticated navigation to Today, Bookings, Calendar, Routes, and Import

- [ ] **Step 1: Write authorization tests**

```ts
import { describe, expect, it } from "vitest";
import { authorizeOwner } from "@/lib/auth/require-owner";

describe("authorizeOwner", () => {
  it("accepts the configured owner", () => {
    expect(authorizeOwner("user_desiree", "user_desiree")).toEqual({
      userId: "user_desiree"
    });
  });

  it("rejects every other authenticated user", () => {
    expect(() => authorizeOwner("user_other", "user_desiree"))
      .toThrow("Not authorized");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/unit/require-owner.test.ts
```

Expected: FAIL because `authorizeOwner` is missing.

- [ ] **Step 3: Implement owner-only policy**

```ts
export function authorizeOwner(userId: string | null, ownerUserId: string) {
  if (!userId || userId !== ownerUserId) throw new Error("Not authorized");
  return { userId };
}
```

`requireOwner` obtains the Clerk user ID and compares it with the validated
`OWNER_CLERK_USER_ID` environment variable.

- [ ] **Step 4: Protect private routes**

Configure Clerk's Next.js 16 proxy so all routes except `/sign-in` and `/api/health`
require authentication. The private layout calls `requireOwner()` before
rendering `AppShell`.

- [ ] **Step 5: Build responsive app navigation**

Desktop uses a left navigation rail. Mobile uses a bottom bar with:

```ts
const navigation = [
  { href: "/today", label: "Today" },
  { href: "/bookings", label: "Bookings" },
  { href: "/calendar", label: "Calendar" },
  { href: "/routes", label: "Routes" }
];
```

Import lives under a Settings menu. Add a persistent Quick Add button.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- tests/unit/require-owner.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add proxy.ts lib app components/navigation tests/unit/require-owner.test.ts
git commit -m "feat: protect private command center"
```

---

### Task 4: Booking Service and Next-Action Enforcement

**Files:**
- Create: `features/bookings/booking-repository.ts`
- Create: `features/bookings/booking-service.ts`
- Create: `features/follow-ups/follow-up-policy.ts`
- Create: `lib/result.ts`
- Test: `tests/unit/follow-up-policy.test.ts`
- Test: `tests/integration/booking-service.test.ts`

**Interfaces:**
- Produces: `isActiveStatus(status: BookingStatus): boolean`
- Produces: `needsFollowUpPlan(booking, nextFollowUp): boolean`
- Produces: `completeFollowUp(input): Promise<Result<FollowUp, DomainError>>`
- Produces: `createBooking(input): Promise<Booking>`

- [ ] **Step 1: Write the policy tests**

```ts
describe("needsFollowUpPlan", () => {
  it("flags an active lead without a future action", () => {
    expect(needsFollowUpPlan({ status: "possible" }, null)).toBe(true);
  });

  it("does not flag a closed lead", () => {
    expect(needsFollowUpPlan({ status: "declined" }, null)).toBe(false);
  });

  it("does not flag an active lead with an incomplete dated action", () => {
    expect(needsFollowUpPlan(
      { status: "quote_sent" },
      { dueAt: new Date("2026-08-01T15:00:00Z"), completedAt: null }
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/unit/follow-up-policy.test.ts
```

Expected: FAIL because the policy functions are missing.

- [ ] **Step 3: Implement explicit active and closed status policy**

```ts
const closedStatuses = new Set<BookingStatus>([
  "declined", "cancelled", "completed"
]);

export function isActiveStatus(status: BookingStatus) {
  return !closedStatuses.has(status);
}

export function needsFollowUpPlan(
  booking: { status: BookingStatus },
  next: { dueAt: Date; completedAt: Date | null } | null
) {
  return isActiveStatus(booking.status) && (!next || next.completedAt !== null);
}
```

- [ ] **Step 4: Write integration tests for completing a call**

Test both rules:

```ts
it("rejects completing an active lead call without a next action", async () => {
  const result = await service.completeFollowUp({
    followUpId,
    outcome: "interested",
    nextAction: null
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "NEXT_ACTION_REQUIRED" }
  });
});

it("atomically completes the call and schedules its next action", async () => {
  const result = await service.completeFollowUp({
    followUpId,
    outcome: "send_quote",
    nextAction: {
      kind: "prepare_quote",
      dueAt: new Date("2026-08-02T15:00:00Z")
    }
  });
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 5: Implement transaction-backed booking operations**

Use one database transaction to complete the old follow-up, create the next
follow-up, update booking status when requested, and write an audit entry.
Return `NEXT_ACTION_REQUIRED` before opening the transaction when the resulting
booking remains active and `nextAction` is missing.

- [ ] **Step 6: Run unit and integration tests**

Run:

```bash
npm test -- tests/unit/follow-up-policy.test.ts tests/integration/booking-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add features lib/result.ts tests/unit/follow-up-policy.test.ts tests/integration/booking-service.test.ts
git commit -m "feat: enforce booking follow-ups"
```

---

### Task 5: Booking List, Detail, and Quick Add

**Files:**
- Create: `app/(private)/bookings/page.tsx`
- Create: `app/(private)/bookings/[bookingId]/page.tsx`
- Create: `components/bookings/booking-form.tsx`
- Create: `components/bookings/status-badge.tsx`
- Create: `components/bookings/booking-list.tsx`
- Create: `components/bookings/follow-up-completion-dialog.tsx`
- Test: `tests/unit/booking-form.test.tsx`
- Test: `tests/e2e/booking-flow.spec.ts`

**Interfaces:**
- Consumes: `createBooking`, `completeFollowUp`, booking repository queries
- Produces: accessible create/edit/detail UI
- Produces: filters for status, probability, date, state, and travel leg

- [ ] **Step 1: Write the form validation test**

```tsx
it("requires event name, city, state, status, and next action for an active lead", async () => {
  render(<BookingForm onSubmit={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Save lead" }));
  expect(await screen.findByText("Event name is required")).toBeVisible();
  expect(screen.getByText("City is required")).toBeVisible();
  expect(screen.getByText("Choose the next follow-up date")).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/unit/booking-form.test.tsx
```

Expected: FAIL because `BookingForm` does not exist.

- [ ] **Step 3: Implement typed form validation**

Use a shared Zod schema:

```ts
export const bookingInputSchema = z.object({
  name: z.string().trim().min(1, "Event name is required"),
  city: z.string().trim().min(1, "City is required"),
  region: z.string().trim().min(2, "State is required"),
  status: z.enum(bookingStatusValues),
  probability: z.enum(probabilityValues),
  nextActionKind: z.string().trim().min(1, "Choose the next action"),
  nextActionDueAt: z.coerce.date()
});
```

- [ ] **Step 4: Build list and detail screens**

The list shows event name, city/state, dates, status, probability, next action,
and overdue state. The detail page groups Contact, Event, Booking, Logistics,
Notes, Follow-ups, and Audit History.

- [ ] **Step 5: Implement call-completion dialog**

Require one outcome choice and, unless the lead becomes closed, a next-action
type and date. Keep the dialog open and show the domain error if the service
returns `NEXT_ACTION_REQUIRED`.

- [ ] **Step 6: Add the end-to-end booking flow**

```ts
test("new lead remains visible after its first call", async ({ page }) => {
  await page.goto("/bookings");
  await page.getByRole("button", { name: "Quick Add" }).click();
  await page.getByLabel("Event name").fill("Example County Fair");
  await page.getByLabel("City").fill("Example");
  await page.getByLabel("State").fill("ND");
  await page.getByLabel("Next action").selectOption("call");
  await page.getByLabel("Follow-up date").fill("2026-08-03");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByText("Example County Fair")).toBeVisible();
});
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
npm test -- tests/unit/booking-form.test.tsx
npm run test:e2e -- tests/e2e/booking-flow.spec.ts
```

Expected: PASS.

```bash
git add app/'(private)'/bookings components/bookings tests
git commit -m "feat: add booking workflow"
```

---

### Task 6: Today Command Center

**Files:**
- Create: `app/(private)/today/page.tsx`
- Create: `components/today/summary-cards.tsx`
- Create: `components/today/follow-up-list.tsx`
- Create: `components/today/next-call-card.tsx`
- Create: `features/follow-ups/today-query.ts`
- Test: `tests/unit/today-priority.test.ts`
- Test: `tests/e2e/today-dashboard.spec.ts`

**Interfaces:**
- Produces: `getTodayDashboard(now: Date): Promise<TodayDashboard>`
- Produces: `sortFollowUpsForToday(items, now): FollowUpSummary[]`

- [ ] **Step 1: Write priority-order tests**

```ts
it("orders overdue calls before calls due today and quiet leads", () => {
  const result = sortFollowUpsForToday([
    item("quiet", "2026-08-10T15:00:00Z", "quiet_lead"),
    item("today", "2026-08-03T17:00:00Z", "due"),
    item("overdue", "2026-08-02T17:00:00Z", "due")
  ], new Date("2026-08-03T14:00:00Z"));

  expect(result.map((x) => x.id)).toEqual(["overdue", "today", "quiet"]);
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/unit/today-priority.test.ts
```

Expected: FAIL because the sorter is missing.

- [ ] **Step 3: Implement stable priority sorting**

Assign explicit priority buckets: overdue `0`, due today `1`, deadline `2`,
high-value/likely `3`, quiet lead `4`, other `5`. Within a bucket sort by due
date then creation time.

- [ ] **Step 4: Implement the approved Command Center layout**

Render:

- Follow-ups count
- New leads count
- Contracts count
- Route warning count
- Next call
- Prioritized follow-up list
- Needs Follow-up Plan list
- Upcoming events summary

On a phone, summary cards form a two-column grid and the follow-up list appears
immediately below. On desktop, summary cards span one row.

- [ ] **Step 5: Add dashboard end-to-end assertions**

```ts
test("today keeps overdue follow-ups front and center", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("Overdue follow-ups")).toBeVisible();
  await expect(page.getByText("Needs Follow-up Plan")).toBeVisible();
});
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- tests/unit/today-priority.test.ts
npm run test:e2e -- tests/e2e/today-dashboard.spec.ts
```

Expected: PASS.

```bash
git add app/'(private)'/today components/today features/follow-ups tests
git commit -m "feat: add today command center"
```

---

### Task 7: Calendar and Four-Leg Event Map

**Files:**
- Create: `app/(private)/calendar/page.tsx`
- Create: `components/calendar/event-calendar.tsx`
- Create: `app/(private)/routes/page.tsx`
- Create: `components/routes/event-map.tsx`
- Create: `components/routes/map-filters.tsx`
- Create: `features/routes/travel-leg-repository.ts`
- Create: `features/routes/map-query.ts`
- Test: `tests/unit/map-query.test.ts`
- Test: `tests/e2e/routes-map.spec.ts`

**Interfaces:**
- Produces: `getMapEvents(filters: MapFilters): Promise<MapEvent[]>`
- Produces: `MapFilters { statuses, travelLegIds, dateFrom, dateTo, regions }`
- Produces: GeoJSON FeatureCollection for MapLibre

- [ ] **Step 1: Write map filter tests**

```ts
it("can show only pending-contract events on Leg 2", async () => {
  const result = await getMapEvents({
    statuses: ["pending_contract"],
    travelLegIds: ["leg-2"],
    dateFrom: null,
    dateTo: null,
    regions: []
  });
  expect(result.every((event) =>
    event.status === "pending_contract" && event.travelLegId === "leg-2"
  )).toBe(true);
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/unit/map-query.test.ts
```

Expected: FAIL because the query does not exist.

- [ ] **Step 3: Implement map query and GeoJSON conversion**

Exclude records without coordinates from GeoJSON and return them separately as
`unmappedEvents`, so missing coordinates are visible rather than silently lost.
Each feature includes only display-safe private-app properties:

```ts
{
  id, name, status, probability, travelLegId, travelLegColor, startsAt, endsAt
}
```

- [ ] **Step 4: Build calendar screen**

Provide month and agenda views. Selecting an event opens its booking detail.
Confirmed and tentative events remain visually distinguishable.

- [ ] **Step 5: Build filterable MapLibre screen**

Render colored event dots. Filters support status, travel leg, date range, and
state. Add **Reset filters** and an unmapped-events panel. Stage 1 draws no
optimized driving routes and makes no travel recommendation.

- [ ] **Step 6: Add map end-to-end test**

```ts
test("status filter hides unrelated events", async ({ page }) => {
  await page.goto("/routes");
  await page.getByLabel("Booking status").selectOption("pending_contract");
  await expect(page.getByText("Pending Contract")).toBeVisible();
  await expect(page.getByText("Declined")).not.toBeVisible();
});
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
npm test -- tests/unit/map-query.test.ts
npm run test:e2e -- tests/e2e/routes-map.spec.ts
```

Expected: PASS.

```bash
git add app/'(private)'/calendar app/'(private)'/routes components/calendar components/routes features/routes tests
git commit -m "feat: add calendar and event map"
```

---

### Task 8: Controlled Act! CSV Import

**Files:**
- Create: `features/import/act-types.ts`
- Create: `features/import/act-csv.ts`
- Create: `features/import/act-matcher.ts`
- Create: `app/api/import/act/preview/route.ts`
- Create: `app/api/import/act/apply/route.ts`
- Create: `app/(private)/settings/import/page.tsx`
- Create: `components/import/act-import-review.tsx`
- Test: `tests/fixtures/act-contacts.csv`
- Test: `tests/unit/act-csv.test.ts`
- Test: `tests/integration/act-import.test.ts`

**Interfaces:**
- Produces: `parseActCsv(csv: string): ActCsvRecord[]`
- Produces: `previewActImport(records): ImportPreview`
- Produces: `applyActImport(runId, approvedRowIds): ImportApplyResult`
- Guarantees: preview performs no contact or booking writes

- [ ] **Step 1: Create a fixture with exact matching cases**

```csv
Record ID,Company,Contact,Email,Phone,City,State
ACT-001,Marias Fair,Avery Example,avery@example.com,406-555-0101,Shelby,MT
ACT-002,Crook County Fair,Casey Example,casey@example.com,307-555-0102,Sundance,WY
,Duplicate Email,Casey Example,casey@example.com,307-555-0102,Sundance,WY
```

- [ ] **Step 2: Write parser and matching tests**

Assert:

- Header names are normalized.
- Blank rows are ignored.
- `ACT-001` matches a prior external link first.
- Email matching is case-insensitive.
- Multiple possible matches are classified `conflict`, not merged.
- Preview does not change database row counts.

- [ ] **Step 3: Run and verify failure**

Run:

```bash
npm test -- tests/unit/act-csv.test.ts tests/integration/act-import.test.ts
```

Expected: FAIL because import modules are missing.

- [ ] **Step 4: Implement parser with explicit row errors**

```ts
export type ActCsvRecord = {
  rowNumber: number;
  recordId: string | null;
  company: string | null;
  contact: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
};
```

Return malformed rows as reviewable errors containing row number and message;
do not abort valid rows because one row is malformed.

- [ ] **Step 5: Implement deterministic matching**

Match in this order:

1. Existing `actExternalLinks.externalId`
2. Exact normalized email
3. Exact normalized organization plus contact name
4. New record

If a rule returns more than one local record, classify it as `conflict`.

- [ ] **Step 6: Implement preview and approved apply**

Preview stores an immutable import run and proposed actions. Apply accepts the
run ID plus explicitly approved row IDs, executes all approved rows in a
transaction, writes external links and audit entries, and leaves skipped or
failed rows unchanged.

- [ ] **Step 7: Build review UI**

Show tabs for New, Changes, Duplicates, Conflicts, and Errors. Every row has an
approve toggle. Provide **Approve All Safe Changes** for New and unambiguous
Changes only. Display a final count before Apply.

- [ ] **Step 8: Run tests and commit**

Run:

```bash
npm test -- tests/unit/act-csv.test.ts tests/integration/act-import.test.ts
```

Expected: PASS.

```bash
git add features/import app/api/import app/'(private)'/settings/import components/import tests
git commit -m "feat: add reviewed act csv import"
```

---

### Task 9: Audit History, Undo, and Backup Operations

**Files:**
- Create: `features/audit/audit-service.ts`
- Create: `features/audit/undo-service.ts`
- Create: `scripts/backup-database.sh`
- Create: `scripts/restore-database.sh`
- Create: `docs/operations/backup-and-restore.md`
- Test: `tests/integration/audit-undo.test.ts`

**Interfaces:**
- Produces: `recordAuditEntry(tx, change): Promise<void>`
- Produces: `undoAuditEntry(entryId): Promise<Result<void, UndoError>>`
- Produces: timestamped encrypted database dump procedure

- [ ] **Step 1: Write undo tests**

```ts
it("restores the prior booking status and creates a new audit entry", async () => {
  const original = await seedBooking({ status: "possible" });
  const change = await updateBookingStatus(original.id, "unlikely");
  await undoAuditEntry(change.auditEntryId);
  expect(await findBooking(original.id)).toMatchObject({ status: "possible" });
  expect(await auditActions(original.id)).toEqual(["update", "undo"]);
});
```

Also test that an already-undone entry and a non-reversible import batch return
explicit errors rather than applying twice.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/integration/audit-undo.test.ts
```

Expected: FAIL because undo is missing.

- [ ] **Step 3: Implement reversible audit changes**

Store field-level before/after JSON for booking, contact, organization, follow-up,
and travel-leg updates. Undo uses a transaction, checks the entity has not
changed incompatibly since the audited action, restores `before`, and records
the undo as a new audit entry.

- [ ] **Step 4: Add backup and restore scripts**

`backup-database.sh` must:

- Require `DATABASE_URL` and `BACKUP_ENCRYPTION_PASSPHRASE`.
- Run `pg_dump --format=custom --file "$temporary_dump" "$DATABASE_URL"`.
- Encrypt with GnuPG integrity protection using
  `gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" --symmetric --cipher-algo AES256 --output "$backup_path" "$temporary_dump"`.
- Name the output with UTC date and time.
- Delete the unencrypted temporary dump through an exit trap.
- Exit nonzero if dump or encryption fails.

`restore-database.sh` must:

- Require an explicit backup file path.
- Refuse a directory or missing file.
- Decrypt with
  `gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" --decrypt --output "$temporary_dump" "$backup_path"`.
- Run `pg_restore --clean --if-exists --dbname "$DATABASE_URL" "$temporary_dump"`.
- Remove the temporary file on exit.

- [ ] **Step 5: Document and perform a restore drill**

Document the exact backup command, restore-to-test-database command, expected
success output, retention policy, and how to confirm row counts after restore.
Perform the drill against a disposable test database.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- tests/integration/audit-undo.test.ts
shellcheck scripts/backup-database.sh scripts/restore-database.sh
```

Expected: PASS.

```bash
git add features/audit scripts docs/operations tests/integration/audit-undo.test.ts
git commit -m "feat: add audit undo and backups"
```

---

### Task 10: Installable App and Connection-Loss Safety

**Files:**
- Create: `app/manifest.ts`
- Create: `public/sw.js`
- Create: `components/connectivity/offline-banner.tsx`
- Create: `lib/offline/draft-store.ts`
- Modify: `app/layout.tsx`
- Test: `tests/unit/draft-store.test.ts`
- Test: `tests/e2e/installable-offline.spec.ts`

**Interfaces:**
- Produces: valid web-app manifest with standalone display
- Produces: `saveDraft`, `loadDraft`, `deleteDraft`
- Guarantees: unsaved form drafts are marked local and never presented as server-saved

- [ ] **Step 1: Write draft-store tests**

```ts
it("round-trips a locally saved booking draft", () => {
  saveDraft("booking:new", { name: "Draft Fair", city: "Fargo" });
  expect(loadDraft("booking:new")).toEqual({
    name: "Draft Fair",
    city: "Fargo"
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/unit/draft-store.test.ts
```

Expected: FAIL because draft storage is missing.

- [ ] **Step 3: Implement local draft storage**

Use namespaced `localStorage` records with schema version and saved timestamp.
Catch quota and serialization failures and return a typed failure that the form
renders as **Draft could not be saved on this device**.

- [ ] **Step 4: Add manifest and service worker**

Manifest:

```ts
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Adventure Zone Command Center",
    short_name: "AZ Command",
    start_url: "/today",
    display: "standalone",
    background_color: "#F4F7FB",
    theme_color: "#20345B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
}
```

The service worker caches only the app shell and static assets. It must not cache
private API responses containing contacts, contracts, or notes.

- [ ] **Step 5: Add connection banner and form draft indicators**

When offline, show **Offline — changes are drafts until reconnected**. Restore a
draft only after the user chooses **Restore draft**. Delete it after the server
confirms a successful save.

- [ ] **Step 6: Test installability and offline behavior**

```ts
test("manifest starts the installed app on Today", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  const manifest = await response.json();
  expect(manifest.start_url).toBe("/today");
  expect(manifest.display).toBe("standalone");
});
```

Verify with Playwright that private API responses are absent from Cache Storage.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
npm test -- tests/unit/draft-store.test.ts
npm run test:e2e -- tests/e2e/installable-offline.spec.ts
```

Expected: PASS.

```bash
git add app components/connectivity lib/offline public tests
git commit -m "feat: make command center installable"
```

---

### Task 11: Accessibility, Responsive Verification, and Stage 1 Release

**Files:**
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/responsive.spec.ts`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/act-import.md`
- Modify: `.env.example`

**Interfaces:**
- Produces: documented production configuration and release checklist
- Guarantees: mobile and desktop critical flows pass before deployment

- [ ] **Step 1: Add responsive smoke tests**

Test at:

```ts
const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 }
];
```

For each viewport, confirm Today, Bookings, Calendar, Routes, Quick Add, and the
follow-up completion dialog are reachable without horizontal scrolling.

- [ ] **Step 2: Add keyboard and accessible-name tests**

Verify:

- Every form field has an accessible label.
- Status is conveyed by text as well as color.
- Map filters work without using the map canvas.
- Dialog focus is trapped and returns to its trigger.
- The mobile navigation has distinct accessible names.

- [ ] **Step 3: Document environment and deployment**

`.env.example` must include names only:

```dotenv
DATABASE_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
OWNER_CLERK_USER_ID=
NEXT_PUBLIC_MAP_STYLE_URL=
BACKUP_ENCRYPTION_PASSPHRASE=
```

Deployment documentation must cover database migration, four-leg seeding,
owner-user configuration, health check, backup schedule, map style
configuration, and rollback to the previous deployment.

- [ ] **Step 4: Document the Act! import procedure**

Include:

1. Export a small test set from Act!.
2. Upload CSV to Preview.
3. Review New, Changes, Duplicates, Conflicts, and Errors.
4. Apply only approved rows.
5. Compare counts and inspect five sample records.
6. Import the full file only after the test succeeds.

- [ ] **Step 5: Run the full release gate**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: every command succeeds with no skipped critical-path tests.

- [ ] **Step 6: Perform the manual acceptance checklist**

Confirm:

- A new active lead cannot be saved without a next action.
- Completing a call asks what happens next.
- Overdue calls appear first on Today.
- Four travel legs are visible and configurable.
- Possible and pending events can be filtered on the map.
- An unmapped event is reported instead of disappearing.
- Act! preview performs no writes.
- Only approved import rows are applied.
- No after-hours notification mechanism exists.
- The app installs on a phone and opens to Today.
- Backup restoration succeeds against a disposable database.

- [ ] **Step 7: Commit the release candidate**

```bash
git add .
git commit -m "release: complete command center stage one"
git tag stage-1-ready
```

---

## Stage 1 Completion Boundary

Stage 1 is complete when the release gate and manual acceptance checklist pass.
It intentionally does not claim to optimize routes, calculate road travel,
assign equipment, route the paintball trailer, publish social posts, or write
back to Act!.

After Stage 1 is used with real bookings, create separate approved designs and
plans for:

1. Intelligent route and shared-equipment planning
2. Reviewed two-way Act! synchronization
3. Social-content organization and renewal reporting
