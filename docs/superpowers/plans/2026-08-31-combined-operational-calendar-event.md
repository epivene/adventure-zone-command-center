# Combined Operational Calendar Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every confirmed booking sync to Dave's Google Calendar as one all-day event whose title and description list all assigned packages.

**Architecture:** Add a durable `combined` calendar-link identity, centralize package ordering/parsing, render one booking-level event, and make sync prefer the combined link while safely promoting one existing legacy package link. Keep legacy Google rows intact, preserve parser/import compatibility for old single-package rows, and route missing, ambiguous, or partially understood data to the existing review flow.

**Tech Stack:** TypeScript 5.9, Express 5, PostgreSQL/Drizzle, PGlite, Google Calendar API adapter, React/Vite, Vitest, Testing Library, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-31-combined-operational-calendar-event-design.md`

## Global Constraints

- One booking produces one app-owned Google Calendar event.
- The event is always written to the configured Dave operational calendar; there is no per-send destination chooser.
- Package display order is exactly Zone, Pirates, Warrior.
- Duplicate package selections are collapsed before rendering.
- The title uses compact package labels; `ATTRACTION LIST` uses the selected package-template names.
- Description lines with no real value are omitted.
- Sending again updates the same combined event, including after package additions or removals.
- Existing `zone`, `pirates`, and `warrior` links remain readable for legacy conversion.
- The selected legacy link is promoted in place; historical extra Google events are never deleted automatically.
- Exact-match adoption requires normalized title, reserved start, and reserved exclusive end.
- Multiple exact matches, a missing linked event, an ETag conflict, or a partly unrecognized package list creates review and never creates another event.
- Missing confirmed status, dates, leg, packages, or Google connection retains the current result state.
- Existing public dates and the reserved travel/setup/teardown window are not changed by this feature.

## File Structure

| File | Responsibility |
|---|---|
| `lib/db/src/operational-calendar-schema.ts` | Link-key type and Drizzle check constraint, including `combined`. |
| `lib/db/migrations/20260831_operational_calendar_combined_link.sql` | Upgrade an existing database constraint without rewriting link rows. |
| `artifacts/api-server/src/db/google-workspace-operational-calendar-upgrade.ts` | Idempotent startup repair for deployments that do not run the custom migration first. |
| `artifacts/api-server/src/db/operational-calendar-combined-migration.pglite.test.ts` | Executable migration and constraint proof. |
| `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-packages.ts` | Canonical package keys, order, labels, aliases, and template-code candidates. |
| `artifacts/api-server/src/features/google-workspace/calendar/david-calendar-parser.ts` | Parse one or many package labels and report unknown tokens. |
| `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-renderer.ts` | Render one combined event from one confirmed-booking projection. |
| `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-projection-repository.ts` | Load, deduplicate, and order booking package keys and template names. |
| `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-repository.ts` | Read combined/legacy links, promote one legacy link, and resolve multi-package reviews. |
| `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-service.ts` | Create, adopt, update, or review exactly one event per booking. |
| `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-service.ts` | Assign every parsed package and save combined-event identity on import. |
| `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-review-projection.ts` | Project all parsed package labels into review data. |
| `artifacts/adventure-zone/src/components/google-workspace/operational-calendar-settings-card.tsx` | Display `Packages:` and the complete package list in review UI. |
| `artifacts/adventure-zone/src/components/bookings/booking-calendar-send-button.tsx` | Explain that one calendar event was created or updated. |
| `.github/workflows/google-workspace-sync-ci.yml` | Run the affected schema, API, parser, renderer, sync, import, and frontend tests. |

---

### Task 1: Add the `combined` durable link identity

**Files:**
- Modify: `lib/db/src/operational-calendar-schema.ts`
- Create: `lib/db/migrations/20260831_operational_calendar_combined_link.sql`
- Modify: `artifacts/api-server/src/db/google-workspace-operational-calendar-upgrade.ts`
- Create: `artifacts/api-server/src/db/operational-calendar-combined-migration.pglite.test.ts`
- Modify: `artifacts/api-server/src/db/google-workspace-operational-calendar-upgrade.test.ts`

**Interfaces:**
- Preserves `OperationalCalendarPackageKey = "zone" | "pirates" | "warrior"` for real attraction assignments.
- Produces `OperationalCalendarLinkPackageKey = OperationalCalendarPackageKey | "combined"` for persisted link rows.
- Preserves: the existing event-identity and booking/package unique indexes and all legacy rows.
- Consumed by: Tasks 4–6 when finding, promoting, saving, and importing the booking-level link.

- [ ] **Step 1: Write a failing executable migration test**

Create a minimal legacy link table, apply the new SQL twice, then prove all four valid keys insert while an unknown key fails:

```ts
const migrationUrl = new URL(
  "../../../../lib/db/migrations/20260831_operational_calendar_combined_link.sql",
  import.meta.url,
);

