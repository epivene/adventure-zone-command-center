# Place-Person Relationship Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable Place-Person and Booking-Person relationships while preserving the existing organization/contact/booking identifiers and compatibility pointers.

**Architecture:** Keep the physical `organizations`, `contacts`, and `bookings` tables, and add normalized association tables beside them. A small relationship module owns all association writes; `contacts.organizationId` remains a Person's primary Place pointer and `bookings.primaryContactId` remains a Booking's primary Person pointer. Migration backfills every existing pointer, and a read-only reconciliation report exposes legacy exceptions without deleting or fabricating data.

**Tech Stack:** Next.js 16 App Router and server actions, React 19, TypeScript 6, Drizzle ORM 0.45/PostgreSQL, Clerk owner authorization, Zod 4, Vitest/Testing Library, Playwright.

## Global Constraints

- User-facing language is Place and Person; physical database names remain `organizations` and `contacts`.
- One Person may have active relationships with several Places.
- A Place-Person pair is unique.
- At most one active Place-Person row is the Place's primary Person.
- A primary Place-Person row is always active.
- `contacts.organizationId` is a Person's primary Place pointer, not the Place's primary Person flag.
- Every non-null `contacts.organizationId` has an active Place-Person association after migration and after every write.
- A composite foreign key prevents `contacts.organizationId` from referencing
  a Place-Person pair that does not exist.
- A Booking-Person pair is unique, and at most one Person is primary for a Booking.
- `bookings.primaryContactId` and the primary Booking-Person association are updated in the same transaction.
- A composite foreign key prevents `bookings.primaryContactId` from referencing
  a Booking-Person pair that does not exist.
- Changing a Booking's Place retains only People who have active relationships with the new Place.
- Existing record IDs, Act! IDs, calls, activities, follow-ups, audit history, packages, resources, routes, and legacy import/sync history are preserved.
- Existing legacy Bookings without a Place remain readable and appear in reconciliation; this slice does not invent a Place for them.
- No Act! Company/Opportunity migration, Place-first screen redesign, calling-list UI, or call-draft redesign is implemented in this slice.
- No ambiguous Place or Person is automatically merged, and no source absence deletes a local record.
- All important local relationship mutations write audit entries in the same transaction.

---

## File Structure

- `db/schema.ts` - declares the two association tables and database constraints.
- `db/migrations/0008_place_person_relationships.sql` - creates and backfills the association tables.
- `features/relationships/relationship-types.ts` - shared Place-Person contracts and typed errors.
- `features/relationships/relationship-input.ts` - Zod validation for relationship mutations.
- `features/relationships/relationship-writer.ts` - transaction-compatible helpers used by every contact writer.
- `features/relationships/relationship-repository.ts` - Place-Person reads and atomic mutations.
- `features/relationships/relationship-service.ts` - validation and result mapping.
- `features/bookings/booking-relationship-input.ts` - validates Booking Place/People mutations.
- `features/bookings/booking-relationship-repository.ts` - locks and updates Booking relationships atomically.
- `features/bookings/booking-relationship-service.ts` - enforces Place membership before persisting Booking People.
- `features/relationships/relationship-reconciliation.ts` - reports pointer and association exceptions without mutating data.
- Existing contact, Act! sync, and legacy Act! import writers - call the shared transaction helper.
- Existing organization, contact, and booking repositories - read complete association data.

### Task 1: Add association tables and a preservation-first backfill

**Files:**

- Modify: `db/schema.ts:102-178`
- Create: `db/migrations/0008_place_person_relationships.sql`
- Modify: `db/migrations/meta/_journal.json`
- Create: `db/migrations/meta/0008_snapshot.json`
- Modify: `tests/unit/schema-contract.test.ts`
- Create: `tests/integration/place-person-relationship-migration.test.ts`
- Modify: `tests/integration/contact-repository.test.ts`
- Modify: `tests/integration/organization-repository-postgres.test.ts`
- Modify: `tests/integration/activity-service.test.ts`
- Modify: `tests/integration/call-service.test.ts`

**Interfaces:**

- Consumes: existing `organizations`, `contacts`, and `bookings` primary keys and compatibility pointers.
- Produces: `organizationContacts` and `bookingContacts` Drizzle tables.
- Produces these database invariants:
  - unique `(organization_id, contact_id)`;
  - at most one active primary contact per organization;
  - a primary organization-contact row cannot be inactive;
  - unique `(booking_id, contact_id)`;
  - at most one primary contact per booking;
  - non-null Contact primary-Place pointers require the corresponding pair;
  - non-null Booking primary-Person pointers require the corresponding pair.

- [ ] **Step 1: Write the failing schema contract**

Add the imports and contract assertions to `tests/unit/schema-contract.test.ts`:

```ts
import {
  bookingContacts,
  organizationContacts,
} from "@/db/schema";

it("exports normalized Place-Person and Booking-Person relationships", () => {
  expect(Object.keys(organizationContacts)).toEqual(expect.arrayContaining([
    "id",
    "organizationId",
    "contactId",
    "role",
    "isPrimary",
    "active",
    "source",
    "createdAt",
    "updatedAt",
  ]));
  expect(Object.keys(bookingContacts)).toEqual(expect.arrayContaining([
    "id",
    "bookingId",
    "contactId",
    "role",
    "isPrimary",
    "source",
    "createdAt",
    "updatedAt",
  ]));

  expect(
    getTableConfig(organizationContacts).uniqueConstraints
      .map((constraint) => constraint.name),
  ).toContain("organization_contacts_organization_contact_unique");
  expect(
    getTableConfig(organizationContacts).indexes
      .filter((index) => index.config.unique)
      .map((index) => index.config.name),
  ).toContain("organization_contacts_one_active_primary");
  expect(
    getTableConfig(organizationContacts).checks.map((check) => check.name),
  ).toContain("organization_contacts_primary_is_active");
  expect(
    getTableConfig(bookingContacts).uniqueConstraints
      .map((constraint) => constraint.name),
  ).toContain("booking_contacts_booking_contact_unique");
  expect(
    getTableConfig(bookingContacts).indexes
      .filter((index) => index.config.unique)
      .map((index) => index.config.name),
  ).toContain("booking_contacts_one_primary");
  expect(
    getTableConfig(contacts).foreignKeys.map((key) => key.getName()),
  ).toContain("contacts_primary_organization_contact_fk");
  expect(
    getTableConfig(bookings).foreignKeys.map((key) => key.getName()),
  ).toContain("bookings_primary_booking_contact_fk");
});
```

- [ ] **Step 2: Run the schema contract and verify the red state**

Run:

```powershell
npx vitest run tests/unit/schema-contract.test.ts
```

