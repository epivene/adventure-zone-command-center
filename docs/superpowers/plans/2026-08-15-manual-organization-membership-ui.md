# Manual Organization Membership UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin manually add existing or newly created event/location profiles to an organization from either side of the relationship while preserving the child profile and all of its CRM history.

**Architecture:** Add a nullable self-reference `organizations.parentOrganizationId` for manual organization membership. Keep the existing `organization_locations` / `addProfileAsLocation()` consolidation path unchanged because it intentionally retires a source profile; the new manual flow must never call it. A focused membership service owns attach/move/remove validation, APIs expose searchable candidates, and one shared drawer is reused by both parent and child profile views.

**Tech Stack:** React + TypeScript + Wouter, Express + Zod, Drizzle ORM + PostgreSQL, Vitest + Testing Library.

## Global Constraints

- Parent action copy: **+ Add location/event**.
- Child action copy: **Add to organization…**, **Change organization…**, **Remove from organization**.
- New child creation reuses **Add Event / Lead**; only name is required and all existing optional blanks remain valid.
- Attach/move/remove changes only `parentOrganizationId`; never move or rewrite contacts, notes, call outcomes, activities, follow-ups, bookings, route/leg assignments, map/location data, ACT provenance/history, or attachments.
- Moving a child between organizations requires explicit confirmation.
- Removing membership never deletes the child.
- Event Family membership stays independent from organization membership.
- No separate hierarchy-management page; use the existing profile workspace and a small drawer.
- Never call `addProfileAsLocation()` from this feature.
- Writes are transactional and revalidate hierarchy constraints server-side.

---

