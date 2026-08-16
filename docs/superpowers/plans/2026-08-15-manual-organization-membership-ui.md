# Manual Organization Membership UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin manually add existing or newly created event/location profiles to an organization from either side of the relationship, while keeping the child profile intact and easy to manage.

**Architecture:** Add a non-destructive self-referencing organization membership (`parentOrganizationId`) for manual organization/event relationships. Keep the existing `organization_locations` consolidation path and `addProfileAsLocation()` untouched for ACT consolidation/import cleanup; the new manual UI must never call that destructive/retiring path. Expose one shared membership service through organization/profile APIs, then reuse one small picker/drawer from both the parent organization and child profile views.

**Tech Stack:** React + TypeScript + Wouter frontend, Express + Zod API, Drizzle ORM + PostgreSQL, Vitest + Testing Library.

## Global Constraints

- Parent organization profile action copy: **+ Add location/event**.
- Child profile action copy: **Add to organization…**, **Change organization…**, **Remove from organization**.
- New child creation reuses the existing **Add Event/Lead** form; name required, all other fields optional.
- Manual membership is non-destructive: never delete, merge, retire, or relocate child contacts, notes, call outcomes, activities, follow-ups, bookings, route/leg assignments, map/location data, ACT provenance/history, or attachments.
- Moving an already-related profile requires explicit confirmation; never silently reassign it.
- Removing membership only clears the organization relationship.
- Organization membership and Event Family membership remain separate concepts.
- Keep the UI lightweight: drawer/dialog, no separate organization-management page, no raw hierarchy terminology.
- Do not use `addProfileAsLocation()` for this feature; that existing function intentionally converts a source profile into an internal `organization_location` and retires the source profile.
- Every relationship write is validated server-side and transactional.

---

## File Structure Map

### Database / domain
- Modify: `lib/db/src/schema/index.ts` — add `organizations.parentOrganizationId` self-reference plus supporting index/relation typing.
- Create: `lib/db/migrations/0XX_manual_organization_membership.sql` — additive nullable FK/index migration; choose the next unused migration number at implementation time after checking current `main`.
- Create: `artifacts/api-server/src/features/organizations/organization-membership.ts` — all attach/move/remove validation and transactional writes.
- Create: `artifacts/api-server/src/features/organizations/organization-membership.test.ts` — domain-level preservation, move, removal, and invalid nesting tests.
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts` — parent/child summaries and picker search methods.
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts` (or the current profile-summary repository used by `/event-profiles/:id`) — expose `organizationContext` without changing existing Event Family context.

### API
- Modify: `artifacts/api-server/src/routes/organizations.ts` — parent child-search and attach/create-facing endpoints.
- Modify: `artifacts/api-server/src/routes/event-profiles.ts` — organization picker plus attach/change/remove endpoints and parent preselection on create.
- Add/modify focused route tests beside existing organization/event-profile route tests.

### Frontend
- Create: `artifacts/adventure-zone/src/components/organizations/organization-membership-drawer.tsx` — shared search/attach/change/remove picker UI.
- Create: `artifacts/adventure-zone/src/components/organizations/organization-membership-drawer.test.tsx`.
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx` — render organization context and child-side actions; render parent `Locations & Events` controls when current profile is an organization parent.
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx` — refresh profile data after membership mutations.
- Modify: `artifacts/adventure-zone/src/pages/EventProfileNewPage.tsx` and the existing Add Event/Lead form component used by it — accept `organizationId` preselection from query/props without adding required fields.
- Add/modify focused EventProfilePage/NewPage tests.

---