Expected: FAIL because `organizationContacts` and `bookingContacts` are not exported.

- [ ] **Step 3: Declare the association tables**

Add these declarations after `bookings` in `db/schema.ts`:

```ts
export const organizationContacts = pgTable(
  "organization_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    role: text("role"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    source: text("source").default("local").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("organization_contacts_organization_contact_unique").on(
      table.organizationId,
      table.contactId,
    ),
    uniqueIndex("organization_contacts_one_active_primary")
      .on(table.organizationId)
      .where(sql`${table.active} and ${table.isPrimary}`),
    index("organization_contacts_contact_id_idx").on(table.contactId),
    check(
      "organization_contacts_primary_is_active",
      sql`not ${table.isPrimary} or ${table.active}`,
    ),
  ],
);

export const bookingContacts = pgTable(
  "booking_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    role: text("role"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    source: text("source").default("local").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("booking_contacts_booking_contact_unique").on(
      table.bookingId,
      table.contactId,
    ),
    uniqueIndex("booking_contacts_one_primary")
      .on(table.bookingId)
      .where(sql`${table.isPrimary}`),
    index("booking_contacts_contact_id_idx").on(table.contactId),
  ],
);
```

Import `foreignKey` and `unique` from `drizzle-orm/pg-core`. Add these named
composite foreign keys to the existing `contacts` and `bookings` table
callbacks:

```ts
foreignKey({
  columns: [table.organizationId, table.id],
  foreignColumns: [
    organizationContacts.organizationId,
    organizationContacts.contactId,
  ],
  name: "contacts_primary_organization_contact_fk",
}),

foreignKey({
  columns: [table.id, table.primaryContactId],
  foreignColumns: [
    bookingContacts.bookingId,
    bookingContacts.contactId,
  ],
  name: "bookings_primary_booking_contact_fk",
}),
```

Use deferred callback references and `AnyPgColumn` annotations where TypeScript
needs them for the circular parent/link definitions. The generated SQL must add
these two foreign keys only after both association tables and the backfill rows
exist.

`source` is deliberately text rather than a PostgreSQL enum so later reviewed
Act! migration work can add a source label without another enum migration.

- [ ] **Step 4: Write the failing migration preservation test**

In `tests/integration/place-person-relationship-migration.test.ts`, follow the
isolated-schema pattern in `tests/integration/daily-crm-migration.test.ts`.
Apply migrations `0000` through `0007`, insert:

```ts
const ids = {
  place: "11111111-1111-4111-8111-111111111111",
  otherPlace: "22222222-2222-4222-8222-222222222222",
  person: "33333333-3333-4333-8333-333333333333",
  secondPerson: "44444444-4444-4444-8444-444444444444",
  booking: "55555555-5555-4555-8555-555555555555",
  legacyBooking: "66666666-6666-4666-8666-666666666666",
};
```

Seed two People whose `organization_id` is `ids.place`, one Booking whose
Place and primary Person are populated, and one legacy Booking with a primary
Person but a null Place. After applying `0008`, assert:

```ts
expect(await transaction.unsafe(`
  SELECT organization_id, contact_id, is_primary, active, source
  FROM ${schema}.organization_contacts
  ORDER BY organization_id, contact_id
`)).toEqual([
  {
    organization_id: ids.place,
    contact_id: ids.person,
    is_primary: false,
    active: true,
    source: "legacy_backfill",
  },
  {
    organization_id: ids.place,
    contact_id: ids.secondPerson,
    is_primary: false,
    active: true,
    source: "legacy_backfill",
  },
]);

expect(await transaction.unsafe(`
  SELECT booking_id, contact_id, is_primary, source
  FROM ${schema}.booking_contacts
  ORDER BY booking_id
`)).toEqual([
  {
    booking_id: ids.booking,
    contact_id: ids.person,
    is_primary: true,
    source: "legacy_backfill",
  },
  {
    booking_id: ids.legacyBooking,
    contact_id: ids.secondPerson,
    is_primary: true,
    source: "legacy_backfill",
  },
]);
```

Also assert all original organization, contact, booking, Act! link, activity,
follow-up, call-session, package, and resource IDs remain unchanged.
Attempt to update a Contact or Booking pointer to a pair that has no
association and assert PostgreSQL raises `foreign_key_violation`.

- [ ] **Step 5: Generate the migration and append deterministic backfill SQL**

Run:

```powershell
npx drizzle-kit generate
```

Rename only the generated SQL file to
`db/migrations/0008_place_person_relationships.sql` if needed. After the
generated table/index/foreign-key statements, append:

```sql
INSERT INTO "organization_contacts" (
  "organization_id",
  "contact_id",
  "is_primary",
  "active",
  "source"
)
SELECT
  "organization_id",
  "id",
  false,
  true,
  'legacy_backfill'
FROM "contacts"
WHERE "organization_id" IS NOT NULL
ON CONFLICT ("organization_id", "contact_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "organization_contacts" (
  "organization_id",
  "contact_id",
  "is_primary",
  "active",
  "source"
)
SELECT
  "organization_id",
  "primary_contact_id",
  false,
  true,
  'legacy_backfill'
FROM "bookings"
WHERE "organization_id" IS NOT NULL
  AND "primary_contact_id" IS NOT NULL
ON CONFLICT ("organization_id", "contact_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "booking_contacts" (
  "booking_id",
  "contact_id",
  "is_primary",
  "source"
)
SELECT
  "id",
  "primary_contact_id",
  true,
  'legacy_backfill'
FROM "bookings"
WHERE "primary_contact_id" IS NOT NULL
ON CONFLICT ("booking_id", "contact_id") DO NOTHING;
```

Move the generated `contacts_primary_organization_contact_fk` and
`bookings_primary_booking_contact_fk` `ALTER TABLE` statements below these
backfills:

```sql
ALTER TABLE "contacts"
ADD CONSTRAINT "contacts_primary_organization_contact_fk"
FOREIGN KEY ("organization_id", "id")
REFERENCES "organization_contacts" ("organization_id", "contact_id");
--> statement-breakpoint
ALTER TABLE "bookings"
ADD CONSTRAINT "bookings_primary_booking_contact_fk"
FOREIGN KEY ("id", "primary_contact_id")
REFERENCES "booking_contacts" ("booking_id", "contact_id");
```

Do not mark every existing Place-Person association primary. Several existing
People can point to the same Place, while the new primary flag represents the
one primary Person for that Place.

- [ ] **Step 6: Update full-schema PostgreSQL fixtures for pointer ordering**

