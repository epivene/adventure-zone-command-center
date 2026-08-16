# Event Family Website & Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one shared website and real CRM contact relationships to Event Families, with editable family-level management and read-only family contact context on member profiles.

**Architecture:** Extend `event_families` with a nullable website and add a dedicated `event_family_contacts` join table that links existing `contacts` records without copying person data. Keep repository/service behavior focused in Event Family code, reuse existing CRM contact records and normal contact editing, and expose a compact `Website & Contacts` section on the family page plus a read-only summary on member profiles.

**Tech Stack:** PostgreSQL, Drizzle ORM schema, Node/Express API, React + Wouter frontend, Vitest + Testing Library, existing authenticated `apiGet/apiPost/apiPatch/apiDelete` client.

## Global Constraints

- Family-level data belongs to the Event Family, not to every member event.
- Member profiles keep their own local websites and contacts independently.
- Existing CRM contacts are linked rather than duplicated.
- Removing a contact from a family removes only the relationship; it never deletes the CRM contact or its history.
- Event Family relationships remain separate from organization/location hierarchy relationships.
- Keep the UI as simple as the normal profile contact experience.
- One main website only in this first pass.
- Multiple family contacts are allowed; only one may be Primary at a time.
- Creating a new contact and linking it to a family must be atomic.
- No automatic copying of family website/contact data onto member profiles.

---

## File Structure

**Database/schema**
- Modify `lib/db/src/event-family-schema.ts` — add `eventFamilies.website` and `eventFamilyContacts`.
- Create `lib/db/migrations/043_event_family_website_contacts.sql` — add website column, join table, constraints/indexes.
- Modify the migration registry used by `@workspace/db` startup so migration `043_event_family_website_contacts.sql` is applied in production.

**Backend domain/API**
- Modify `artifacts/api-server/src/features/event-families/event-family-repository.ts` — family detail, website mutations, family-contact CRUD, atomic create-and-attach.
- Create `artifacts/api-server/src/features/event-families/event-family-contacts.test.ts` — real Postgres relationship/service coverage.
- Modify `artifacts/api-server/src/routes/event-families.ts` — owner-only HTTP endpoints and validation.
- Create/modify `artifacts/api-server/src/routes/event-family-contacts.test.ts` — route validation/status mapping.
- Modify `artifacts/api-server/src/routes/event-profiles.ts` — include read-only family website/primary-contact summary for member profiles.
- Add regression coverage beside existing event-profile route tests for family summary behavior.

**Frontend family management**
- Modify `artifacts/adventure-zone/src/features/event-families/event-family-types.ts` — website/contact types.
- Create `artifacts/adventure-zone/src/components/event-families/event-family-website-contacts.tsx` — compact family website/contact management UI.
- Create `artifacts/adventure-zone/src/components/event-families/event-family-website-contacts.test.tsx` — family management UI tests.
- Modify `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx` — mount component and reload family detail after mutations.

**Frontend member-profile context**
- Create `artifacts/adventure-zone/src/components/event-profiles/family-contact-summary.tsx` — read-only shared-family contact box.
- Create `artifacts/adventure-zone/src/components/event-profiles/family-contact-summary.test.tsx` — rendering/separation tests.
- Modify `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx` — render summary independently of local contacts and Event Family note context.

---

### Task 1: Database schema for family website and contact relationships

**Files:**
- Modify: `lib/db/src/event-family-schema.ts`
- Create: `lib/db/migrations/043_event_family_website_contacts.sql`
- Modify: migration registry file that currently lists the numbered SQL migrations
- Test: `artifacts/api-server/src/features/event-families/event-family-contacts.test.ts`

**Interfaces:**
- Produces `eventFamilies.website: string | null`.
- Produces `eventFamilyContacts` with `{ id, familyId, contactId, role, isPrimary, createdAt, updatedAt }`.
- Unique relationship: `(family_id, contact_id)`.
- One primary per family: partial unique index on `family_id WHERE is_primary = true`.

- [ ] **Step 1: Write a failing schema contract test**

Create a test that imports `eventFamilies` and `eventFamilyContacts` and asserts the new fields/table exist in Drizzle metadata, and reads `043_event_family_website_contacts.sql` to require:

```sql
ALTER TABLE event_families ADD COLUMN IF NOT EXISTS website text;
CREATE TABLE IF NOT EXISTS event_family_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES event_families(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  role text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, contact_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS event_family_contacts_one_primary_per_family
  ON event_family_contacts(family_id)
  WHERE is_primary = true;
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run the focused Vitest file. Expected: failure because `website`, `eventFamilyContacts`, and migration 043 do not exist yet.

- [ ] **Step 3: Add the Drizzle schema**

Update `event-family-schema.ts` to import `boolean` and `contacts`, add:

```ts
website: text("website"),
```

to `eventFamilies`, and add:

```ts
export const eventFamilyContacts = pgTable(
  "event_family_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyId: uuid("family_id").notNull().references(() => eventFamilies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
    role: text("role"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("event_family_contacts_family_contact_unique").on(table.familyId, table.contactId),
    index("event_family_contacts_family_idx").on(table.familyId),
    index("event_family_contacts_contact_idx").on(table.contactId),
    uniqueIndex("event_family_contacts_one_primary_per_family")
      .on(table.familyId)
      .where(sql`${table.isPrimary} = true`),
  ],
);
```

- [ ] **Step 4: Add migration 043 and register it**

Create the SQL above plus indexes for `family_id` and `contact_id`. Add migration 043 to the same startup registry/order used by the existing numbered migrations.

- [ ] **Step 5: Run schema contract + DB build**

Run the schema test and `pnpm --filter @workspace/db build`. Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add event family website contact schema`.

---

### Task 2: Family contact repository behavior

**Files:**
- Modify: `artifacts/api-server/src/features/event-families/event-family-repository.ts`
- Test: `artifacts/api-server/src/features/event-families/event-family-contacts.test.ts`

**Interfaces:**
- Produces:

```ts
export type EventFamilyContactRecord = {
  id: string;
  contactId: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
};
```

- Produces repository methods:

```ts
updateWebsite(familyId: string, website: string | null): Promise<boolean>
listContactCandidates(query: string): Promise<Array<{ id: string; name: string; phone: string | null; email: string | null; organizationName: string | null }>>
attachContact(familyId: string, contactId: string, role: string | null, makePrimary: boolean): Promise<EventFamilyContactRecord>
createAndAttachContact(familyId: string, input: { firstName: string; lastName: string; phone: string | null; email: string | null; role: string | null; makePrimary: boolean }): Promise<EventFamilyContactRecord>
updateFamilyContact(familyId: string, contactId: string, input: { role: string | null; isPrimary: boolean }): Promise<EventFamilyContactRecord>
removeFamilyContact(familyId: string, contactId: string): Promise<boolean>
```

- [ ] **Step 1: Write real Postgres failing tests**

Cover:
- family website retrieved/save/clear;
- attach existing contact;
- duplicate attach throws `EventFamilyConflictError`;
- making a second primary clears the first primary for that family only;
- removing a relationship leaves the `contacts` row and its activities/history untouched;
- deleting the Event Family cascades only `event_family_contacts`, not `contacts`;
- create-and-attach rolls back the new contact if the family does not exist.

- [ ] **Step 2: Run focused repository test and confirm RED**

Expected: missing methods/table behavior.

- [ ] **Step 3: Extend `ensureEventFamilySchema()`**

Make its idempotent SQL include the website column and `event_family_contacts` table/indexes so tests/workers that rely on this initializer remain compatible with migrations.

- [ ] **Step 4: Extend `getFamily()`**

Return `website` and a `contacts` array using one query joined to `contacts`, ordered Primary first, then name. Keep member profiles unchanged.

- [ ] **Step 5: Implement website and attach/update/remove methods**

For Primary transitions, use a transaction:

```sql
UPDATE event_family_contacts
SET is_primary = false, updated_at = now()
WHERE family_id = $1 AND contact_id <> $2;
```

before setting the requested contact Primary.

- [ ] **Step 6: Implement atomic create-and-attach**

Inside one DB transaction:
1. lock/validate family;
2. insert a normal CRM `contacts` row using the same normalized name/email/phone conventions currently used by contact creation;
3. insert the family relationship;
4. apply Primary behavior;
5. commit.

On any failure, rollback so no orphan contact remains.

- [ ] **Step 7: Run repository tests and API build**

Expected: all family-contact tests PASS; API build PASS.

- [ ] **Step 8: Commit**

Commit message: `feat: manage event family contacts`.

---

### Task 3: Owner API for website and contacts

**Files:**
- Modify: `artifacts/api-server/src/routes/event-families.ts`
- Create/modify: `artifacts/api-server/src/routes/event-family-contacts.test.ts`