it("accepts combined links, keeps legacy keys, rejects unknown keys, and is idempotent", async () => {
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
    create table google_operational_calendar_links (
      id uuid primary key default gen_random_uuid(),
      connection_id text not null,
      calendar_id text not null,
      google_event_id text not null,
      booking_id text not null,
      package_key text not null,
      constraint google_operational_calendar_links_package_key_valid
        check (package_key in ('zone','pirates','warrior')),
      constraint google_operational_calendar_links_event_unique
        unique (connection_id, calendar_id, google_event_id),
      constraint google_operational_calendar_links_booking_package_unique
        unique (connection_id, calendar_id, booking_id, package_key)
    );
    insert into google_operational_calendar_links
      (connection_id, calendar_id, google_event_id, booking_id, package_key)
    values
      ('c', 'dave', 'zone-event', 'booking', 'zone'),
      ('c', 'dave', 'pirates-event', 'booking', 'pirates'),
      ('c', 'dave', 'warrior-event', 'booking', 'warrior');
  `);
  const migration = await readFile(migrationUrl, "utf8");
  await client.exec(migration);
  await client.exec(migration);

  expect((await client.query(`
    select package_key from google_operational_calendar_links order by package_key
  `)).rows).toEqual([
    { package_key: "pirates" },
    { package_key: "warrior" },
    { package_key: "zone" },
  ]);
  await client.exec(`
    insert into google_operational_calendar_links
      (connection_id, calendar_id, google_event_id, booking_id, package_key)
    values ('c', 'dave', 'combined-event', 'booking', 'combined');
  `);
  await expect(client.exec(`
    insert into google_operational_calendar_links
      (connection_id, calendar_id, google_event_id, booking_id, package_key)
    values ('c', 'dave', 'unknown-event', 'other-booking', 'unknown');
  `)).rejects.toThrow();
  await expect(client.exec(`
    insert into google_operational_calendar_links
      (connection_id, calendar_id, google_event_id, booking_id, package_key)
    values ('c', 'dave', 'second-combined', 'booking', 'combined');
  `)).rejects.toThrow();
});
```

In the startup-upgrade test, capture the emitted DDL and assert it drops and recreates `google_operational_calendar_links_package_key_valid` with `'combined'`.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/db/operational-calendar-combined-migration.pglite.test.ts \
  src/db/google-workspace-operational-calendar-upgrade.test.ts
```

Expected: FAIL because the migration does not exist and the current constraint allows only the three package-specific keys.

- [ ] **Step 3: Implement the schema, migration, and startup repair**

Keep attraction keys separate from the widened persisted link-key domain, then type the link column with the latter:

```ts
export const operationalCalendarPackageKeys = ["zone", "pirates", "warrior"] as const;
export type OperationalCalendarPackageKey =
  (typeof operationalCalendarPackageKeys)[number];

export const operationalCalendarLinkPackageKeys = [
  ...operationalCalendarPackageKeys,
  "combined",
] as const;
export type OperationalCalendarLinkPackageKey =
  (typeof operationalCalendarLinkPackageKeys)[number];

packageKey: text("package_key")
  .$type<OperationalCalendarLinkPackageKey>()
  .notNull(),

check(
  "google_operational_calendar_links_package_key_valid",
  sql`${table.packageKey} in ('zone','pirates','warrior','combined')`,
),
```

Use this exact idempotent migration body:

```sql
ALTER TABLE google_operational_calendar_links
  DROP CONSTRAINT IF EXISTS google_operational_calendar_links_package_key_valid;

ALTER TABLE google_operational_calendar_links
  DROP CONSTRAINT IF EXISTS google_operational_calendar_links_package_key_check;

ALTER TABLE google_operational_calendar_links
  ADD CONSTRAINT google_operational_calendar_links_package_key_valid
  CHECK (package_key IN ('zone','pirates','warrior','combined'));
```

Name the fresh-table constraint `google_operational_calendar_links_package_key_valid`. After `CREATE TABLE IF NOT EXISTS google_operational_calendar_links` in the startup upgrader, drop both the explicit Drizzle name and PostgreSQL's historical inline-check name before adding the four-value constraint. This repairs an already-created production table before the API begins serving traffic.

- [ ] **Step 4: Run the focused database tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/db/operational-calendar-combined-migration.pglite.test.ts \
  src/db/google-workspace-operational-calendar-upgrade.test.ts
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server typecheck
```

Expected: both tests PASS; the database library builds; TypeScript accepts `"combined"` as a persisted link key without allowing it as an attraction key.

- [ ] **Step 5: Commit**

```bash
git add \
  lib/db/src/operational-calendar-schema.ts \
  lib/db/migrations/20260831_operational_calendar_combined_link.sql \
  artifacts/api-server/src/db/google-workspace-operational-calendar-upgrade.ts \
  artifacts/api-server/src/db/google-workspace-operational-calendar-upgrade.test.ts \
  artifacts/api-server/src/db/operational-calendar-combined-migration.pglite.test.ts
git commit -m "feat: add combined operational calendar link"
```

---

### Task 2: Centralize package vocabulary and parse combined title groups

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-packages.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/david-calendar-parser.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/david-calendar-parser.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts`

**Interfaces:**
- Produces:

```ts
export const operationalPackageOrder = ["zone", "pirates", "warrior"] as const;
export type OperationalPackageKey = (typeof operationalPackageOrder)[number];
export const operationalPackageLabels: Record<OperationalPackageKey, string>;
export function isOperationalPackageKey(value: unknown): value is OperationalPackageKey;
export function orderOperationalPackageKeys(keys: Iterable<OperationalPackageKey>): OperationalPackageKey[];
export function operationalPackageKeyFromLabel(label: string): OperationalPackageKey | null;
export function operationalPackageKeyFromTemplateCode(code: string): OperationalPackageKey | null;
export function operationalPackageCodeCandidates(key: OperationalPackageKey): readonly string[];
```

- Changes parser output to:

```ts
type ParsedOperationalCalendarEvent = {
  // existing manager, event, location, state, and description fields remain
  packageKeys: OperationalPackageKey[];
  unrecognizedPackageLabels: string[];
  packageKey: OperationalPackageKey | "unknown"; // compatibility for stored pending reviews and legacy callers
};
```

- Consumed by: renderer/projection in Task 3 and import/review resolution in Task 6.

- [ ] **Step 1: Write failing parser and policy tests**

Add table-driven tests for every approved separator, stable order, deduplication, a legacy single label, and partial unknown input:

```ts
it.each([
  ["(Zone + Pirates + Warrior)", ["zone", "pirates", "warrior"]],
  ["(Warrior, Zone, Pirates)", ["zone", "pirates", "warrior"]],
  ["(Pirates & Zone)", ["zone", "pirates"]],
  ["(Warrior and Pirates)", ["pirates", "warrior"]],
  ["(Zone + Zone + Pirates)", ["zone", "pirates"]],
  ["(Zone)", ["zone"]],
] as const)("parses and orders package group %s", (suffix, packageKeys) => {
  const parsed = parseDavidOperationalCalendarEvent({
    summary: `DAVE County Fair - Dillon MT ${suffix}`,
  });
  expect(parsed.packageKeys).toEqual(packageKeys);
  expect(parsed.unrecognizedPackageLabels).toEqual([]);
});

it("reports a partly unknown package list instead of silently dropping it", () => {
  const parsed = parseDavidOperationalCalendarEvent({
    summary: "DAVE County Fair - Dillon MT (Zone + Unknown Ride)",
  });
  expect(parsed.packageKeys).toEqual(["zone"]);
  expect(parsed.unrecognizedPackageLabels).toEqual(["Unknown Ride"]);
  expect(operationalCalendarReviewReason({ parsed, hasManagerLeg: true }))
    .toBe("Calendar row contains an unrecognized package and needs review");
});
```

Also assert a missing/wholly unknown package group still receives `Calendar row needs manual matching`.

- [ ] **Step 2: Run the parser and policy tests to verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/david-calendar-parser.test.ts \
  src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts
```

Expected: FAIL because the parser currently uses `includes()` once and returns only the first matching package.

- [ ] **Step 3: Implement exact token parsing and the shared package helpers**

Use canonical aliases, not substring matching across the whole parenthetical group:

```ts
const aliases: Record<string, OperationalPackageKey> = {
  zone: "zone",
  "adventure zone": "zone",
  "mini zone": "zone",
  pirate: "pirates",
  pirates: "pirates",
  "pirate s": "pirates",
  "pirate s rebellion": "pirates",
  warrior: "warrior",
  warriors: "warrior",
  "weekend warriors": "warrior",
  "warriors playground": "warrior",
};

function normalizePackageToken(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function operationalPackageKeyFromLabel(label: string) {
  return aliases[normalizePackageToken(label)] ?? null;
}

export function operationalPackageKeyFromTemplateCode(code: string) {
  const normalized = code.trim().toLowerCase();
  if (normalized === "adventure_zone" || normalized === "mini_zone") return "zone";
  if (normalized === "pirates_rebellion" || normalized === "pirate_rebellion") return "pirates";
  if (normalized === "weekend_warriors" || normalized === "warriors_playground") return "warrior";
  return null;
}

export const operationalPackageLabels: Record<OperationalPackageKey, string> = {
  zone: "Zone",
  pirates: "Pirates",
  warrior: "Warrior",
};

const codeCandidates: Record<OperationalPackageKey, readonly string[]> = {
  zone: ["adventure_zone", "mini_zone"],
  pirates: ["pirates_rebellion", "pirate_rebellion"],
  warrior: ["weekend_warriors", "warriors_playground"],
};

export function operationalPackageCodeCandidates(key: OperationalPackageKey) {
  return codeCandidates[key];
}

export function orderOperationalPackageKeys(
  keys: Iterable<OperationalPackageKey>,
): OperationalPackageKey[] {
  const selected = new Set(keys);
  return operationalPackageOrder.filter((key) => selected.has(key));
}

export function isOperationalPackageKey(value: unknown): value is OperationalPackageKey {
  return typeof value === "string"
    && operationalPackageOrder.includes(value as OperationalPackageKey);
}
```

Split the trailing group with `+`, comma, `&`, or the word `and`, retain the original trimmed text for unmatched tokens, then return canonical order:

```ts
const tokens = (packageText ?? "")
  .split(/\s*(?:\+|,|&|\band\b)\s*/i)
  .map((value) => value.trim())
  .filter(Boolean);
const recognized = tokens
  .map(operationalPackageKeyFromLabel)
  .filter((value): value is OperationalPackageKey => value !== null);
const packageKeys = orderOperationalPackageKeys(recognized);
const unrecognizedPackageLabels = tokens.filter(
  (value) => operationalPackageKeyFromLabel(value) === null,
);
```

Set compatibility `packageKey` to `packageKeys[0] ?? "unknown"`; all new multi-package logic must use `packageKeys`.

- [ ] **Step 4: Run parser/policy tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/david-calendar-parser.test.ts \
  src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: separator, order, duplicate, legacy, and partial-unknown cases PASS without changing labeled description parsing.

- [ ] **Step 5: Commit**

```bash
git add \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-packages.ts \
  artifacts/api-server/src/features/google-workspace/calendar/david-calendar-parser.ts \
  artifacts/api-server/src/features/google-workspace/calendar/david-calendar-parser.test.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts
git commit -m "feat: parse combined operational packages"
```

---

### Task 3: Render exactly one ordered booking-level event

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-renderer.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-renderer.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-projection-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-projection-booked-state.test.ts`

**Interfaces:**
- Replaces `renderOperationalCalendarRows()` with:

```ts
export type RenderedOperationalCalendarEvent = {
  packageKey: "combined";
  packageKeys: OperationalPackageKey[];
  summary: string;
  description: string;
  reservedStart: Date;
  reservedEnd: Date;
};

export function renderOperationalCalendarEvent(
  input: ConfirmedBookingProjection,
): RenderedOperationalCalendarEvent;
```

- `ConfirmedBookingProjection.packages` is `OperationalPackageKey[]` and is already non-empty when returned by the projection repository.
- Consumed by: `OperationalCalendarSyncService` in Task 5.

- [ ] **Step 1: Replace the per-package renderer test with failing combined-event tests**

```ts
it("renders one event with packages in canonical order and all attraction names", () => {
  const event = renderOperationalCalendarEvent({
    ...base,
    packages: ["warrior", "zone", "pirates", "zone"],
    attractionText: "Adventure Zone + Pirate's Rebellion + Weekend Warriors",
  });
  expect(event).toMatchObject({
    packageKey: "combined",
    packageKeys: ["zone", "pirates", "warrior"],
    summary: "MIKEY Blanding City Fall Festival - Blanding UT (Zone + Pirates + Warrior)",
  });
  expect(event.description).toContain(
    "ATTRACTION LIST: Adventure Zone + Pirate's Rebellion + Weekend Warriors",
  );
});

it("keeps a single-package booking as one combined-owned event", () => {
  const event = renderOperationalCalendarEvent(base);
  expect(event.packageKey).toBe("combined");
  expect(event.summary).toBe(
    "MIKEY Blanding City Fall Festival - Blanding UT (Zone)",
  );
});
```

Keep the existing assertions for reserved dates and omission of empty description fields.

- [ ] **Step 2: Run renderer/projection tests to verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/operational-calendar-renderer.test.ts \
  src/features/google-workspace/calendar/operational-calendar-projection-booked-state.test.ts
```

Expected: FAIL because the renderer currently returns one array row per package.

- [ ] **Step 3: Implement singular rendering and deterministic projection ordering**

Render the title suffix once:

```ts
const packageKeys = orderOperationalPackageKeys(input.packages);
if (packageKeys.length === 0) {
  throw new Error("GOOGLE_OPERATIONAL_CALENDAR_PACKAGE_REQUIRED");
}
const suffix = packageKeys
  .map((key) => operationalPackageLabels[key])
  .join(" + ");

return {
  packageKey: "combined",
  packageKeys,
  summary: `${base} (${suffix})`,
  description: description.join("\n"),
  reservedStart: input.reservedStart,
  reservedEnd: input.reservedEnd,
};
```

In the projection repository, map template codes to recognized package keys, sort/deduplicate via `operationalPackageOrder`, and build `attractionText` in the same order. Do not pass `"combined"` to template-code matching:

```ts
const packageNameByKey = new Map<OperationalPackageKey, string>();
for (const row of [...packageRows].sort((a, b) => a.name.localeCompare(b.name))) {
  const key = operationalPackageKeyFromTemplateCode(row.code);
  if (key && !packageNameByKey.has(key)) packageNameByKey.set(key, row.name);
}
const packages = orderOperationalPackageKeys(packageNameByKey.keys());
const attractionText = packages.map((key) => packageNameByKey.get(key)!).join(" + ") || null;
```

- [ ] **Step 4: Run renderer/projection tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/operational-calendar-renderer.test.ts \
  src/features/google-workspace/calendar/operational-calendar-projection-booked-state.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: one result, stable title order, complete attraction list, correct operational window, and no invented fields.

- [ ] **Step 5: Commit**

```bash
git add \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-renderer.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-renderer.test.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-projection-repository.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-projection-booked-state.test.ts
git commit -m "feat: render one combined calendar event"
```

---

### Task 4: Add deterministic legacy-link promotion

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-selection.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-selection.test.ts`

**Interfaces:**
- Extends `OperationalCalendarLink` with `createdAt: Date` and types its `packageKey` as `OperationalCalendarLinkPackageKey`.
- Produces:

```ts
export function legacyLinksInPromotionOrder(
  links: OperationalCalendarLink[],
): OperationalCalendarLink[];

export interface OperationalCalendarLinkPromotionStore {
  promoteToCombined(input: {
    linkId: string;
    connectionId: string;
    calendarId: string;
    bookingId: string;
    promotedAt: Date;
  }): Promise<OperationalCalendarLink>;
}
```

- Promotion changes only the selected database row's `packageKey`; it does not delete or mutate another legacy row or Google event.
- Consumed by: sync in Task 5 and combined import/review resolution in Task 6.

- [ ] **Step 1: Write failing selection tests**

```ts
it("returns legacy links oldest-first and excludes an existing combined link", () => {
  expect(legacyLinksInPromotionOrder([
    link({ id: "pirates", packageKey: "pirates", createdAt: new Date("2026-08-02") }),
    link({ id: "combined", packageKey: "combined", createdAt: new Date("2026-08-03") }),
    link({ id: "zone", packageKey: "zone", createdAt: new Date("2026-08-01") }),
  ]).map((item) => item.id)).toEqual(["zone", "pirates"]);
});

it("uses id as a stable tie breaker", () => {
  const createdAt = new Date("2026-08-01");
  expect(legacyLinksInPromotionOrder([
    link({ id: "b", packageKey: "pirates", createdAt }),
    link({ id: "a", packageKey: "zone", createdAt }),
  ]).map((item) => item.id)).toEqual(["a", "b"]);
});
```

- [ ] **Step 2: Run the selection test to verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/operational-calendar-link-selection.test.ts
```

Expected: FAIL because neither the selector nor `createdAt` projection exists.

- [ ] **Step 3: Implement selection and transactional promotion**

Use a pure stable selector:

```ts
export function legacyLinksInPromotionOrder(links: OperationalCalendarLink[]) {
  return links
    .filter((link) => link.packageKey !== "combined")
    .sort((left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime()
      || left.id.localeCompare(right.id),
    );
}
```

In `promoteToCombined`, lock every link for the booking in stable order, verify the selected identity, recheck for an existing combined row, and then update only the selected row. Locking the complete booking set prevents two concurrent sends from promoting different legacy rows:

```ts
return this.db.transaction(async (tx) => {
  const locked = await tx.select().from(googleOperationalCalendarLinks)
    .where(and(
      eq(googleOperationalCalendarLinks.connectionId, input.connectionId),
      eq(googleOperationalCalendarLinks.calendarId, input.calendarId),
      eq(googleOperationalCalendarLinks.bookingId, input.bookingId),
    ))
    .orderBy(asc(googleOperationalCalendarLinks.createdAt), asc(googleOperationalCalendarLinks.id))
    .for("update");
  const selected = locked.find((row) => row.id === input.linkId);
  if (!selected) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_LINK_NOT_FOUND");

  const alreadyCombined = locked.find((row) => row.packageKey === "combined");
  if (alreadyCombined) return toLink(alreadyCombined);

  const [promoted] = await tx.update(googleOperationalCalendarLinks).set({
    packageKey: "combined",
    updatedAt: input.promotedAt,
  }).where(eq(googleOperationalCalendarLinks.id, selected.id)).returning();
  if (!promoted) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_LINK_PROMOTION_FAILED");
  return toLink(promoted);
});
```

Make `listByBooking()` return `createdAt` through `toLink()`; do not change or delete non-selected legacy links.

- [ ] **Step 4: Run the selection test and API typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/operational-calendar-link-selection.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: deterministic selection PASS and repository/service interfaces compile.

- [ ] **Step 5: Commit**

```bash
git add \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-repository.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-selection.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-selection.test.ts
git commit -m "feat: promote legacy calendar links safely"
```

---

### Task 5: Sync one combined event and reuse it on every send

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-existing-event.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-existing-event.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-dedupe.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-app-authority.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-combined.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-legacy-promotion.test.ts`

**Interfaces:**
- Consumes: `renderOperationalCalendarEvent()`, `packageKey: "combined"`, `packageKeys`, `listByBooking()`, `promoteToCombined()`, and `legacyLinksInPromotionOrder()`.
- Update `OperationalCalendarLinkStore.findByBookingPackage()` and `saveSuccessfulSync()` to accept `OperationalCalendarLinkPackageKey`, require `listByBooking()`, and add the same `promoteToCombined()` signature produced by Task 4.
- Preserves the public result union:

```ts
type OperationalCalendarSyncResult =
  | { state: "not_confirmed_or_incomplete" }
  | { state: "not_connected" }
  | { state: "synced"; created: number; updated: number }
  | { state: "review_required"; created: number; updated: number; reviewCount: number };
```

- Produces at most one create or update for one `syncConfirmedBooking()` call.

- [ ] **Step 1: Write failing normal-path combined sync tests**

Cover all of these behaviors in `operational-calendar-sync-combined.test.ts`:

```ts
it("creates one Google event for three packages", async () => {
  const result = await serviceFor({ packages: ["zone", "pirates", "warrior"] }).syncConfirmedBooking("booking-1");
  expect(result).toEqual({ state: "synced", created: 1, updated: 0 });
  expect(client.createEvent).toHaveBeenCalledTimes(1);
  expect(client.createEvent).toHaveBeenCalledWith("dave", expect.objectContaining({
    summary: expect.stringContaining("(Zone + Pirates + Warrior)"),
  }));
  expect(links.saveSuccessfulSync).toHaveBeenCalledWith(expect.objectContaining({
    packageKey: "combined",
    lastAppSnapshot: expect.objectContaining({
      packageKeys: ["zone", "pirates", "warrior"],
    }),
  }));
});

it("updates the same combined event on a second send and after a package change", async () => {
  await service.syncConfirmedBooking("booking-1");
  projection.packages = ["zone", "pirates"];
  await service.syncConfirmedBooking("booking-1");
  expect(client.createEvent).toHaveBeenCalledTimes(1);
  expect(client.updateEvent).toHaveBeenCalledTimes(1);
  expect(client.updateEvent).toHaveBeenLastCalledWith(expect.objectContaining({
    eventId: "google-combined-1",
    event: expect.objectContaining({ summary: expect.stringContaining("(Zone + Pirates)") }),
  }));
});
```

Also keep explicit cases for `not_connected` and incomplete bookings.

- [ ] **Step 2: Write failing adoption, ambiguity, and promotion tests**

Update exact-match tests so title comparison trims, lowercases, and collapses whitespace, while dates remain exact. Add:

```ts
expect(findExactOperationalCalendarEvent([
  { ...expected, summary: "  kristy   Meeteetse ... (Zone + Pirates)  " },
], input)).toMatchObject({ kind: "matched" });
```

In sync tests, prove:

- one exact unlinked combined event is adopted with `created: 0, updated: 1`;
- two exact events create one review and call neither `createEvent` nor `updateEvent`;
- the oldest Google event that still exists is promoted and updated in place;
- if the oldest legacy link is missing but the next exists, the next valid link is promoted;
- if every legacy link is missing, create a missing-event review and never create a replacement;
- extra legacy links are not updated or deleted;
- when a combined link exists, the non-confirmed status path updates only that link.

- [ ] **Step 3: Run sync tests to verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/operational-calendar-existing-event.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-dedupe.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-combined.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-legacy-promotion.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-app-authority.test.ts
```

Expected: FAIL because sync still loops through rendered package rows and looks up a link by each package key.

- [ ] **Step 4: Replace the package loop with one combined sync state machine**

Build one input and include package keys in the snapshot:

```ts
const rendered = renderOperationalCalendarEvent(projection);
const eventInput = calendarInput(rendered);
const appSnapshot = {
  ...eventSnapshot(eventInput),
  packageKeys: rendered.packageKeys,
};
```

Resolve the owned link in this order:

1. `findByBookingPackage(... packageKey: "combined")`.
2. If absent, `listByBooking()` and check legacy links oldest-first with `client.getEvent()`.
3. Promote the first non-cancelled event that exists.
4. If legacy rows exist but none exists in Google, create `Linked calendar event is missing` review and stop.
5. If no links exist, list the reserved window and run exact combined title/date adoption.
6. If exactly one match exists, save it as `combined` without creating.
7. If multiple matches exist, create `Multiple matching calendar events found` review and stop.
8. Otherwise create exactly one event.

Use normalized title comparison:

```ts
function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
```

Keep `handleLinkedWriteError()` unchanged for ETag conflict and missing-event review semantics. In `syncPreviouslyLinkedNonConfirmedBooking()`, select only the combined link when present; otherwise promote and update one valid legacy link rather than looping over all legacy rows.

- [ ] **Step 5: Run sync tests, parser/renderer regressions, and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/david-calendar-parser.test.ts \
  src/features/google-workspace/calendar/operational-calendar-renderer.test.ts \
  src/features/google-workspace/calendar/operational-calendar-existing-event.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-dedupe.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-combined.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-legacy-promotion.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-app-authority.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: every create/update/adoption/promotion/review case PASS, with no test observing more than one app-owned event write per booking.

- [ ] **Step 6: Commit**

```bash
git add \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-service.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-existing-event.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-existing-event.test.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-dedupe.test.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-app-authority.test.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-combined.test.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-sync-legacy-promotion.test.ts
git commit -m "feat: sync one combined operational event"
```

---

### Task 6: Import and resolve all packages without losing legacy compatibility

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-review-projection.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-review-projection.test.ts`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/operational-calendar-settings-card.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/operational-calendar-settings-card.review-details.test.tsx`

**Interfaces:**
- `operationalCalendarReviewReason()` rejects empty or partially unrecognized lists.
- `ensurePackages(bookingId, packageKeys)` assigns every recognized package once.
- A title with multiple package keys saves `packageKey: "combined"`; an already-linked combined event remains combined even if it currently has one package.
- A legacy single-package calendar row remains importable and keeps its package-specific link until Task 5 promotes it.
- `ReviewChanges.parsed.packageKeys` is preferred; stored pending reviews with only `packageKey` remain resolvable.

- [ ] **Step 1: Write failing combined import and safety tests**

Add one Google event fixture with:

```ts
{
  id: "google-combined",
  summary: "DAVE Beaverhead County Fair - Dillon MT (Warrior + Zone + Pirates)",
  description: [
    "EVENT DATES: September 2–6, 2026",
    "ATTRACTION LIST: Adventure Zone + Pirate's Rebellion + Weekend Warriors",
  ].join("\n"),
  startDate: "2026-08-31",
  endDateExclusive: "2026-09-08",
}
```

Assert the import creates/matches one booking, makes three distinct booking-package selections, saves one link with `packageKey: "combined"`, and stores canonical `packageKeys` in `lastAppSnapshot`:

```ts
expect(packageSelections.map((row) => row.packageTemplateId)).toEqual([
  "package-adventure_zone",
  "package-pirates_rebellion",
  "package-weekend_warriors",
]);
expect(links.saveSuccessfulSync).toHaveBeenCalledWith(expect.objectContaining({
  googleEventId: "google-combined",
  packageKey: "combined",
  lastAppSnapshot: expect.objectContaining({
    packageKeys: ["zone", "pirates", "warrior"],
  }),
}));
```

Add policy tests proving `(Zone + Unknown Ride)` and `(Unknown Ride)` create review. Keep the existing two legacy package-row test as backward-compatibility coverage.

- [ ] **Step 2: Write failing review-resolution and review-display tests**

Seed a review whose `proposedChanges.parsed.packageKeys` is `['zone','pirates','warrior']`, resolve it, and assert three selections plus one combined link. Seed a second review with only legacy `packageKey: 'zone'` and assert it still resolves.

Update review projection/UI expectations:

```ts
expect(projected.packageKeys).toEqual(["zone", "pirates", "warrior"]);
expect(screen.getByText("Packages:")).toBeTruthy();
expect(screen.getByText("Zone + Pirates + Warrior")).toBeTruthy();
```

- [ ] **Step 3: Run import/review tests to verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts \
  src/features/google-workspace/calendar/operational-calendar-import-service.test.ts \
  src/features/google-workspace/calendar/operational-calendar-review-projection.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/google-workspace/operational-calendar-settings-card.review-details.test.tsx
```

Expected: FAIL because import and review resolution currently use only `parsed.packageKey` and the UI displays `Package:` singular.

- [ ] **Step 4: Implement multi-package import policy and persistence**

Apply preflight rules in this order:

```ts
if (parsed.calendarState !== "confirmed") return stateReason;
if (!parsed.eventName.trim() || parsed.packageKeys.length === 0) {
  return "Calendar row needs manual matching";
}
if (parsed.unrecognizedPackageLabels.length > 0) {
  return "Calendar row contains an unrecognized package and needs review";
}
if (!parsed.managerToken || !hasManagerLeg) {
  return "Calendar row needs a recognized manager leg";
}
```

Replace `ensurePackage()` with an ordered loop over `packageKeys`, using `operationalPackageCodeCandidates(key)` which accepts only concrete package keys. Determine persisted link identity with:

```ts
const persistedPackageKey: OperationalCalendarLinkPackageKey =
  existingLink?.packageKey === "combined" || parsed.packageKeys.length > 1
    ? "combined"
    : parsed.packageKeys[0]!;
```

Store `packageKeys` in the import snapshot. If promoting an existing legacy link for a multi-package event, call `promoteToCombined()` before saving the same `googleEventId`; never insert a second link for that Google event.

- [ ] **Step 5: Implement backward-compatible review resolution and display**

Read new and old review payloads safely:

```ts
const packageKeys = Array.isArray(parsed.packageKeys)
  ? orderOperationalPackageKeys(parsed.packageKeys.filter(isOperationalPackageKey))
  : isOperationalPackageKey(parsed.packageKey)
    ? [parsed.packageKey]
    : [];
if (packageKeys.length === 0) {
  throw new Error("GOOGLE_OPERATIONAL_CALENDAR_PACKAGE_REQUIRED");
}
```

Insert every selected template with `onConflictDoNothing()`. Save review-resolved multi-package events as `combined`; retain the concrete key for a legacy one-package review. Project `packageKeys` to the review UI and label the field `Packages:`.

- [ ] **Step 6: Run import/review tests, the legacy import suite, and both typechecks**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/calendar/david-calendar-parser.test.ts \
  src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts \
  src/features/google-workspace/calendar/operational-calendar-import-service.test.ts \
  src/features/google-workspace/calendar/operational-calendar-review-projection.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/google-workspace/operational-calendar-settings-card.review-details.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: combined import, partial-unknown review, legacy single-row import, old pending-review fallback, and plural UI all PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-service.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-service.test.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-link-repository.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-review-projection.ts \
  artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-review-projection.test.ts \
  artifacts/adventure-zone/src/components/google-workspace/operational-calendar-settings-card.tsx \
  artifacts/adventure-zone/src/components/google-workspace/operational-calendar-settings-card.review-details.test.tsx
git commit -m "feat: import combined calendar packages"
```

---

### Task 7: Make Send feedback explicitly singular and protect it in CI

**Files:**
- Modify: `artifacts/adventure-zone/src/components/bookings/booking-calendar-send-button.tsx`
- Modify: `artifacts/adventure-zone/src/components/bookings/booking-calendar-send-button.test.tsx`
- Modify: `.github/workflows/google-workspace-sync-ci.yml`

**Interfaces:**
- Consumes the unchanged `OperationalCalendarSyncResult` union.
- Produces distinct created/updated success messages without adding an API field.
- Keeps the existing not-connected and incomplete-booking messages.

- [ ] **Step 1: Write failing exact-copy tests**

```ts
it("says one combined event was created", async () => {
  const syncBooking = vi.fn().mockResolvedValue({ state: "synced", created: 1, updated: 0 });
  render(<BookingCalendarSendButton bookingId={bookingId} syncBooking={syncBooking} />);
  fireEvent.click(screen.getByRole("button", { name: "Send to Dave's Calendar" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Sent one event to Dave's Calendar with all packages listed together.",
  );
});

it("says the existing combined event was updated", async () => {
  const syncBooking = vi.fn().mockResolvedValue({ state: "synced", created: 0, updated: 1 });
  render(<BookingCalendarSendButton bookingId={bookingId} syncBooking={syncBooking} />);
  fireEvent.click(screen.getByRole("button", { name: "Send to Dave's Calendar" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Updated the existing event on Dave's Calendar with all packages listed together.",
  );
});
```

Add a `review_required` assertion containing `one calendar event` and no wording that implies a row per package.

- [ ] **Step 2: Run the frontend test to verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/bookings/booking-calendar-send-button.test.tsx
```

Expected: FAIL because created and updated results currently share the generic message.

- [ ] **Step 3: Implement singular result messaging**

```ts
if (result.state === "synced") {
  return result.created > 0
    ? {
        kind: "success",
        message: "Sent one event to Dave's Calendar with all packages listed together.",
      }
    : {
        kind: "success",
        message: "Updated the existing event on Dave's Calendar with all packages listed together.",
      };
}
if (result.state === "review_required") {
  return {
    kind: "success",
    message: "Dave's one calendar event is waiting for review; another event was not created.",
  };
}
```

Do not change button state, destination selection, or the API response type.

- [ ] **Step 4: Expand Google Workspace CI path filters and focused commands**

Add these paths to the workflow trigger:

```yaml
- "lib/db/src/operational-calendar-schema.ts"
- "lib/db/migrations/*operational_calendar*"
- "artifacts/api-server/src/db/*operational-calendar*"
- "artifacts/api-server/src/features/google-workspace/calendar/**"
- "artifacts/api-server/src/routes/google-operational-calendar.ts"
- "artifacts/api-server/src/routes/operational-calendar-sync-hook.ts"
- "artifacts/adventure-zone/src/components/bookings/booking-calendar-send-button*"
- "artifacts/adventure-zone/src/components/google-workspace/operational-calendar-settings-card*"
```

Ensure the frontend Vitest step includes both changed component tests:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/bookings/booking-calendar-send-button.test.tsx \
  src/components/google-workspace/operational-calendar-settings-card.review-details.test.tsx
```

- [ ] **Step 5: Run the UI tests and frontend typecheck/build**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/bookings/booking-calendar-send-button.test.tsx \
  src/components/google-workspace/operational-calendar-settings-card.review-details.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: exact singular copy tests PASS and the production frontend bundle builds.

- [ ] **Step 6: Commit**

```bash
git add \
  artifacts/adventure-zone/src/components/bookings/booking-calendar-send-button.tsx \
  artifacts/adventure-zone/src/components/bookings/booking-calendar-send-button.test.tsx \
  .github/workflows/google-workspace-sync-ci.yml
git commit -m "feat: clarify combined calendar send status"
```

---

### Task 8: Run the complete combined-event verification gate

**Files:**
- Verify only; modify a file only if a failing test exposes a defect within this specification.

**Interfaces:**
- Proves all eleven behaviors listed in the approved spec and confirms the current API/frontend contracts still build.

- [ ] **Step 1: Run the full focused API suite**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/db/operational-calendar-combined-migration.pglite.test.ts \
  src/db/google-workspace-operational-calendar-upgrade.test.ts \
  src/features/google-workspace/calendar/david-calendar-parser.test.ts \
  src/features/google-workspace/calendar/operational-calendar-renderer.test.ts \
  src/features/google-workspace/calendar/operational-calendar-projection-booked-state.test.ts \
  src/features/google-workspace/calendar/operational-calendar-link-selection.test.ts \
  src/features/google-workspace/calendar/operational-calendar-existing-event.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-dedupe.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-combined.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-legacy-promotion.test.ts \
  src/features/google-workspace/calendar/operational-calendar-sync-app-authority.test.ts \
  src/features/google-workspace/calendar/operational-calendar-import-policy.test.ts \
  src/features/google-workspace/calendar/operational-calendar-import-service.test.ts \
  src/features/google-workspace/calendar/operational-calendar-review-projection.test.ts
```

Expected: PASS with coverage for one rendered row, ordered labels, complete attraction list, repeat update, package-change update, exact adoption, ambiguous review, legacy promotion, parser compatibility, multi-package import, incomplete booking, and missing connection.

- [ ] **Step 2: Run the focused frontend suite**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/bookings/booking-calendar-send-button.test.tsx \
  src/components/google-workspace/operational-calendar-settings-card.review-details.test.tsx
```

Expected: PASS with singular Send feedback and plural package review display.

- [ ] **Step 3: Run workspace typechecks and production builds**

```bash
pnpm typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform a final destructive-action and identity audit**

Run:

```bash
rg -n "deleteEvent|events\.delete|packageKey: row\.packageKey|renderOperationalCalendarRows" \
  artifacts/api-server/src/features/google-workspace/calendar \
  artifacts/api-server/src/routes/google-operational-calendar.ts
```

Expected:

- no new Google event deletion call;
- no confirmed-booking loop that writes once per package;
- no active use of `renderOperationalCalendarRows`;
- persisted app-owned sync links use `packageKey: "combined"`;
- legacy package keys appear only in parser/import compatibility and promotion code.

- [ ] **Step 5: Verify repository cleanliness and commit only test-driven corrections**

```bash
git status --short
```

Expected: clean after Tasks 1–7. If Task 8 exposed and fixed a scoped defect, rerun the failing command, stage only those correction files, and commit them with:

```bash
git commit -m "fix: complete combined calendar verification"
```