Tests that intentionally stop before migration `0008` keep their old fixtures.
Tests running against the current schema must insert parent records with null
compatibility pointers, insert associations, and then set pointers:

```ts
await db.insert(contacts).values({
  id: ids.contact,
  organizationId: null,
  firstName: "Avery",
  lastName: "Example",
});
await db.insert(organizationContacts).values({
  organizationId: ids.organization,
  contactId: ids.contact,
  active: true,
  source: "legacy_backfill",
});
await db
  .update(contacts)
  .set({ organizationId: ids.organization })
  .where(eq(contacts.id, ids.contact));

await db.insert(bookings).values({
  id: ids.booking,
  organizationId: ids.organization,
  primaryContactId: null,
  name: "Marias Fair",
  city: "Shelby",
  region: "MT",
});
await db.insert(bookingContacts).values({
  bookingId: ids.booking,
  contactId: ids.contact,
  isPrimary: true,
  source: "legacy_backfill",
});
await db
  .update(bookings)
  .set({ primaryContactId: ids.contact })
  .where(eq(bookings.id, ids.booking));
```

Apply this ordering to the current-schema fixtures in
`contact-repository.test.ts`, `organization-repository-postgres.test.ts`,
`activity-service.test.ts`, and `call-service.test.ts`. Do not weaken or
disable the composite foreign keys to preserve old fixture ordering.

- [ ] **Step 7: Prove the migration and constraints**

Run:

```powershell
npx vitest run tests/unit/schema-contract.test.ts tests/integration/place-person-relationship-migration.test.ts
npx vitest run tests/integration/contact-repository.test.ts tests/integration/organization-repository-postgres.test.ts tests/integration/activity-service.test.ts tests/integration/call-service.test.ts
```

Expected: PASS. The PostgreSQL test may report SKIP only when
`CRM_TEST_DATABASE_URL` is intentionally absent; it must pass in the configured
CRM database test environment.

- [ ] **Step 8: Commit the schema foundation**

```powershell
git add db/schema.ts db/migrations tests/unit/schema-contract.test.ts tests/integration/place-person-relationship-migration.test.ts tests/integration/contact-repository.test.ts tests/integration/organization-repository-postgres.test.ts tests/integration/activity-service.test.ts tests/integration/call-service.test.ts
git commit -m "feat: add CRM relationship schema"
```

### Task 2: Centralize Place-Person relationship rules

**Files:**

- Create: `features/relationships/relationship-types.ts`
- Create: `features/relationships/relationship-input.ts`
- Create: `features/relationships/relationship-writer.ts`
- Create: `features/relationships/relationship-repository.ts`
- Create: `features/relationships/relationship-service.ts`
- Create: `tests/unit/relationship-input.test.ts`
- Create: `tests/unit/relationship-service.test.ts`
- Create: `tests/integration/relationship-repository.test.ts`

**Interfaces:**

- Consumes: `organizationContacts`, `contacts.organizationId`, and audit entries.
- Produces:

```ts
import type { db as database } from "@/db/client";

export type RelationshipSource =
  | "local"
  | "act_sync"
  | "act_import"
  | "legacy_backfill"
  | "act_migration"
  | "undo";

export type PlacePersonRelationship = {
  id: string;
  organizationId: string;
  contactId: string;
  role: string | null;
  isPrimary: boolean;
  active: boolean;
  source: string;
};

export type RelationshipWriteResult =
  | { kind: "ok"; relationship: PlacePersonRelationship }
  | { kind: "place_not_found" }
  | { kind: "person_not_found" }
  | { kind: "relationship_not_found" }
  | { kind: "primary_relationship_cannot_be_inactive" };

type DrizzleDatabase = typeof database;
export type RelationshipWriter = Pick<
  DrizzleDatabase,
  "select" | "insert" | "update" | "delete"
>;

export type AssociatePersonWithPlaceInput = {
  organizationId: string;
  contactId: string;
  role: string | null;
};

export type SetPersonPrimaryPlaceInput = {
  contactId: string;
  organizationId: string | null;
};

export type SetPlacePrimaryPersonInput = {
  organizationId: string;
  contactId: string;
};

export type SetPlacePersonActiveInput = {
  organizationId: string;
  contactId: string;
  active: boolean;
};

export type RelationshipError =
  | { code: "INVALID_RELATIONSHIP_INPUT"; message: string }
  | { code: "PLACE_NOT_FOUND" }
  | { code: "PERSON_NOT_FOUND" }
  | { code: "RELATIONSHIP_NOT_FOUND" }
  | { code: "PRIMARY_RELATIONSHIP_CANNOT_BE_INACTIVE" };
```

- Produces transaction-compatible helper:

```ts
export async function ensurePlacePersonRelationship(
  writer: RelationshipWriter,
  input: {
    organizationId: string;
    contactId: string;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void>;

export async function setContactPrimaryOrganization(
  writer: RelationshipWriter,
  input: {
    contactId: string;
    organizationId: string | null;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void>;
```

- Produces service:

```ts
export class RelationshipService {
  associatePersonWithPlace(
    input: AssociatePersonWithPlaceInput,
  ): Promise<Result<PlacePersonRelationship, RelationshipError>>;
  setPersonPrimaryPlace(
    input: SetPersonPrimaryPlaceInput,
  ): Promise<Result<PlacePersonRelationship | null, RelationshipError>>;
  setPlacePrimaryPerson(
    input: SetPlacePrimaryPersonInput,
  ): Promise<Result<PlacePersonRelationship, RelationshipError>>;
  setPlacePersonActive(
    input: SetPlacePersonActiveInput,
  ): Promise<Result<PlacePersonRelationship, RelationshipError>>;
}
```

- [ ] **Step 1: Write validation tests**

In `tests/unit/relationship-input.test.ts`, cover these exact cases:

```ts
it("trims a relationship role", () => {
  expect(associatePersonWithPlaceSchema.parse({
    organizationId: "11111111-1111-4111-8111-111111111111",
    contactId: "22222222-2222-4222-8222-222222222222",
    role: "  Event Director  ",
  }).role).toBe("Event Director");
});

it("turns a blank role into null", () => {
  expect(associatePersonWithPlaceSchema.parse({
    organizationId: "11111111-1111-4111-8111-111111111111",
    contactId: "22222222-2222-4222-8222-222222222222",
    role: " ",
  }).role).toBeNull();
});

it("rejects non-UUID relationship identifiers", () => {
  expect(associatePersonWithPlaceSchema.safeParse({
    organizationId: "not-an-id",
    contactId: "also-not-an-id",
    role: null,
  }).success).toBe(false);
});
```

- [ ] **Step 2: Write service and repository tests before implementation**