**Interfaces:**
- Endpoints:

```text
PATCH  /event-families/:id/website
GET    /event-families/:id/contact-candidates?q=
POST   /event-families/:id/contacts
POST   /event-families/:id/contacts/new
PATCH  /event-families/:id/contacts/:contactId
DELETE /event-families/:id/contacts/:contactId
```

- [ ] **Step 1: Write route tests first**

Mock repository methods and require:
- invalid UUID → 400;
- missing family/contact → 404;
- duplicate attach → 409;
- blank website clears it;
- candidate search trims query and caps it at 160 chars;
- create-new requires a nonblank name and validates optional email;
- relationship removal returns 404 when link is absent.

- [ ] **Step 2: Run route tests and confirm RED**

- [ ] **Step 3: Add Zod schemas**

Use exact inputs:

```ts
const websiteSchema = z.object({ website: z.string().trim().max(500).nullable().or(z.literal("")) });
const familyContactSchema = z.object({ contactId: z.string().uuid(), role: z.string().trim().max(160).nullable().optional(), makePrimary: z.boolean().optional().default(false) });
const newFamilyContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(80).nullable().optional(),
  email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  role: z.string().trim().max(160).nullable().optional(),
  makePrimary: z.boolean().optional().default(false),
});
const familyContactUpdateSchema = z.object({ role: z.string().trim().max(160).nullable(), isPrimary: z.boolean() });
```

Split `name` into first/last using the same helper convention as the current event-profile contact creation flow.

- [ ] **Step 4: Implement routes with existing `sendError()` mapping**

Keep all routes under the already owner-protected Event Family router mounting; do not add manager/public access.

- [ ] **Step 5: Run route tests + API build**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: expose event family contact api`.

---

### Task 4: Read-only family contact summary on member-profile API

**Files:**
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Test: existing/new event-profile route regression test

**Interfaces:**
- Extend event-profile response with:

```ts
familySharedContact: null | {
  familyId: string;
  familyName: string;
  website: string | null;
  primaryContact: null | {
    contactId: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
  };
};
```

- [ ] **Step 1: Add failing route regression**

Create a member family with website + primary family contact and require the Event Profile detail response to expose the compact summary while leaving `profile.contacts` unchanged.

- [ ] **Step 2: Run and confirm RED**

- [ ] **Step 3: Add family summary query**

When `familyContext.kind === "event_family"`, fetch the family website and Primary linked contact. Do not append that contact to the local `contacts` array.

- [ ] **Step 4: Add empty-state behavior**

Return `familySharedContact: null` when both family website and Primary contact are absent.

- [ ] **Step 5: Run regression + API build**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: expose family contact context on profiles`.

---

### Task 5: Event Family Website & Contacts UI

**Files:**
- Modify: `artifacts/adventure-zone/src/features/event-families/event-family-types.ts`
- Create: `artifacts/adventure-zone/src/components/event-families/event-family-website-contacts.tsx`
- Create: `artifacts/adventure-zone/src/components/event-families/event-family-website-contacts.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx`

**Interfaces:**
- `EventFamilyDetail` gains `website: string | null` and `contacts: EventFamilyContact[]`.
- Component props:

```ts
type Props = {
  family: EventFamilyDetail;
  onChanged: () => Promise<void> | void;
};
```

- [ ] **Step 1: Write frontend RED tests**

Require:
- website link + Edit website;
- clearing/saving website;
- `+ Add contact` opens simple existing/new choices;
- existing search displays name, phone/email/context;
- attaching calls family contact endpoint;
- Create new allows name-only and optional phone/email/role;
- Primary badge;
- Make primary;
- Remove from family confirmation and API call;
- server errors remain visible;
- no actual CRM-contact delete endpoint is called.

- [ ] **Step 2: Run component test and confirm RED**

- [ ] **Step 3: Extend family types**

Add:

```ts
export type EventFamilyContact = {
  id: string;
  contactId: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
};
```

and website/contacts on `EventFamilyDetail`.

- [ ] **Step 4: Implement compact website editing**

Show website or `Not recorded`, `Visit website`, and `Edit website`. Use the same existing `normalizeExternalWebsite()` helper used by event profiles for outbound links.

- [ ] **Step 5: Implement contact rows and Add Contact drawer/panel**

Keep the panel lightweight rather than building a new page. Existing contact path searches `/event-families/:id/contact-candidates`; New contact path posts `/event-families/:id/contacts/new`.