### Task 1: Add non-destructive organization membership to the data model

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/0XX_manual_organization_membership.sql`
- Create: `artifacts/api-server/src/features/organizations/organization-membership.test.ts`

**Interfaces:**
- Produces: `organizations.parentOrganizationId: string | null`.
- Produces DB constraint: `parent_organization_id -> organizations.id ON DELETE RESTRICT`.
- Existing `consolidatedIntoId` and `organization_locations` remain unchanged and mean something different.

- [ ] **Step 1: Write the failing schema/domain test**

Add a test that creates a parent organization and child organization, sets only `parentOrganizationId`, and verifies the child itself still exists with the same ID and original related records.

```ts
it("stores manual organization membership without retiring the child profile", async () => {
  const parent = await fixtures.organization({ name: "Water Lantern Festival" });
  const child = await fixtures.organization({ name: "Water Lantern Festival - Denver" });
  const note = await fixtures.activity({ organizationId: child.id, summary: "Called Denver coordinator" });

  await db.update(organizations)
    .set({ parentOrganizationId: parent.id })
    .where(eq(organizations.id, child.id));

  const savedChild = await db.query.organizations.findFirst({ where: eq(organizations.id, child.id) });
  const savedNote = await db.query.activities.findFirst({ where: eq(activities.id, note.id) });

  expect(savedChild?.id).toBe(child.id);
  expect(savedChild?.parentOrganizationId).toBe(parent.id);
  expect(savedChild?.consolidatedIntoId).toBeNull();
  expect(savedNote?.organizationId).toBe(child.id);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:
```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership.test.ts
```
Expected: FAIL because `parentOrganizationId` does not exist yet.

- [ ] **Step 3: Add the migration and Drizzle field**

Migration shape:
```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS parent_organization_id uuid;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_parent_organization_id_fkey;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_parent_organization_id_fkey
  FOREIGN KEY (parent_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS organizations_parent_organization_id_idx
  ON organizations(parent_organization_id)
  WHERE parent_organization_id IS NOT NULL;
```

Add the corresponding self-reference field in `lib/db/src/schema/index.ts` using the repository's existing Drizzle self-reference pattern.

- [ ] **Step 4: Run migration/schema contract tests plus the focused test**

Run:
```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership.test.ts src/features/act-replacement/schema-contract.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/index.ts lib/db/migrations artifacts/api-server/src/features/organizations/organization-membership.test.ts
git commit -m "feat: add manual organization membership field"
```

---

### Task 2: Implement the membership service and hierarchy rules

**Files:**
- Create: `artifacts/api-server/src/features/organizations/organization-membership.ts`
- Modify: `artifacts/api-server/src/features/organizations/organization-membership.test.ts`

**Interfaces:**
- Produces:
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
- `parentOrganizationId: null` means remove membership.
- Must not call `addProfileAsLocation()`.

- [ ] **Step 1: Add failing tests for attach, move, remove, and invalid hierarchy**

Cover:
```ts
it("attaches an existing profile without moving its CRM history", ...)
it("moves a child only by changing parentOrganizationId", ...)
it("removes membership without deleting the child", ...)
it("rejects self-parenting", ...)
it("rejects making a child with children into another child", ...)
it("rejects retired/consolidated profiles", ...)
it("keeps event-family membership independent", ...)
```

For preservation, seed at least contacts, activity/note, follow-up, booking, and ACT provenance fields against the child and assert their `organizationId` remains the child ID before and after attach/move/remove.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-membership.test.ts
```
Expected: FAIL because `setOrganizationMembership()` is missing.

- [ ] **Step 3: Implement minimal transactional validation/write**

Core behavior:
```ts
if (childId === parentOrganizationId) {
  throw new OrganizationConflictError("A profile cannot belong to itself.");
}

return database.transaction(async (tx) => {
  await lockOrganizationMutationDomain(tx);
  const child = await loadOrganizationForUpdate(tx, childId);
  if (!child || child.consolidatedIntoId) throw new OrganizationConflictError(...);

  if (parentOrganizationId) {
    const parent = await loadOrganizationForUpdate(tx, parentOrganizationId);
    if (!parent || parent.consolidatedIntoId) throw new OrganizationConflictError(...);
    if (parent.parentOrganizationId) throw new OrganizationConflictError("That organization is already a location/event of another organization.");
    const childCount = await countChildren(tx, childId);
    if (childCount > 0) throw new OrganizationConflictError("An organization with locations/events cannot be added beneath another organization.");
  }

  const previousParentOrganizationId = child.parentOrganizationId;
  await tx.update(organizations)
    .set({ parentOrganizationId, updatedAt: now })
    .where(eq(organizations.id, childId));

  return { childId, parentOrganizationId, previousParentOrganizationId };
});
```

Do not touch contacts/bookings/activities/follow-ups/call sessions/organization contacts.

- [ ] **Step 4: Run focused tests**

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

### Task 3: Add parent/child summaries and searchable pickers

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify/add tests: `artifacts/api-server/src/features/organizations/organization-repository.test.ts`
- Modify: the current event-profile summary repository used by `/event-profiles/:id`

**Interfaces:**
- Produces:
```ts
export type OrganizationMembershipSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

listOrganizationChildren(parentOrganizationId: string): Promise<OrganizationMembershipSummary[]>;
searchEligibleOrganizationParents(query: string, childId?: string): Promise<OrganizationMembershipSummary[]>;
searchEligibleOrganizationChildren(query: string, parentOrganizationId: string): Promise<Array<OrganizationMembershipSummary & {
  currentParent: OrganizationMembershipSummary | null;
}>>;
```
- Profile detail response adds:
```ts
organizationContext: {
  parent: OrganizationMembershipSummary | null;
  children: OrganizationMembershipSummary[];
}
```
while keeping existing `familyContext` untouched.

- [ ] **Step 1: Write failing repository tests**

Test search by name/city/region and assert:
- current parent's children are excluded from Add Existing results;
- profiles already belonging elsewhere return `currentParent` context so the UI can ask before moving;
- a child detail returns its parent;
- a parent detail returns its direct children only;
- Event Family context remains separately populated.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts
```
Expected: FAIL on missing methods/context.

- [ ] **Step 3: Implement queries using `parentOrganizationId`**

Use case-insensitive search over normalized organization/profile name plus city/region using the same search conventions already used by `listOrganizations()`; do not invent a second fuzzy-search dependency.

- [ ] **Step 4: Run repository tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/features/organizations/organization-repository.test.ts artifacts/api-server/src/features/event-profiles
git commit -m "feat: expose organization membership context"
```

---

### Task 4: Add membership API endpoints

**Files:**
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Add/modify route tests in the corresponding route test files.

**Interfaces:**
- Parent-side search:
```http
GET /organizations/:id/membership-candidates?q=denver
```
Response:
```json
{ "profiles": [{ "id": "...", "name": "...", "city": "Denver", "region": "CO", "currentParent": null }] }
```
- Child-side parent search:
```http
GET /event-profiles/:id/organization-candidates?q=water
```
- Attach/change:
```http
PUT /event-profiles/:id/organization
{ "organizationId": "uuid" }
```
- Remove:
```http
DELETE /event-profiles/:id/organization
```

- [ ] **Step 1: Write failing route tests**

Assert:
- attach returns updated parent summary;
- move from another organization returns 200 only after an explicit request naming the new parent (server never auto-moves from search alone);
- remove clears only membership;
- validation conflicts return 409 with `OrganizationConflictError.message`;
- search endpoints return concise candidate data and current-parent context.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/organizations.test.ts src/routes/event-profiles.test.ts
```
If those exact route test files do not exist on current `main`, create focused `organization-membership-routes.test.ts` beside the route modules and run that file instead.

- [ ] **Step 3: Implement the routes with Zod validation**

Schemas:
```ts
const membershipInput = z.object({ organizationId: z.string().uuid() });
const candidateQuery = z.object({ q: z.string().trim().max(200).default("") });
```

Call only `setOrganizationMembership()` for membership writes.

- [ ] **Step 4: Run route tests and API build**

```bash
pnpm --filter @workspace/api-server exec vitest run <focused membership route tests>
pnpm --filter @workspace/api-server build
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/organizations.ts artifacts/api-server/src/routes/event-profiles.ts artifacts/api-server/src/routes/*membership*.test.ts
git commit -m "feat: add organization membership endpoints"
```

---

### Task 5: Reuse Add Event/Lead with organization preselection

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/EventProfileNewPage.tsx`
- Modify: the existing Add Event/Lead form component used by `EventProfileNewPage`
- Modify: event-profile create API input only if it does not already accept `parentOrganizationId`
- Add/modify tests for EventProfileNewPage/form and create API.

**Interfaces:**
- `/event-profiles/new?organizationId=<uuid>` preselects organization membership.
- Existing form validation remains: only name required.
- Create request includes `parentOrganizationId?: string | null` and server validates it using the same membership rules before commit.

- [ ] **Step 1: Write failing tests**

```tsx
it("preselects an organization when opened from + Add location/event", ...)
it("still allows name-only creation", ...)
it("creates the profile already linked to the chosen organization", ...)
```

The API test must prove create + parent assignment is atomic: invalid parent means no half-created child remains.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfileNewPage.test.tsx
pnpm --filter @workspace/api-server exec vitest run <event-profile create test file>
```

- [ ] **Step 3: Implement preselection/atomic create**

Read `organizationId` from `useSearch()` on `EventProfileNewPage`, pass it into the shared form, show a lightweight read-only context line such as:

```tsx
<p className="text-sm text-slate-600">Adding to <strong>{organizationName}</strong></p>
```

Do not make organization data required twice.

- [ ] **Step 4: Run focused tests**

Same commands as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/pages/EventProfileNewPage.tsx artifacts/adventure-zone/src/components artifacts/api-server/src/routes/event-profiles.ts
git commit -m "feat: create profiles inside organizations"
```

---

### Task 6: Build the shared organization-membership drawer

**Files:**
- Create: `artifacts/adventure-zone/src/components/organizations/organization-membership-drawer.tsx`
- Create: `artifacts/adventure-zone/src/components/organizations/organization-membership-drawer.test.tsx`

**Interfaces:**
```ts
type OrganizationMembershipDrawerProps = {
  mode: "add-child" | "choose-parent";
  currentProfileId: string;
  currentParent?: { id: string; name: string } | null;
  parentOrganization?: { id: string; name: string } | null;
  open: boolean;
  onClose(): void;
  onChanged(): void;
};
```

- [ ] **Step 1: Write failing UI tests**

Cover both modes:
- parent mode shows **Find existing profile** and **Create new**;
- child mode searches organizations;
- candidate already assigned elsewhere shows current organization and requires a second confirm click before PUT;
- current membership exposes **Remove from organization**;
- successful mutation calls `onChanged()` and closes/resets;
- server 409 message is shown plainly and the drawer stays open.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/organization-membership-drawer.test.tsx
```
Expected: FAIL because component is missing.

- [ ] **Step 3: Implement the lightweight drawer**

Use existing button/input/dialog/drawer primitives already present in the app. Keep one search field, simple result cards, and at most one confirmation state. Parent-side **Create new** navigates to:

```ts
setLocation(`/event-profiles/new?organizationId=${parentOrganization.id}`)
```

- [ ] **Step 4: Run drawer tests**

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

### Task 7: Wire both directions into the profile workspace

**Files:**
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Add/modify: `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx` and/or workspace tests.

**Interfaces:**
- Child header/context displays `Part of <Organization>` linking to `/event-profiles/:organizationId`.
- If child has no parent: button **Add to organization…**.
- If child has parent: button **Change organization…** plus **Remove from organization** in the drawer/menu.
- If profile has children: section heading **Locations & Events**, list child profile links, and button **+ Add location/event**.

- [ ] **Step 1: Write failing integration/UI tests**

Cover:
```tsx
it("shows + Add location/event on an organization with children or parent capability", ...)
it("opens add-child drawer from the Locations & Events section", ...)
it("shows Part of Water Lantern Festival on a child", ...)
it("shows Add to organization on an unattached profile", ...)
it("refreshes both context and children after membership change without full reload", ...)
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfilePage.test.tsx src/components/event-profiles/*test.tsx
```
Use the exact existing focused workspace test file(s) present on current `main`.

- [ ] **Step 3: Implement profile workspace controls**

Keep membership UI next to existing family/context information but visually distinguish them:
- Event Family: existing `Part of <Family>` behavior remains.
- Organization: `Part of <Organization>` / `Locations & Events`.

Do not combine or overwrite `familyContext` with `organizationContext`.

Refactor `EventProfilePage` loading into a `loadProfile()` callback so `onChanged={loadProfile}` refreshes the page after attach/move/remove.

- [ ] **Step 4: Run focused UI tests plus typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run <focused profile workspace tests>
pnpm --filter @workspace/adventure-zone typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/**/*test.tsx
git commit -m "feat: manage organization membership from profiles"
```

---

### Task 8: Protect duplicates, preserve old consolidation behavior, and run final verification

**Files:**
- Modify only if needed: `artifacts/api-server/src/features/organizations/organization-repository.ts` duplicate queries.
- Test: existing duplicate/consolidation tests plus new membership tests.
- No permanent CI workflow files.

**Interfaces:**
- Manual parent/child pairs must not be presented as merge duplicates against each other.
- `addProfileAsLocation()` and existing consolidation flows must retain their current behavior for legacy/import cleanup; manual membership does not replace them in this change.

- [ ] **Step 1: Add a failing duplicate-protection regression test if current duplicate detection does not already exclude parent/child pairs**

```ts
it("does not offer a manual organization parent and child as duplicates", async () => {
  ...
  expect(groups.flatMap((group) => group.records.map((record) => record.id)))
    .not.toEqual(expect.arrayContaining([parent.id, child.id]));
});
```

Also retain/run an existing `addProfileAsLocation()` test proving that legacy consolidation still works independently.

- [ ] **Step 2: Run the regression set and confirm any required RED**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/organizations/organization-membership.test.ts \
  src/features/organizations/organization-repository.test.ts \
  src/features/organizations/add-profile-as-location.test.ts
```
Adjust only for exact existing test filename if needed.

- [ ] **Step 3: Make the smallest duplicate-query change required**

When comparing two organization records, exclude pairs where either record's `parentOrganizationId` equals the other's ID. Do not globally hide children from normal profile search.

- [ ] **Step 4: Run full final verification**

Backend:
```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/organizations/organization-membership.test.ts \
  src/features/organizations/organization-repository.test.ts \
  src/features/organizations/add-profile-as-location.test.ts
pnpm --filter @workspace/api-server build
```

Frontend:
```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/organizations/organization-membership-drawer.test.tsx \
  src/pages/EventProfilePage.test.tsx \
  src/pages/EventProfileNewPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Schema/migration:
```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-replacement/schema-contract.test.ts
```

Repository safety:
```bash
git diff --check main...HEAD
git diff --name-only main...HEAD
```

Manually inspect the final diff and confirm:
- no temporary `.github/workflows/*` files;
- no call from the manual-membership UI/API to `addProfileAsLocation()`;
- no mutation of child CRM ownership fields during attach/move/remove;
- Event Family controls still render separately;
- only one obvious membership action is shown in each context.

- [ ] **Step 5: Commit final regression fixes and open a draft PR**

```bash
git add -A
git commit -m "test: verify manual organization membership"
```

Open a **draft** PR against current `main`. Do not merge without explicit user instruction.