Use a recording fake implementing `RelationshipRepository` in
`tests/unit/relationship-service.test.ts`. Cover invalid input, missing Place,
missing Person, missing relationship, and deactivating a primary relationship.

In `tests/integration/relationship-repository.test.ts`, use the configured
PostgreSQL test database and prove:

```ts
it("associates one Person with two Places without duplicating the Person");
it("sets a Person primary Place without changing either Place primary Person");
it("sets exactly one primary Person for a Place");
it("keeps the old Place relationship active when the Person primary Place changes");
it("refuses to deactivate the Place primary Person");
it("refuses to deactivate the Person primary Place");
it("writes one audit entry in the relationship transaction");
it("returns stable sorted Place and Person relationship lists");
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/relationship-input.test.ts tests/unit/relationship-service.test.ts tests/integration/relationship-repository.test.ts
```

Expected: FAIL because the relationship module does not exist.

- [ ] **Step 4: Implement validation and the shared writer**

Create `features/relationships/relationship-input.ts`:

```ts
import { z } from "zod";

const nullableRoleSchema = z
  .union([z.string().max(200), z.null()])
  .transform((value) => value?.trim() || null);

export const associatePersonWithPlaceSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid(),
  role: nullableRoleSchema,
});

export const setPersonPrimaryPlaceSchema = z.object({
  contactId: z.uuid(),
  organizationId: z.uuid().nullable(),
});

export const setPlacePrimaryPersonSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid(),
});

export const setPlacePersonActiveSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid(),
  active: z.boolean(),
});
```

Create `ensurePlacePersonRelationship()` with this conflict behavior:

```ts
await writer
  .insert(organizationContacts)
  .values({
    organizationId: input.organizationId,
    contactId: input.contactId,
    active: true,
    source: input.source,
    createdAt: input.now,
    updatedAt: input.now,
  })
  .onConflictDoUpdate({
    target: [
      organizationContacts.organizationId,
      organizationContacts.contactId,
    ],
    set: {
      active: true,
      source: input.source,
      updatedAt: input.now,
    },
  });
```

It must not overwrite `role` or `isPrimary` on an existing reviewed
relationship.

- [ ] **Step 5: Implement repository transactions**

`DrizzleRelationshipRepository` implements:

```ts
export interface RelationshipRepository {
  associatePersonWithPlace(
    input: AssociatePersonWithPlaceInput,
    now: Date,
  ): Promise<RelationshipWriteResult>;
  setPersonPrimaryPlace(
    input: SetPersonPrimaryPlaceInput,
    now: Date,
  ): Promise<RelationshipWriteResult | { kind: "cleared" }>;
  setPlacePrimaryPerson(
    input: SetPlacePrimaryPersonInput,
    now: Date,
  ): Promise<RelationshipWriteResult>;
  setPlacePersonActive(
    input: SetPlacePersonActiveInput,
    now: Date,
  ): Promise<RelationshipWriteResult>;
  listPeopleForPlace(
    organizationId: string,
    includeInactive?: boolean,
  ): Promise<PlacePersonRelationship[]>;
  listPlacesForPerson(
    contactId: string,
    includeInactive?: boolean,
  ): Promise<PlacePersonRelationship[]>;
}
```

For `setPersonPrimaryPlace`, lock the Person, ensure the target relationship is
active when non-null, then update `contacts.organizationId`. Do not clear the
old association and do not change any `isPrimary` flag.

Implement that ordering through `setContactPrimaryOrganization()`: lock the
Person, call `ensurePlacePersonRelationship()` when the target is non-null,
then update the compatibility pointer. This ordering is required by
`contacts_primary_organization_contact_fk`.

For `setPlacePrimaryPerson`, lock the Place and target association, clear the
current Place primary flag, and set the target row to
`{ active: true, isPrimary: true }`.

For `setPlacePersonActive`, reject `{ active: false }` when the locked row is
the Place's primary Person or when `contacts.organizationId` points to that
Place. Each successful mutation writes an audit entry with entity type
`organization_contact` and an action of `create`, `update`,
`primary_person_changed`, or `primary_place_changed`.

- [ ] **Step 6: Implement the service and run focused tests**

The service parses each input, calls the repository with `now()`, and maps
repository results to `Result`. Use the same constructor injection pattern as
`OrganizationService`:

```ts
export class RelationshipService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: RelationshipRepository,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }
}
```

Run:

```powershell
npx vitest run tests/unit/relationship-input.test.ts tests/unit/relationship-service.test.ts tests/integration/relationship-repository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the relationship module**

```powershell
git add features/relationships tests/unit/relationship-input.test.ts tests/unit/relationship-service.test.ts tests/integration/relationship-repository.test.ts
git commit -m "feat: add Place Person relationship rules"
```

### Task 3: Make every Contact compatibility-pointer writer relationship-aware

**Files:**

- Modify: `features/contacts/contact-repository.ts:140-173,309-539`
- Modify: `features/import/act-matcher.ts:574-663`
- Modify: `features/act-sync/sync-repository.ts:1078-1178`
- Modify: `features/audit/undo-service.ts:53-80,348-359`
- Modify: `tests/integration/contact-repository.test.ts`
- Modify: `tests/integration/act-import-drizzle.test.ts`
- Modify: `tests/unit/act-sync-repository.test.ts`
- Modify: `tests/integration/act-sync-apply.test.ts`
- Modify: `tests/unit/contact-patch.test.ts`
- Modify: `tests/integration/audit-undo.test.ts`

**Interfaces:**

- Consumes: `ensurePlacePersonRelationship()` and
  `setContactPrimaryOrganization()`.
- Produces: the invariant that every contact writer creating or assigning
  `contacts.organizationId` creates or reactivates the matching association in
  the same transaction.
- Leaves the old association active when a Person's primary Place changes.

- [ ] **Step 1: Add failing writer-coverage tests**

Extend the listed tests with these cases:

```ts
it("creates an active Place-Person association with a new contact");
it("creates an active Place-Person association with Quick Add");
it("keeps the previous association and adds the new one when the primary Place changes");
it("adds the association during legacy Act! import create and update");
it("adds the association during an approved Act! Contact pull");
it("restores a Contact primary Place through an association-aware undo");
it("does not overwrite a reviewed role or Place primary flag");
```

For the PostgreSQL contact repository test, assert both rows after changing the
primary Place:

```ts
expect(await sql`
  select organization_id, contact_id, active
  from organization_contacts
  where contact_id = ${contactId}
  order by organization_id
`).toEqual([
  { organization_id: firstPlaceId, contact_id: contactId, active: true },
  { organization_id: secondPlaceId, contact_id: contactId, active: true },
]);