- [ ] **Step 6: Implement Primary/role/remove controls**

Contact rows link to `/contacts/:contactId` and existing `/contacts/:contactId/edit` for person editing. Family-specific role and Primary mutate only the relationship.

- [ ] **Step 7: Mount in `EventFamilyPage` near the top**

Place **Website & Contacts** after the rating summary and before Family notes. Call existing `load()` after successful mutations.

- [ ] **Step 8: Run component/page tests + frontend build**

Expected: PASS.

- [ ] **Step 9: Commit**

Commit message: `feat: add website contacts to event family page`.

---

### Task 6: Member-profile read-only Family contact box

**Files:**
- Create: `artifacts/adventure-zone/src/components/event-profiles/family-contact-summary.tsx`
- Create: `artifacts/adventure-zone/src/components/event-profiles/family-contact-summary.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`

**Interfaces:**

```ts
export type FamilySharedContact = {
  familyId: string;
  familyName: string;
  website: string | null;
  primaryContact: {
    contactId: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};
```

- [ ] **Step 1: Write RED rendering tests**

Require:
- family name/role/phone/email render read-only;
- Family website link uses URL normalizer;
- Open family links to `/event-families/:familyId`;
- no Edit/Remove/Make Primary controls;
- local profile Contacts section still contains only local contacts;
- no summary is rendered when shared data is null.

- [ ] **Step 2: Run and confirm RED**

- [ ] **Step 3: Implement `FamilyContactSummary`**

Render a compact card with heading `Family contact — {familyName}`. Website-only families still render the box; contact-only families still render the box.

- [ ] **Step 4: Wire into `EventProfileWorkspace`**

Add `familySharedContact` prop/data and render it near existing Event Family context, but outside the normal local Contacts section and without changing Event Family notes behavior.

- [ ] **Step 5: Run frontend tests/build**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: show family contacts on member profiles`.

---

### Task 7: Regression, deletion safety, and final verification

**Files:**
- Test: family contact backend tests
- Test: family route tests
- Test: member-profile family summary tests
- Test: family/page frontend tests
- Test: existing Event Family member/profile/contact regressions

**Interfaces:** none; final integration gate.

- [ ] **Step 1: Add/confirm deletion safety regression**

Delete an Event Family that has linked contacts and assert:
- `event_family_contacts` rows are gone;
- `contacts` rows still exist;
- contact activities/history remain;
- member profile records still exist, with Event Family membership removed by the existing family-delete behavior if/when such delete endpoint exists.

If no Event Family deletion endpoint exists today, keep this as repository/schema cascade coverage only and do not add a new family-delete UI/API just for this feature.

- [ ] **Step 2: Run all focused backend suites**

Run:
- new family contact repository tests;
- Event Family routes;
- Event Family existing membership/repository tests;
- contact route/repository regressions;
- event-profile detail regressions.

Expected: 0 failures.

- [ ] **Step 3: Run all focused frontend suites**

Run:
- EventFamilyPage/component tests;
- family website/contact tests;
- FamilyContactSummary tests;
- EventProfileWorkspace/page regressions.

Expected: 0 failures.

- [ ] **Step 4: Run builds and typecheck**

Run:

```bash
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
pnpm --filter @workspace/adventure-zone typecheck
```

If current `main` still has unrelated TypeScript failures, compare against a fresh `main` baseline and require **zero new errors in feature-touched files**; do not silently waive new errors.

- [ ] **Step 5: Sync latest `main` before final PR**

Merge current `origin/main` into the feature branch. Resolve overlaps by preserving newer main behavior plus this feature; rerun the focused suites/builds after the sync.

- [ ] **Step 6: Remove temporary development-only workflows/scripts**

No temporary push-only CI helpers should appear in the PR diff.

- [ ] **Step 7: Inspect final diff**

Verify:
- no family contact is copied into member-profile local contacts;
- no destructive contact deletion is introduced;
- organization membership behavior is untouched;
- Event Family notes remain intact;
- website uses existing safe URL normalization;
- only one Primary per family is enforced.

- [ ] **Step 8: Create a draft PR**

Suggested title:

`feat: add websites and contacts to event families`

Suggested PR summary:
- family website management;
- attach/create real CRM contacts with family role/Primary state;
- read-only family contact context on member event profiles;
- no copying/deleting of local CRM history;
- test/build verification results.

Do not merge without explicit user approval.