## Task 1: Add the manual membership field and migration

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/src/migrations.ts`
- Create: `lib/db/migrations/041_manual_organization_membership.sql`
- Create: `artifacts/api-server/src/features/organizations/organization-membership.test.ts`

**Interfaces:**
- Produces `organizations.parentOrganizationId: string | null` mapped to `parent_organization_id`.
- FK: `organizations.parent_organization_id -> organizations.id ON DELETE RESTRICT`.
- Existing `consolidatedIntoId` remains unchanged and separate.

- [ ] **Step 1: Write the failing field-preservation test**

```ts
it("stores membership without retiring or reassigning the child", async () => {
  const parent = await seedOrganization("Water Lantern Festival");
  const child = await seedOrganization("Water Lantern Festival - Denver");
  const activity = await seedActivity(child.id, "Called Denver coordinator");

  await db.update(organizations)
    .set({ parentOrganizationId: parent.id })
    .where(eq(organizations.id, child.id));

  const savedChild = await db.query.organizations.findFirst({ where: eq(organizations.id, child.id) });
  const savedActivity = await db.query.activities.findFirst({ where: eq(activities.id, activity.id) });

  expect(savedChild?.parentOrganizationId).toBe(parent.id);
  expect(savedChild?.consolidatedIntoId).toBeNull();
  expect(savedActivity?.organizationId).toBe(child.id);
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership.test.ts
```
Expected: FAIL because `parentOrganizationId` does not exist.

- [ ] **Step 3: Add schema, migration, and migration registration**

`041_manual_organization_membership.sql`:

```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS parent_organization_id uuid;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_parent_organization_id_fkey;
ALTER TABLE organizations ADD CONSTRAINT organizations_parent_organization_id_fkey
  FOREIGN KEY (parent_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS organizations_parent_organization_id_idx
  ON organizations(parent_organization_id)
  WHERE parent_organization_id IS NOT NULL;
```

Register it in `lib/db/src/migrations.ts`:

```ts
{
  name: "041_manual_organization_membership.sql",
  markerSql: `SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'organizations'
      AND column_name = 'parent_organization_id'
  ) AS ready`,
},
```

- [ ] **Step 4: Run GREEN + schema contract**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership.test.ts src/features/act-replacement/schema-contract.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/index.ts lib/db/src/migrations.ts lib/db/migrations/041_manual_organization_membership.sql artifacts/api-server/src/features/organizations/organization-membership.test.ts
git commit -m "feat: add manual organization membership field"
```

---

## Task 2: Implement transactional attach, move, and remove

**Files:**
- Create: `artifacts/api-server/src/features/organizations/organization-membership.ts`
- Modify: `artifacts/api-server/src/features/organizations/organization-membership.test.ts`

**Interfaces:**

```ts
export type OrganizationMembershipResult = {
  childId: string;
  parentOrganizationId: string | null;
  previousParentOrganizationId: string | null;
};

export async function setOrganizationMembership(
  database: Database,
  input: { childId: string; parentOrganizationId: string | null },
  now: Date,
): Promise<OrganizationMembershipResult>;
```

- [ ] **Step 1: Add failing behavior tests**

Create explicit tests for attach preserving child CRM ownership, move from parent A to parent B, remove to `null`, self-parent rejection, one-level hierarchy rejection, retired/consolidated profile rejection, and Event Family membership preservation.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership.test.ts
```
Expected: FAIL because `setOrganizationMembership` is missing.

- [ ] **Step 3: Implement the service**

Use `lockOrganizationMutationDomain()` and row locks. Validate child and parent are active/non-retired. Reject self-parenting, a proposed parent that is itself a child, and a child that already owns children. The only organization update is:

```ts
await tx.update(organizations)
  .set({ parentOrganizationId: input.parentOrganizationId, updatedAt: now })
  .where(eq(organizations.id, input.childId));
```

Do not update `contacts`, `bookings`, `activities`, `followUps`, `callSessions`, `organizationContacts`, or `organizationLocations`.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-membership.ts artifacts/api-server/src/features/organizations/organization-membership.test.ts
git commit -m "feat: add organization membership service"
```

---

## Task 3: Expose parent/child context and candidate search

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Create: `artifacts/api-server/src/features/organizations/organization-membership-repository.test.ts`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`

**Interfaces:**

```ts
export type OrganizationMembershipSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

searchEligibleOrganizationParents(query: string, childId: string): Promise<OrganizationMembershipSummary[]>;
searchEligibleOrganizationChildren(query: string, parentId: string): Promise<Array<OrganizationMembershipSummary & {
  currentParent: OrganizationMembershipSummary | null;
}>>;
listOrganizationChildren(parentId: string): Promise<OrganizationMembershipSummary[]>;
```

Profile detail adds:

```ts
organizationContext: {
  parent: OrganizationMembershipSummary | null;
  children: OrganizationMembershipSummary[];
};
```

Existing `familyContext` remains unchanged.

- [ ] **Step 1: Write failing search/context tests**

Verify name/city/region search, current-parent context for profiles attached elsewhere, exclusion of already-related children from add-existing results, child detail parent context, parent detail direct children, and separate Event Family context.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership-repository.test.ts
```
Expected: FAIL because methods/context are absent.

- [ ] **Step 3: Implement repository queries**

Reuse `DrizzleOrganizationRepository.listOrganizations()` search conventions; do not add a new search dependency.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership-repository.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/features/organizations/organization-membership-repository.test.ts artifacts/api-server/src/features/event-profiles/event-profile-repository.ts
git commit -m "feat: expose organization membership context"
```

---

## Task 4: Add the membership API

**Files:**
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Create: `artifacts/api-server/src/routes/organization-membership-routes.test.ts`

**Interfaces:**

```http
GET /organizations/:id/membership-candidates?q=denver
GET /event-profiles/:id/organization-candidates?q=water
PUT /event-profiles/:id/organization
DELETE /event-profiles/:id/organization
```

PUT body:

```json
{ "organizationId": "00000000-0000-0000-0000-000000000001" }
```

- [ ] **Step 1: Write failing route tests**

Verify both search endpoints, attach, explicit move, remove, 400 invalid UUID, and 409 hierarchy conflict. Assert attach/move returns updated parent summary.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/organization-membership-routes.test.ts
```
Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement endpoints**

```ts
const membershipInput = z.object({ organizationId: z.string().uuid() });
const candidateQuery = z.object({ q: z.string().trim().max(200).default("") });
```

Every write calls `setOrganizationMembership()`; map `OrganizationConflictError` to HTTP 409.

- [ ] **Step 4: Run GREEN + API build**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/organization-membership-routes.test.ts
pnpm --filter @workspace/api-server build
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/organizations.ts artifacts/api-server/src/routes/event-profiles.ts artifacts/api-server/src/routes/organization-membership-routes.test.ts
git commit -m "feat: add organization membership endpoints"
```

---

## Task 5: Reuse Add Event / Lead with organization preselection

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/EventProfileNewPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-form.tsx`
- Modify: `artifacts/adventure-zone/src/actions/event-profiles.ts`
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Create: `artifacts/adventure-zone/src/pages/EventProfileNewPage.organization-membership.test.tsx`
- Create: `artifacts/api-server/src/routes/event-profile-create-membership.test.ts`

**Interfaces:**
- `/event-profiles/new?organizationId=<uuid>` preselects organization membership.
- `EventProfileForm` receives `initialOrganizationId?: string`.
- Create payload accepts `parentOrganizationId?: string | null`.

- [ ] **Step 1: Write failing tests**

Frontend: organization preselection and name-only submission. API: created profile has `parentOrganizationId`; invalid parent aborts the create transaction and leaves no child row.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfileNewPage.organization-membership.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/routes/event-profile-create-membership.test.ts
```
Expected: FAIL because preselection/create membership is absent.

- [ ] **Step 3: Implement preselection and atomic create**

Read `organizationId` beside the existing `familyId` query param. Pass it through `EventProfileForm` and `createEventProfileAction()`. Show `Adding to <Organization Name>` and do not add new required inputs. Validate the parent in the same server transaction that creates the profile.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfileNewPage.organization-membership.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/routes/event-profile-create-membership.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/pages/EventProfileNewPage.tsx artifacts/adventure-zone/src/pages/EventProfileNewPage.organization-membership.test.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-form.tsx artifacts/adventure-zone/src/actions/event-profiles.ts artifacts/api-server/src/routes/event-profiles.ts artifacts/api-server/src/routes/event-profile-create-membership.test.ts
git commit -m "feat: create profiles inside organizations"
```

---

## Task 6: Build one shared membership drawer

**Files:**
- Create: `artifacts/adventure-zone/src/components/organizations/organization-membership-drawer.tsx`
- Create: `artifacts/adventure-zone/src/components/organizations/organization-membership-drawer.test.tsx`

**Interfaces:**

```ts
type OrganizationMembershipDrawerProps = {
  mode: "add-child" | "choose-parent";
  profileId: string;
  parentOrganization: { id: string; name: string } | null;
  currentParent: { id: string; name: string } | null;
  open: boolean;
  onClose(): void;
  onChanged(): void;
};
```

- [ ] **Step 1: Write failing UI tests**

Verify parent mode offers **Find existing profile** and **Create new**; child mode searches parents; a candidate attached elsewhere requires confirmation before PUT; remove calls DELETE; 409 stays visible; success calls `onChanged()`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/organization-membership-drawer.test.tsx
```
Expected: FAIL because component is missing.

- [ ] **Step 3: Implement lightweight drawer**

Use existing dialog/drawer/input/button primitives. Parent **Create new** navigates to:

```ts
navigate(`/event-profiles/new?organizationId=${parentOrganization.id}`);
```

Keep one search box, simple candidate cards, and one confirmation state.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/organization-membership-drawer.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/organizations/organization-membership-drawer.tsx artifacts/adventure-zone/src/components/organizations/organization-membership-drawer.test.tsx
git commit -m "feat: add organization membership drawer"
```

---

## Task 7: Wire both directions into the profile workspace

**Files:**
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/EventProfilePage.organization-membership.test.tsx`

**Interfaces:**
- Child with parent: `Part of <Organization>` link + **Change organization…**.
- Child without parent: **Add to organization…**.
- Parent with children: **Locations & Events** list + **+ Add location/event**.
- `EventProfilePage` exposes `loadProfile()` and passes `onChanged={loadProfile}`.

- [ ] **Step 1: Write failing integration tests**

Verify the visible states above, both drawer directions, immediate refresh after attach/move/remove, and that Event Family `familyContext` still renders independently.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfilePage.organization-membership.test.tsx
```
Expected: FAIL because controls are absent.

- [ ] **Step 3: Implement workspace wiring**

Add a compact **Locations & Events** section only when the profile owns children. Keep organization context separate from `familyContext`. Refactor current profile loading in `EventProfilePage.tsx` into `loadProfile()` so mutations refresh without a browser reload.

- [ ] **Step 4: Run GREEN + typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfilePage.organization-membership.test.tsx src/components/organizations/organization-membership-drawer.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/EventProfilePage.organization-membership.test.tsx
git commit -m "feat: manage organization membership from profiles"
```

---

## Task 8: Duplicate protection and final verification

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Create: `artifacts/api-server/src/features/organizations/organization-membership-duplicates.test.ts`

**Interfaces:**
- Manual parent/child pairs are never suggested as destructive duplicates against each other.
- Existing consolidation and `addProfileAsLocation()` behavior remains unchanged.

- [ ] **Step 1: Write the duplicate-protection regression test**

```ts
it("does not suggest a manual parent and child as duplicates", async () => {
  const parent = await seedOrganization("Water Lantern Festival");
  const child = await seedOrganization("Water Lantern Festival Denver", { parentOrganizationId: parent.id });
  const groups = await repository.findDuplicates();
  const pairIds = groups.flatMap((group) => group.records.map((record) => record.id));
  expect(pairIds).not.toEqual(expect.arrayContaining([parent.id, child.id]));
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership-duplicates.test.ts
```
Expected: FAIL if duplicate detection still pairs parent/child records.

- [ ] **Step 3: Add the minimal duplicate exclusion**

Exclude a pair when `left.parentOrganizationId === right.id` or `right.parentOrganizationId === left.id`. Do not hide children from normal profile search.

- [ ] **Step 4: Run complete verification**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/organizations/organization-membership.test.ts \
  src/features/organizations/organization-membership-repository.test.ts \
  src/features/organizations/organization-membership-duplicates.test.ts \
  src/routes/organization-membership-routes.test.ts \
  src/routes/event-profile-create-membership.test.ts \
  src/features/act-replacement/schema-contract.test.ts

pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/organizations/organization-membership-drawer.test.tsx \
  src/pages/EventProfileNewPage.organization-membership.test.tsx \
  src/pages/EventProfilePage.organization-membership.test.tsx

pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
git diff --check main...HEAD
git diff --name-only main...HEAD
```

Inspect the diff and confirm: no temporary workflows; no call to `addProfileAsLocation()` from manual membership; no CRM ownership-field rewrites; Event Family UI remains separate; each side has one obvious organization-membership action.

- [ ] **Step 5: Commit and open a draft PR**

```bash
git add -A
git commit -m "test: verify manual organization membership"
```

Open a **draft** PR against current `main`. Do not merge without explicit user instruction.