expect(await sql`
  select organization_id
  from contacts
  where id = ${contactId}
`).toEqual([{ organization_id: secondPlaceId }]);
```

- [ ] **Step 2: Run the writer tests and verify failure**

Run:

```powershell
npx vitest run tests/integration/contact-repository.test.ts tests/integration/act-import-drizzle.test.ts tests/unit/act-sync-repository.test.ts tests/integration/act-sync-apply.test.ts tests/unit/contact-patch.test.ts tests/integration/audit-undo.test.ts
```

Expected: FAIL because those writers only update `contacts.organizationId`.

- [ ] **Step 3: Update local contact creation and editing**

Because the composite foreign key is active, create a Contact with a null
pointer, create the association, and only then set the pointer:

```ts
const [created] = await transaction
  .insert(contacts)
  .values({
    organizationId: null,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    normalizedPhone: normalizeUsPhone(input.phone),
    createdAt: now,
    updatedAt: now,
  })
  .returning();

if (created && organizationId) {
  await setContactPrimaryOrganization(transaction, {
    contactId: created.id,
    organizationId,
    source: "local",
    now,
  });
}
```

Keep all other existing Contact values in their current insert paths. Apply
this ordering in `createContact()` and `createQuickCaller()`.

Expand `ContactPatchWriter` to include `select` and `delete`, and give
`patchContactInTransaction()` a `source: RelationshipSource = "local"`
parameter. When the patch owns `organizationId`, remove that key from the
ordinary Contact update and call:

```ts
await setContactPrimaryOrganization(writer, {
  contactId: before.id,
  organizationId:
    typeof updates.organizationId === "string"
      ? updates.organizationId
      : null,
  source,
  now,
});
```

Then apply the remaining Contact fields. Clearing `contacts.organizationId`
does not deactivate an existing association; that is a separate audited
relationship action.

- [ ] **Step 4: Update legacy Act! file import**

In `DrizzleActImportTransaction.createContact()`, insert the Contact with
`organizationId: null`, then call:

```ts
if (organization) {
  await setContactPrimaryOrganization(this.database, {
    organizationId: organization.id,
    contactId: created.id,
    source: "act_import",
    now: created.updatedAt,
  });
}
```

In `updateContact()`, remove `organizationId` from the direct update, update
the non-pointer fields, and call the same helper with `updated.id` and
`updated.updatedAt`. This task preserves the legacy import behavior;
company-first matching and duplicate-company remediation belong to the
reviewed Act! migration plan.

- [ ] **Step 5: Update approved Act! Contact pulls**

In `DrizzleSyncRepository.pullContact()`, insert a new local Contact with a null
pointer or update only its non-pointer fields. Then call the helper before the
external link and sync state are committed:

```ts
if (organizationId) {
  await setContactPrimaryOrganization(transaction, {
    organizationId,
    contactId: localContactId,
    source: "act_sync",
    now,
  });
}
```

Do not add this to `completePush()` because a push does not change the local
primary Place. `linkContact()` also leaves local fields unchanged; the migration
backfill already covers its existing primary pointer.

- [ ] **Step 6: Route Contact undo through the helper**

`features/audit/undo-service.ts` already permits `organizationId` in a Contact
restore and delegates to `patchContactInTransaction()`. Pass `"undo"` as the
new source argument and add a test that the target association is created
before the pointer is restored. The undo and its audit record remain in the
existing transaction.

- [ ] **Step 7: Run writer and regression tests**

Run:

```powershell
npx vitest run tests/integration/contact-repository.test.ts tests/integration/act-import-drizzle.test.ts tests/unit/act-sync-repository.test.ts tests/integration/act-sync-apply.test.ts tests/unit/contact-patch.test.ts tests/integration/audit-undo.test.ts
npx vitest run tests/integration/call-service.test.ts tests/unit/contact-patch.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit writer coverage**

```powershell
git add features/contacts/contact-repository.ts features/import/act-matcher.ts features/act-sync/sync-repository.ts features/audit/undo-service.ts tests/integration/contact-repository.test.ts tests/integration/act-import-drizzle.test.ts tests/unit/act-sync-repository.test.ts tests/integration/act-sync-apply.test.ts tests/unit/contact-patch.test.ts tests/integration/audit-undo.test.ts
git commit -m "feat: maintain Place Person associations"
```

### Task 4: Add atomic Booking Place and People mutations

**Files:**

- Create: `features/bookings/booking-relationship-input.ts`
- Create: `features/bookings/booking-relationship-repository.ts`
- Create: `features/bookings/booking-relationship-service.ts`
- Modify: `features/audit/undo-service.ts:53-80,333-346`
- Create: `tests/unit/booking-relationship-input.test.ts`
- Create: `tests/unit/booking-relationship-service.test.ts`
- Create: `tests/integration/booking-relationship-repository.test.ts`
- Modify: `tests/integration/audit-undo.test.ts`

**Interfaces:**

- Consumes: `organizationContacts`, `bookingContacts`,
  `bookings.organizationId`, and `bookings.primaryContactId`.
- Produces:

```ts
import type { db as database } from "@/db/client";

export type BookingPersonSelection = {
  contactId: string;
  role: string | null;
  isPrimary: boolean;
};

export type ChangeBookingPlaceInput = {
  bookingId: string;
  organizationId: string;
};

export type ReplaceBookingPeopleInput = {
  bookingId: string;
  people: BookingPersonSelection[];
};

export type BookingRelationshipError =
  | { code: "INVALID_BOOKING_RELATIONSHIP_INPUT"; message: string }
  | { code: "BOOKING_NOT_FOUND" }
  | { code: "PLACE_NOT_FOUND" }
  | { code: "PERSON_NOT_ASSOCIATED_WITH_PLACE"; contactIds: string[] };

export type ChangeBookingPlaceResult = {
  bookingId: string;
  organizationId: string;
  primaryContactId: string | null;
  removedContactIds: string[];
};

export type BookingRelationshipWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "booking_not_found" }
  | { kind: "place_not_found" }
  | { kind: "people_outside_place"; contactIds: string[] };

export type BookingRelationshipWriter = Pick<
  typeof database,
  "select" | "insert" | "update" | "delete"
>;

export async function ensureBookingContact(
  writer: BookingRelationshipWriter,
  input: {
    bookingId: string;
    contactId: string;
    role?: string | null;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void>;

export async function setBookingPrimaryContact(
  writer: BookingRelationshipWriter,
  input: {
    bookingId: string;
    contactId: string | null;
    role?: string | null;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void>;

export interface BookingRelationshipRepository {
  changePlace(
    input: ChangeBookingPlaceInput,
    now: Date,
  ): Promise<BookingRelationshipWriteResult<ChangeBookingPlaceResult>>;
  replacePeople(
    input: ReplaceBookingPeopleInput,
    now: Date,
  ): Promise<BookingRelationshipWriteResult<BookingPersonSelection[]>>;
}

export class BookingRelationshipService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: BookingRelationshipRepository,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  changePlace(
    input: ChangeBookingPlaceInput,
  ): Promise<Result<ChangeBookingPlaceResult, BookingRelationshipError>>;
  replacePeople(
    input: ReplaceBookingPeopleInput,
  ): Promise<Result<BookingPersonSelection[], BookingRelationshipError>>;
}
```

- [ ] **Step 1: Write input tests**

Create these exact cases:

```ts
it("accepts one primary Booking Person");
it("accepts additional involved People without a primary");
it("trims roles and turns blank roles into null");
it("rejects duplicate Person IDs");
it("rejects more than one primary Person");
it("rejects a Place-less Booking mutation");
```

The `replaceBookingPeopleSchema` refinement is:

```ts
.superRefine((value, context) => {
  const ids = value.people.map((person) => person.contactId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["people"],
      message: "Select each Person once",
    });
  }
  if (value.people.filter((person) => person.isPrimary).length > 1) {
    context.addIssue({
      code: "custom",
      path: ["people"],
      message: "Choose at most one primary Person",
    });
  }
});
```

- [ ] **Step 2: Write service and PostgreSQL repository tests**

Cover:

```ts
it("retains the primary Person when changing to a Place with an active relationship");
it("clears the primary Person when changing to an unrelated Place");
it("removes additional Booking People unrelated to the new Place");
it("rejects replacement People without active Place relationships");
it("replaces primary and additional People in one transaction");
it("keeps bookings.primaryContactId equal to the primary association");
it("writes one Booking relationship audit entry");
it("rolls back the pointer when association persistence fails");
it("restores a Booking primary Person through an association-aware undo");
it("undoes a legacy Place-less Booking without inventing a Place");
it("leaves an untouched legacy Place-less Booking readable");
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/booking-relationship-input.test.ts tests/unit/booking-relationship-service.test.ts tests/integration/booking-relationship-repository.test.ts
```

Expected: FAIL because Booking relationship APIs do not exist.

- [ ] **Step 4: Implement the input schemas**

Create:

```ts
const bookingPersonSelectionSchema = z.object({
  contactId: z.uuid(),
  role: z
    .union([z.string().max(200), z.null()])
    .transform((value) => value?.trim() || null),
  isPrimary: z.boolean(),
});

export const changeBookingPlaceSchema = z.object({
  bookingId: z.uuid(),
  organizationId: z.uuid(),
});

export const replaceBookingPeopleSchema = z.object({
  bookingId: z.uuid(),
  people: z.array(bookingPersonSelectionSchema).max(100),
}).superRefine((value, context) => {
  const ids = value.people.map((person) => person.contactId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["people"],
      message: "Select each Person once",
    });
  }
  if (value.people.filter((person) => person.isPrimary).length > 1) {
    context.addIssue({
      code: "custom",
      path: ["people"],
      message: "Choose at most one primary Person",
    });
  }
});
```

- [ ] **Step 5: Implement the repository transactions**

`changePlace()` performs these locked operations in order:

```ts
const [booking] = await transaction
  .select()
  .from(bookings)
  .where(eq(bookings.id, input.bookingId))
  .limit(1)
  .for("update");

const retainedPeople = await transaction
  .select({ contactId: bookingContacts.contactId })
  .from(bookingContacts)
  .innerJoin(
    organizationContacts,
    and(
      eq(organizationContacts.contactId, bookingContacts.contactId),
      eq(organizationContacts.organizationId, input.organizationId),
      eq(organizationContacts.active, true),
    ),
  )
  .where(eq(bookingContacts.bookingId, input.bookingId))
  .for("update");
```

If the old primary Person is not retained, set
`bookings.primaryContactId` to null before deleting that Booking-Person row.
Delete all Booking-Person rows not in `retainedPeople`, update
`bookings.organizationId`, and keep the old primary pointer only when its row
was retained. Write one audit entry containing the old/new Place, old/new
primary Person, and removed Person IDs.

`replacePeople()` locks the Booking, requires a non-null Place, verifies every
selected Person through active `organizationContacts`, sets
`bookings.primaryContactId` to null, deletes the old `bookingContacts`, inserts
the new rows, and finally updates `bookings.primaryContactId` from the single
`isPrimary` row. Clearing the pointer before deleting and inserting the new
pair before restoring the pointer are required by
`bookings_primary_booking_contact_fk`. All writes and the audit entry remain in
one transaction.

- [ ] **Step 6: Route Booking pointer undo through the repository**

Replace the generic direct `bookings.primaryContactId` restore in
`features/audit/undo-service.ts` with the same ordered operations:

```ts
await transaction
  .update(bookings)
  .set({ primaryContactId: null, updatedAt: now })
  .where(eq(bookings.id, bookingId));

if (restoredPrimaryContactId) {
  await ensureBookingContact(transaction, {
    bookingId,
    contactId: restoredPrimaryContactId,
    source: "undo",
    now,
  });
  await setBookingPrimaryContact(transaction, {
    bookingId,
    contactId: restoredPrimaryContactId,
    source: "undo",
    now,
  });
}
```

When the Booking has a Place, the helper must verify the Person has an active
association with it. For an unchanged legacy Booking whose Place is null,
`source: "undo"` may restore the previous Booking-Person pair and pointer so
undo remains lossless; the Booking stays in
`legacyBookingsWithoutPlace`. No local create/edit or import path receives that
exception. A failed validation rolls back the undo and its audit entry.

- [ ] **Step 7: Implement the service and run focused tests**

Use injected `now()` and the same typed `Result` pattern as `BookingService`.
The service maps a list of unrelated People to:

```ts
err({
  code: "PERSON_NOT_ASSOCIATED_WITH_PLACE",
  contactIds: result.contactIds,
});
```

Run:

```powershell
npx vitest run tests/unit/booking-relationship-input.test.ts tests/unit/booking-relationship-service.test.ts tests/integration/booking-relationship-repository.test.ts tests/integration/audit-undo.test.ts
npx vitest run tests/integration/booking-service.test.ts tests/integration/booking-audit-locking.test.ts tests/integration/call-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Booking relationship rules**

```powershell
git add features/bookings/booking-relationship-input.ts features/bookings/booking-relationship-repository.ts features/bookings/booking-relationship-service.ts features/audit/undo-service.ts tests/unit/booking-relationship-input.test.ts tests/unit/booking-relationship-service.test.ts tests/integration/booking-relationship-repository.test.ts tests/integration/audit-undo.test.ts
git commit -m "feat: add Booking Person relationship rules"
```

### Task 5: Read complete relationships and accept shared-Person contexts

**Files:**

- Modify: `features/organizations/organization-repository.ts:14-313`
- Modify: `features/contacts/contact-types.ts`
- Modify: `features/contacts/contact-repository.ts:238-307`
- Modify: `features/bookings/booking-repository.ts:79-137`
- Modify: `features/activities/activity-repository.ts:145-181`
- Modify: `features/calls/call-types.ts`
- Modify: `features/calls/call-repository.ts:155-189`
- Modify: `features/calls/call-service.ts:85-145`
- Modify: `features/calls/call-workspace-context.ts:80-145`
- Create: `features/relationships/relationship-reconciliation.ts`
- Modify: `tests/integration/organization-repository-postgres.test.ts`
- Modify: `tests/integration/contact-repository.test.ts`
- Modify: `tests/integration/booking-service.test.ts`
- Modify: `tests/integration/activity-service.test.ts`
- Modify: `tests/integration/call-service.test.ts`
- Modify: `tests/unit/call-workspace-context.test.ts`
- Create: `tests/integration/relationship-reconciliation.test.ts`

**Interfaces:**

- Produces complete active association reads rather than relying only on the
  compatibility pointers.
- Produces relationship-aware activity and call validation so a shared Person
  can be used at any actively associated Place and on any linked Booking.
- Produces:

```ts
export type OrganizationPerson = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
  phone: string | null;
  email: string | null;
};

export type PersonPlace = {
  id: string;
  name: string;
  role: string | null;
  isPrimaryPerson: boolean;
  isPrimaryPlace: boolean;
  active: boolean;
};

export type BookingPerson = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
};

export type RelationshipInvariantReport = {
  contactPrimaryPlaceWithoutAssociation: string[];
  bookingPrimaryPersonWithoutAssociation: string[];
  bookingPeopleOutsidePlace: Array<{
    bookingId: string;
    contactId: string;
  }>;
  legacyBookingsWithoutPlace: string[];
};

export async function inspectRelationshipInvariants(
  database: typeof database,
): Promise<RelationshipInvariantReport>;
```

- [ ] **Step 1: Write failing read-model tests**

Add tests proving:

```ts
it("shows one shared Person under both associated Places");
it("shows one Place with several People");
it("keeps a Place with no People visible with an empty People list");
it("excludes inactive Place-Person rows from the default Place detail");
it("shows all Places on Person detail and marks the primary Place pointer");
it("shows primary and additional People on Booking detail");
it("shows a Booking under every involved Person");
it("sorts primary Person first, then role, name, and ID");
it("creates an activity for a Person at a secondary active Place");
it("rejects an activity for a Person with no active Place relationship");
it("opens a call for a Person at a secondary active Place");
it("opens a Booking call for an additional involved Person");
it("rejects a call when the Place-Person relationship is inactive");
```

Use one Person associated with two Places and one Booking with a primary and
additional Person. Assert the Person table still contains one row.

- [ ] **Step 2: Write failing reconciliation tests**

Seed one row for each exception and assert exact IDs:

```ts
expect(await inspectRelationshipInvariants(db)).toEqual({
  contactPrimaryPlaceWithoutAssociation: [ids.personMissingPlaceLink],
  bookingPrimaryPersonWithoutAssociation: [ids.bookingMissingPersonLink],
  bookingPeopleOutsidePlace: [{
    bookingId: ids.bookingWithUnrelatedPerson,
    contactId: ids.unrelatedPerson,
  }],
  legacyBookingsWithoutPlace: [ids.legacyBooking],
});
```

Also test the fully valid graph returns four empty arrays.

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```powershell
npx vitest run tests/integration/organization-repository-postgres.test.ts tests/integration/contact-repository.test.ts tests/integration/booking-service.test.ts tests/integration/activity-service.test.ts tests/integration/call-service.test.ts tests/unit/call-workspace-context.test.ts tests/integration/relationship-reconciliation.test.ts
```

Expected: FAIL because the read models still use only compatibility pointers
and reconciliation does not exist.

- [ ] **Step 4: Switch organization and Person detail reads**

Change `DrizzleOrganizationRepository.getOrganizationSummary()` and
`listOrganizations()` contact queries to join active
`organizationContacts`. Preserve the existing pagination and deterministic
ordering, with this order:

```ts
.orderBy(
  desc(organizationContacts.isPrimary),
  asc(organizationContacts.role),
  asc(contacts.lastName),
  asc(contacts.firstName),
  asc(contacts.id),
)
```

Change `DrizzleContactRepository.getContactDetail()` to return `places` from
all Place-Person associations and mark:

```ts
isPrimaryPlace: relationship.organizationId === contact.organizationId
```

Query related Bookings through `bookingContacts`, so additional involved People
receive the same Booking visibility as the primary Person.

- [ ] **Step 5: Add Booking People to the detail read**

Extend `BookingDetail` with:

```ts
people: BookingPerson[];
```

Query `bookingContacts` joined to `contacts`, ordered by primary first, then
role, last name, first name, and ID. Keep the existing `contact` property as the
compatibility primary-Person record so existing pages remain functional until
the Place-first UI slice changes them.

- [ ] **Step 6: Replace pointer-only activity and call validation**

In `DrizzleActivityRepository.create()`, when both Place and Person are
present, validate an active association:

```ts
const [placePerson] =
  input.organizationId && input.contactId
    ? await transaction
        .select({ id: organizationContacts.id })
        .from(organizationContacts)
        .where(and(
          eq(organizationContacts.organizationId, input.organizationId),
          eq(organizationContacts.contactId, input.contactId),
          eq(organizationContacts.active, true),
        ))
        .limit(1)
        .for("share")
    : [];

if (input.organizationId && input.contactId && !placePerson) {
  throw new ActivityParentValidationError();
}
```

When both Booking and Person are present, require a `bookingContacts` row.
Continue requiring the Booking Place to match the activity Place.

Extend `CallContext` with:

```ts
contactHasActiveOrganizationRelationship: boolean | null;
contactHasBookingRelationship: boolean | null;
```

Populate those flags in `DrizzleCallTransaction.lockContext()` using locked
association queries. `validateCanonicalContext()` accepts the Person when the
active Place-Person flag is true and accepts a non-primary Booking Person when
the Booking-Person flag is true. It retains the existing mismatch error codes
when either flag is false.

Add matching methods to `CallWorkspaceContextRepository`:

```ts
hasActiveOrganizationContact(
  organizationId: string,
  contactId: string,
): Promise<boolean>;
hasBookingContact(
  bookingId: string,
  contactId: string,
): Promise<boolean>;
```

In `loadCallWorkspaceContext()`, choose the canonical Place from explicit
query, follow-up, Booking, then Person primary pointer. Do not treat a Person's
different primary Place as a conflict when the explicit/Booking Place has an
active association. Require `hasBookingContact()` when a non-primary Person is
opened with a Booking.

- [ ] **Step 7: Implement the reconciliation query**

Implement four read-only queries:

```ts
const contactPrimaryPlaceWithoutAssociation = await database
  .select({ id: contacts.id })
  .from(contacts)
  .leftJoin(
    organizationContacts,
    and(
      eq(organizationContacts.organizationId, contacts.organizationId),
      eq(organizationContacts.contactId, contacts.id),
      eq(organizationContacts.active, true),
    ),
  )
  .where(
    and(
      isNotNull(contacts.organizationId),
      isNull(organizationContacts.id),
    ),
  );
```

Add equivalent queries for:

- `bookings.primaryContactId` without a primary `bookingContacts` row;
- any `bookingContacts` Person without an active relationship to the Booking
  Place;
- Bookings whose `organizationId` is null.

Sort every ID array and `(bookingId, contactId)` pair before returning so the
report is deterministic.

- [ ] **Step 8: Run read, context, reconciliation, and regression tests**

Run:

```powershell
npx vitest run tests/integration/organization-repository-postgres.test.ts tests/integration/contact-repository.test.ts tests/integration/booking-service.test.ts tests/integration/activity-service.test.ts tests/integration/call-service.test.ts tests/integration/relationship-reconciliation.test.ts
npx vitest run tests/unit/contact-components.test.tsx tests/unit/booking-detail-page.test.tsx tests/unit/call-workspace-context.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit complete relationship reads**

```powershell
git add features/organizations/organization-repository.ts features/contacts/contact-types.ts features/contacts/contact-repository.ts features/bookings/booking-repository.ts features/activities/activity-repository.ts features/calls/call-types.ts features/calls/call-repository.ts features/calls/call-service.ts features/calls/call-workspace-context.ts features/relationships/relationship-reconciliation.ts tests/integration/organization-repository-postgres.test.ts tests/integration/contact-repository.test.ts tests/integration/booking-service.test.ts tests/integration/activity-service.test.ts tests/integration/call-service.test.ts tests/unit/call-workspace-context.test.ts tests/integration/relationship-reconciliation.test.ts
git commit -m "feat: read and reconcile CRM relationships"
```

### Task 6: Document and verify the relationship-foundation gate

**Files:**

- Create: `docs/operations/place-person-relationships.md`
- Modify: `package.json`
- Modify: `tests/unit/crm-database-test-gate.test.ts`

**Interfaces:**

- Adds the new PostgreSQL integration suites to `npm run test:crm-db`.
- Keeps the existing release runner unchanged; it already invokes
  `npm run test:crm-db`.
- Documents the read-only reconciliation result and the rule that no exception
  is repaired automatically.

- [ ] **Step 1: Write the failing CRM database gate contract**

In `tests/unit/crm-database-test-gate.test.ts`, extend the existing
`packageJson.scripts["test:crm-db"]` assertion:

```ts
expect(packageJson.scripts["test:crm-db"].split(/\s+/)).toEqual(
  expect.arrayContaining([
    "tests/integration/place-person-relationship-migration.test.ts",
    "tests/integration/relationship-repository.test.ts",
    "tests/integration/booking-relationship-repository.test.ts",
    "tests/integration/relationship-reconciliation.test.ts",
  ]),
);
```

- [ ] **Step 2: Run the runner contract and verify failure**

Run:

```powershell
npx vitest run tests/unit/crm-database-test-gate.test.ts
```

Expected: FAIL because the new suites are not registered.

- [ ] **Step 3: Register the suites and write operator guidance**

Add the four integration test files to `package.json`'s `test:crm-db` command.
Do not edit `scripts/run-release-tests.ts`; its first step already runs that
package script with `CRM_RELEASE_TESTS=1`.

Create `docs/operations/place-person-relationships.md` with:

```markdown
# Place-Person relationship operations

## Invariants

- Every non-null Person primary Place pointer has an active Place-Person row.
- One Place-Person row exists per pair.
- A Place has at most one active primary Person.
- Every Booking primary Person has a primary Booking-Person row.
- Every Booking Person has an active relationship with the Booking Place.

## Legacy exceptions

Run the read-only relationship reconciliation before the Act! migration.
Bookings without a Place remain visible in `legacyBookingsWithoutPlace`.
Do not invent a Place, merge People, deactivate relationships, or delete
records automatically. Review each returned ID in the application before a
separately approved correction.

## Release gate

The relationship slice is ready only when the migration preservation test,
repository tests, reconciliation tests, the full unit suite, lint, typecheck,
and production build pass. In a production data rehearsal, every exception is
either corrected through reviewed application actions or recorded in a visible
review queue for the next slice.
```

- [ ] **Step 4: Run the complete verification gate**

Run:

```powershell
npm test
npm run test:crm-db
npm run lint
npm run typecheck
npm run build
```

Expected: PASS. `npm run test:crm-db` requires
`CRM_TEST_DATABASE_URL`; absence of that variable is not a production release
pass.

- [ ] **Step 5: Inspect migration and working tree scope**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only files named by this plan are changed.

- [ ] **Step 6: Commit the relationship gate**

```powershell
git add docs/operations/place-person-relationships.md package.json tests/unit/crm-database-test-gate.test.ts
git commit -m "docs: add CRM relationship release gate"
```

## Slice Completion Gate

Before starting the Act! API staging plan, verify all of the following:

1. Every existing non-null `contacts.organizationId` has an active
   `organization_contacts` row.
2. Every existing non-null `bookings.primaryContactId` has a primary
   `booking_contacts` row.
3. Composite foreign keys reject compatibility pointers whose association row
   is missing.
4. Duplicate Place-Person and Booking-Person rows are rejected.
5. A Person can be associated with two Places without duplication.
6. Activities and calls accept that Person at either active Place.
7. A Booking Place change keeps only People active at the new Place.
8. Local, legacy Act! import, and approved Act! Contact pull writers maintain
   the Place-Person association.
9. Existing IDs and history survive the migration.
10. Legacy Place-less Bookings are reported and not silently changed.
11. `npm test`, `npm run test:crm-db`, `npm run lint`, `npm run typecheck`, and
   `npm run build` pass in the configured release environment.
