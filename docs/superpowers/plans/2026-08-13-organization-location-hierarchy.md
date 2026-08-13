# Organization and Location Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add general parent-organization and child-location profiles, clickable organization/location websites, reviewed ACT family suggestions, and safeguards that prevent legitimate locations from being merged as duplicates.

**Architecture:** Keep every existing organization row as a full profile and add a nullable self-reference for its parent. Extend organization and event-profile repositories with hierarchy summaries and transactional hierarchy writes. Generate non-mutating multi-location suggestions from multiple evidence signals, expose explicit review actions, and make every destructive merge revalidate that no selected record is a proposed or confirmed family member.

**Tech Stack:** TypeScript, PostgreSQL, Drizzle ORM, Express 5, Zod, React 19, Wouter, Vitest, Testing Library, pnpm workspace.

## Global Constraints

- This is a general CRM capability, not Water Lantern Festival-specific.
- Hierarchy depth is exactly one level: parents may have children; children may not.
- Existing child profile IDs, URLs, contacts, notes, bookings, follow-ups, call sessions, map data, travel legs, and ACT provenance remain unchanged.
- Contacts, notes, follow-ups, and websites may exist at both parent and child levels.
- Name similarity alone never creates or confirms a family.
- Ambiguous candidates require review; no family is automatically applied.
- Bulk duplicate merging must skip both proposed and confirmed location families.
- Ungrouping clears only the parent relationship.
- External website links use HTTPS normalization and safe new-tab attributes.
- No new runtime dependency is required.

---

## File map

- `lib/db/migrations/020_organization_location_hierarchy.sql`: non-destructive hierarchy and review-state migration.
- `lib/db/src/schema/index.ts`: Drizzle definitions for the parent reference and family reviews.
- `artifacts/api-server/src/features/organizations/organization-hierarchy-input.ts`: Zod request contracts.
- `artifacts/api-server/src/features/organizations/organization-hierarchy.ts`: transactional hierarchy validation and writes.
- `artifacts/api-server/src/features/organizations/organization-family-matcher.ts`: pure multi-signal candidate classification.
- `artifacts/api-server/src/features/organizations/organization-repository.ts`: hierarchy-aware summaries, list search, rollups, duplicate exclusion, and merge guards.
- `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`: parent and child navigation data.
- `artifacts/api-server/src/routes/organizations.ts`: hierarchy, review, and guarded merge endpoints.
- `artifacts/adventure-zone/src/features/organizations/organization-repository.ts`: browser-safe organization response types.
- `artifacts/adventure-zone/src/features/organizations/website-url.ts`: safe website URL normalization.
- `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`: parent/child website and navigation UI.
- `artifacts/adventure-zone/src/components/organizations/organization-list.tsx`: parent-first results and location counts.
- `artifacts/adventure-zone/src/components/organizations/locations-section.tsx`: parent location cards.
- `artifacts/adventure-zone/src/components/organizations/hierarchy-controls.tsx`: group, move, and ungroup controls.
- `artifacts/adventure-zone/src/components/organizations/duplicates-view.tsx`: three review outcomes and family-safe bulk behavior.
- `artifacts/adventure-zone/src/features/organizations/bulk-duplicate-merge.ts`: client-side classification guard.
- Tests live beside the feature under `artifacts/api-server/src/**` and `artifacts/adventure-zone/src/**`, following current Vitest conventions.

### Task 1: Persist the one-level hierarchy and family review state

**Files:**
- Create: `lib/db/migrations/020_organization_location_hierarchy.sql`
- Modify: `lib/db/src/schema/index.ts`
- Test: `artifacts/api-server/src/features/organizations/organization-hierarchy-schema.test.ts`

**Interfaces:**
- Produces: `organizations.parentOrganizationId: string | null`
- Produces: `organizationFamilyReviews` with `groupKey`, `candidateIds`, `status`, `evidence`, and timestamps.
- Produces statuses: `"proposed" | "not_related"`; confirmed families are represented by live parent links.

- [ ] **Step 1: Write the failing schema contract tests**

Assert that `organizations.parentOrganizationId` exists, references `organizations.id` with `onDelete: "restrict"`, and is indexed. Assert that `organizationFamilyReviews.groupKey` is unique and its status check accepts only `proposed` and `not_related`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @workspace/api-server test -- organization-hierarchy-schema.test.ts`

Expected: FAIL because the parent column and review table do not exist.

- [ ] **Step 3: Add the migration**

Use the following SQL shape:

```sql
ALTER TABLE organizations
  ADD COLUMN parent_organization_id uuid;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_parent_organization_fk
  FOREIGN KEY (parent_organization_id)
  REFERENCES organizations(id)
  ON DELETE RESTRICT;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_not_own_parent
  CHECK (parent_organization_id IS NULL OR parent_organization_id <> id);

CREATE INDEX organizations_parent_organization_idx
  ON organizations(parent_organization_id);

CREATE TABLE organization_family_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL UNIQUE,
  candidate_ids jsonb NOT NULL,
  status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_family_reviews_status_valid
    CHECK (status IN ('proposed', 'not_related')),
  CONSTRAINT organization_family_reviews_candidates_array
    CHECK (jsonb_typeof(candidate_ids) = 'array')
);
```

- [ ] **Step 4: Mirror the migration in Drizzle**

Add the self-reference using `AnyPgColumn`:

```ts
parentOrganizationId: uuid("parent_organization_id").references(
  (): AnyPgColumn => organizations.id,
  { onDelete: "restrict" },
),
```

Define `organizationFamilyReviews` with the exact SQL column names and checks above.

- [ ] **Step 5: Run schema, type, and migration tests**

Run:

```bash
pnpm --filter @workspace/api-server test -- organization-hierarchy-schema.test.ts
pnpm --filter @workspace/db typecheck
pnpm --filter @workspace/api-server typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations/020_organization_location_hierarchy.sql lib/db/src/schema/index.ts artifacts/api-server/src/features/organizations/organization-hierarchy-schema.test.ts
git commit -m "feat: add organization location hierarchy schema"
```

### Task 2: Implement transactional group, move, and ungroup rules

**Files:**
- Create: `artifacts/api-server/src/features/organizations/organization-hierarchy-input.ts`
- Create: `artifacts/api-server/src/features/organizations/organization-hierarchy.ts`
- Test: `artifacts/api-server/src/features/organizations/organization-hierarchy.test.ts`

**Interfaces:**
- Consumes: `organizations.parentOrganizationId`
- Produces: `setOrganizationParent(database, { childId, parentId }, changedAt): Promise<void>`
- Produces: `ungroupOrganization(database, { childId }, changedAt): Promise<void>`
- Produces: `createOrganizationParent(database, { name, website, phone, childIds }, changedAt): Promise<{ parentId: string }>`
- Produces: `HierarchyConflictError` with a user-readable `message`.

- [ ] **Step 1: Write failing service tests**

Cover these exact cases:

```ts
it("attaches an existing location without moving its related rows");
it("creates a new organization-wide parent and attaches every selected location");
it("moves a child from one parent to another");
it("ungroups by clearing only parentOrganizationId");
it("rejects self-parenting");
it("rejects assigning a child as a parent");
it("rejects assigning a parent-with-children beneath another parent");
it("rolls back all child assignments when one selected child is invalid");
```

For preservation assertions, seed contacts, activities, bookings, follow-ups, call sessions, and ACT external links against the child and assert their organization IDs are unchanged.

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- organization-hierarchy.test.ts`

Expected: FAIL because the hierarchy service does not exist.

- [ ] **Step 3: Define exact request schemas**

```ts
export const setOrganizationParentInputSchema = z.object({
  childId: z.string().uuid(),
  parentId: z.string().uuid(),
});

export const ungroupOrganizationInputSchema = z.object({
  childId: z.string().uuid(),
});

export const createOrganizationParentInputSchema = z.object({
  name: z.string().trim().min(1).max(240),
  website: z.string().trim().max(2048).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  childIds: z.array(z.string().uuid()).min(1),
});
```

- [ ] **Step 4: Implement locked validation inside one transaction**

Select the parent and all children with `.for("update")`. Reject:

```ts
if (childId === parentId) throw new HierarchyConflictError("A profile cannot be its own parent.");
if (parent.parentOrganizationId) throw new HierarchyConflictError(`${parent.name} is already a location and cannot own locations.`);
if (childHasChildren) throw new HierarchyConflictError(`${child.name} already owns locations and cannot become a location.`);
```

Update only `parentOrganizationId` and `updatedAt`. Record audit actions `organization_parent_set`, `organization_parent_cleared`, and `organization_parent_created`.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server test -- organization-hierarchy.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-hierarchy-input.ts artifacts/api-server/src/features/organizations/organization-hierarchy.ts artifacts/api-server/src/features/organizations/organization-hierarchy.test.ts
git commit -m "feat: add safe organization hierarchy operations"
```

### Task 3: Add hierarchy-aware profile summaries and rollups

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`
- Modify: `artifacts/adventure-zone/src/features/organizations/organization-repository.ts`
- Test: `artifacts/api-server/src/features/organizations/organization-hierarchy-read.test.ts`
- Test: `artifacts/api-server/src/features/event-profiles/event-profile-hierarchy.test.ts`

**Interfaces:**
- Produces: `OrganizationParentSummary = { id: string; name: string; website: string | null }`
- Produces: `OrganizationLocationSummary` with `id`, `name`, address, `website`, `localStatus`, `nextFollowUp`, `nextBooking`, `travelLeg`, and `primaryContactName`.
- Extends `EventProfile` with `parent: OrganizationParentSummary | null`, `locations: OrganizationLocationSummary[]`, and `rollups`.

- [ ] **Step 1: Write failing read tests**

Seed one parent and two locations. Assert:

- parent contacts and activities stay out of each child;
- child contacts and activities stay out of the parent;
- child profile returns its parent;
- parent returns both location summaries;
- bookings, follow-ups, travel legs, and primary contacts appear on the correct location card;
- rollups return location count, upcoming booking count, overdue follow-up count, represented travel legs, and most recent contact date;
- the old child ID still resolves through `getEventProfile(childId)`.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @workspace/api-server test -- organization-hierarchy-read.test.ts
pnpm --filter @workspace/api-server test -- event-profile-hierarchy.test.ts
```

Expected: FAIL because parent, locations, and rollups are absent.

- [ ] **Step 3: Add hierarchy response types**

Use exact public shapes:

```ts
export type OrganizationHierarchyRollups = {
  locationCount: number;
  upcomingBookingCount: number;
  overdueFollowUpCount: number;
  travelLegs: Array<{ id: string; name: string; color: string }>;
  mostRecentContactAt: Date | null;
};
```

Add `parent`, `locations`, and `rollups` to API and frontend repository types without replacing existing fields.

- [ ] **Step 4: Query parent and child summaries without loading full histories**

Use bounded aggregate queries keyed by `parentOrganizationId`. Keep complete notes, contacts, and provenance queries scoped to the requested profile ID. Do not union parent and child histories.

- [ ] **Step 5: Run focused tests and typechecks**

Run:

```bash
pnpm --filter @workspace/api-server test -- organization-hierarchy-read.test.ts event-profile-hierarchy.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/features/event-profiles/event-profile-repository.ts artifacts/adventure-zone/src/features/organizations/organization-repository.ts artifacts/api-server/src/features/organizations/organization-hierarchy-read.test.ts artifacts/api-server/src/features/event-profiles/event-profile-hierarchy.test.ts
git commit -m "feat: return parent and location profile summaries"
```

### Task 4: Make profile search parent-first while preserving local discovery

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list.tsx`
- Test: `artifacts/api-server/src/features/organizations/organization-search-hierarchy.test.ts`
- Test: `artifacts/adventure-zone/src/components/organizations/organization-list-hierarchy.test.tsx`

**Interfaces:**
- Extends `OrganizationListRecord` with `parent: OrganizationParentSummary | null` and `locationCount: number`.
- Default empty search returns root profiles only.
- Non-empty search may return matching parents and matching children.

- [ ] **Step 1: Write failing search tests**

Assert:

```ts
it("lists a family parent once when no search is supplied");
it("finds a parent by organization name and includes its location count");
it("finds a child by city");
it("finds a child by local contact name");
it("finds a child by phone");
it("finds a child by email");
it("ranks a direct parent-name match before child matches");
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @workspace/api-server test -- organization-search-hierarchy.test.ts`

Expected: FAIL because the list condition only searches `organizations.name`.

- [ ] **Step 3: Implement one hierarchy-aware search predicate**

For empty searches add `organizations.parentOrganizationId IS NULL`. For non-empty searches use `EXISTS` predicates against active organization contacts and child location fields. Order direct organization name matches, then parents, then children, then name.

- [ ] **Step 4: Update list rendering**

Show `{locationCount} locations` for parents. For children show `Part of {parent.name}`. Retain the exact child profile link so a city/contact search opens the local workspace.

- [ ] **Step 5: Run server and UI tests**

Run:

```bash
pnpm --filter @workspace/api-server test -- organization-search-hierarchy.test.ts
pnpm --filter @workspace/adventure-zone test -- organization-list-hierarchy.test.tsx
```

If the frontend package has no `test` script, run `pnpm exec vitest run artifacts/adventure-zone/src/components/organizations/organization-list-hierarchy.test.tsx` from the workspace root.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/adventure-zone/src/components/organizations/organization-list.tsx artifacts/api-server/src/features/organizations/organization-search-hierarchy.test.ts artifacts/adventure-zone/src/components/organizations/organization-list-hierarchy.test.tsx
git commit -m "feat: search organization families and locations"
```

### Task 5: Add safe clickable websites and parent/location profile UI

**Files:**
- Create: `artifacts/adventure-zone/src/features/organizations/website-url.ts`
- Create: `artifacts/adventure-zone/src/features/organizations/website-url.test.ts`
- Create: `artifacts/adventure-zone/src/components/organizations/locations-section.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Test: `artifacts/adventure-zone/src/components/event-profiles/event-profile-hierarchy.test.tsx`

**Interfaces:**
- Produces: `normalizeExternalWebsite(value: string | null): string | null`
- Consumes: `EventProfile.parent`, `EventProfile.locations`, and `EventProfile.rollups`.

- [ ] **Step 1: Write URL safety tests**

Use this table:

```ts
expect(normalizeExternalWebsite("waterlanternfestival.com")).toBe("https://waterlanternfestival.com/");
expect(normalizeExternalWebsite("https://waterlanternfestival.com/reno")).toBe("https://waterlanternfestival.com/reno");
expect(normalizeExternalWebsite("http://example.com")).toBe("http://example.com/");
expect(normalizeExternalWebsite("javascript:alert(1)")).toBeNull();
expect(normalizeExternalWebsite("ftp://example.com")).toBeNull();
expect(normalizeExternalWebsite("not a website")).toBeNull();
expect(normalizeExternalWebsite(null)).toBeNull();
```

- [ ] **Step 2: Run the URL test and verify failure**

Run: `pnpm exec vitest run artifacts/adventure-zone/src/features/organizations/website-url.test.ts`

Expected: FAIL because the utility does not exist.

- [ ] **Step 3: Implement strict HTTP(S) normalization**

Prefix protocol-less values with `https://`, parse with `new URL()`, require `http:` or `https:`, require a dotted hostname or `localhost`, and return `url.href`; otherwise return `null`.

- [ ] **Step 4: Write the failing component test**

Assert:

- parent and child `Visit website` anchors use `target="_blank"` and `rel="noreferrer noopener"`;
- unsafe values render editable/display text but no anchor;
- child header shows `Part of [parent]`;
- parent shows `Locations & Events`;
- each location card shows address, local status, next booking/follow-up, travel leg, primary contact, and its own webpage action.

- [ ] **Step 5: Build the smallest profile components**

Keep `EventProfileWorkspace` responsible for layout. Put child-card mapping in `LocationsSection` to avoid enlarging the existing workspace component further.

- [ ] **Step 6: Run component tests and typecheck**

Run:

```bash
pnpm exec vitest run artifacts/adventure-zone/src/features/organizations/website-url.test.ts artifacts/adventure-zone/src/components/event-profiles/event-profile-hierarchy.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/features/organizations/website-url.ts artifacts/adventure-zone/src/features/organizations/website-url.test.ts artifacts/adventure-zone/src/components/organizations/locations-section.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-hierarchy.test.tsx
git commit -m "feat: show organization websites and locations"
```

### Task 6: Expose hierarchy write endpoints and manual controls

**Files:**
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Create: `artifacts/api-server/src/routes/organizations-hierarchy.test.ts`
- Modify: `artifacts/adventure-zone/src/actions/organizations.ts`
- Create: `artifacts/adventure-zone/src/components/organizations/hierarchy-controls.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Test: `artifacts/adventure-zone/src/components/organizations/hierarchy-controls.test.tsx`

**Interfaces:**
- Adds `POST /organizations/hierarchy/parent`
- Adds `POST /organizations/hierarchy/create-parent`
- Adds `POST /organizations/hierarchy/ungroup`
- All endpoints return `{ ok: true, parentId?: string }` or `{ ok: false, error: string }`.

- [ ] **Step 1: Write failing route tests**

Cover valid attach/create/move/ungroup, malformed UUIDs, hierarchy conflicts returning HTTP 409 with the service message, and unexpected failures returning HTTP 500 without leaking internals.

- [ ] **Step 2: Verify route tests fail**

Run: `pnpm --filter @workspace/api-server test -- organizations-hierarchy.test.ts`

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Register static hierarchy routes before `/organizations/:id`**

Parse with Task 2 schemas. Map `HierarchyConflictError` to 409 and Zod errors to 400.

- [ ] **Step 4: Write failing control tests**

Cover:

- creating a new parent from selected location profiles;
- selecting an existing parent;
- moving a child;
- ungrouping with confirmation;
- displaying 409 conflict text;
- refreshing the profile after success.

- [ ] **Step 5: Implement actions and controls**

Use `apiPost` wrappers with the exact endpoint payloads. Never offer a child or parent-with-children as an eligible parent. Confirm ungrouping copy: **This removes the organization link only. Local history will stay on this profile.**

- [ ] **Step 6: Run tests and typechecks**

Run:

```bash
pnpm --filter @workspace/api-server test -- organizations-hierarchy.test.ts
pnpm exec vitest run artifacts/adventure-zone/src/components/organizations/hierarchy-controls.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/organizations.ts artifacts/api-server/src/routes/organizations-hierarchy.test.ts artifacts/adventure-zone/src/actions/organizations.ts artifacts/adventure-zone/src/components/organizations/hierarchy-controls.tsx artifacts/adventure-zone/src/components/organizations/hierarchy-controls.test.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx
git commit -m "feat: manage organization locations from profiles"
```

### Task 7: Classify multi-location candidates using multiple signals

**Files:**
- Create: `artifacts/api-server/src/features/organizations/organization-family-matcher.ts`
- Create: `artifacts/api-server/src/features/organizations/organization-family-matcher.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/matching/organization-matcher.ts`

**Interfaces:**
- Produces: `FamilyCandidateEvidence = { family: "name" | "website" | "location" | "act_relationship"; label: string }`
- Produces: `classifyOrganizationFamily(records): { kind: "location_family"; groupKey: string; candidateIds: string[]; evidence: FamilyCandidateEvidence[] } | { kind: "insufficient" }`
- Name agreement never counts as sufficient by itself.

- [ ] **Step 1: Write failing candidate tests**

Cover:

```ts
it("suggests same normalized base name plus shared website domain and different cities");
it("suggests shared website domain plus compatible ACT relationship and different cities");
it("does not suggest similar names without another identity signal");
it("does not suggest records at the same address as different locations");
it("does not suggest conflicting website domains");
it("produces a stable group key independent of record order");
```

Include Water Lantern Festival-shaped fixtures but keep all code generic.

- [ ] **Step 2: Verify matcher tests fail**

Run: `pnpm --filter @workspace/api-server test -- organization-family-matcher.test.ts`

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Implement pure normalization and classification**

Reuse `normalizeWebsiteHost` from ACT matching. Derive a conservative base name by removing only explicit trailing location syntax such as `" - Reno, NV"` or `" (Reno) NV"`; never remove arbitrary words. Require location divergence plus at least one shared identity signal beyond name, or an ACT relationship plus a shared identity signal.

- [ ] **Step 4: Integrate as non-mutating ACT evidence**

Keep `matchOrganization` behavior for exact record matching. Export family evidence separately so import/review can suggest a hierarchy without converting an exact/ambiguous match into a write.

- [ ] **Step 5: Run matcher and existing ACT tests**

Run:

```bash
pnpm --filter @workspace/api-server test -- organization-family-matcher.test.ts
pnpm --filter @workspace/api-server test -- organization-matcher
```

Expected: PASS, including existing matcher tests.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-family-matcher.ts artifacts/api-server/src/features/organizations/organization-family-matcher.test.ts artifacts/api-server/src/features/act-replacement/matching/organization-matcher.ts
git commit -m "feat: suggest multi-location organization families"
```

### Task 8: Add reviewed family decisions to duplicate review

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Create: `artifacts/api-server/src/features/organizations/organization-family-review.test.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/duplicates-view.tsx`
- Test: `artifacts/adventure-zone/src/components/organizations/duplicates-family-review.test.tsx`

**Interfaces:**
- `GET /organizations/duplicates` returns groups with `classification: "duplicate" | "location_candidate"` and evidence.
- Adds `POST /organizations/family-review` with:
  - `{ action: "make_locations", candidateIds, parent: { kind: "existing", parentId } | { kind: "new", name, website?, phone? } }`
  - `{ action: "not_related", candidateIds }`

- [ ] **Step 1: Write failing repository and route tests**

Assert candidate groups are labeled `location_candidate`, stale candidate ID sets return 409, `make_locations` uses the transactional hierarchy service, and `not_related` stores a stable review so the same group does not reappear.

- [ ] **Step 2: Verify server tests fail**

Run: `pnpm --filter @workspace/api-server test -- organization-family-review.test.ts`

Expected: FAIL because family review endpoints do not exist.

- [ ] **Step 3: Implement candidate persistence and review**

Upsert `proposed` reviews when strong candidates are read. Before applying a decision, regenerate the group and compare sorted candidate IDs. On `make_locations`, create/select the parent and delete the proposed review after the parent links commit. On `not_related`, persist status `not_related`.

- [ ] **Step 4: Write failing UI tests for the three outcomes**

Require visible actions:

- **Merge duplicates**
- **Same organization—make locations**
- **Not related**

For a location candidate, destructive merge is not preselected and bulk selection excludes it.

- [ ] **Step 5: Update the duplicate review UI**

Show evidence in plain language, city/state for each candidate, and a create/select parent flow. Refresh server results after either review action.

- [ ] **Step 6: Run tests and typechecks**

Run:

```bash
pnpm --filter @workspace/api-server test -- organization-family-review.test.ts
pnpm exec vitest run artifacts/adventure-zone/src/components/organizations/duplicates-family-review.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/routes/organizations.ts artifacts/api-server/src/features/organizations/organization-family-review.test.ts artifacts/adventure-zone/src/components/organizations/duplicates-view.tsx artifacts/adventure-zone/src/components/organizations/duplicates-family-review.test.tsx
git commit -m "feat: review organization families separately from duplicates"
```

### Task 9: Guard individual and bulk duplicate merges on both client and server

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Test: `artifacts/api-server/src/features/organizations/organization-merge-family-guard.test.ts`
- Modify: `artifacts/adventure-zone/src/features/organizations/bulk-duplicate-merge.ts`
- Modify: `artifacts/adventure-zone/src/features/organizations/bulk-duplicate-merge.test.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/duplicates-view.tsx`

**Interfaces:**
- Produces: `assertOrganizationsMergeable(transaction, ids): Promise<void>`
- Extends `BulkMergeGroup` with `classification: "duplicate" | "location_candidate"`.

- [ ] **Step 1: Write failing server guard tests**

Assert merge rejection when:

- primary and duplicate are parent/child;
- two duplicates are siblings;
- any selected ID belongs to a current proposed family review;
- the primary owns children;
- a duplicate owns children.

Assert ordinary confirmed duplicates still merge and preserve existing relationship re-parenting.

- [ ] **Step 2: Verify server guard tests fail**

Run: `pnpm --filter @workspace/api-server test -- organization-merge-family-guard.test.ts`

Expected: FAIL because `mergeOrganizations` does not validate family state.

- [ ] **Step 3: Add the guard inside the existing merge transaction**

Lock all selected organizations. Check live parent references and current proposed review candidate arrays before moving any related row. Throw `HierarchyConflictError("These profiles may be locations of the same organization. Review the location group before merging.")`.

- [ ] **Step 4: Write the failing client bulk test**

Pass one duplicate group and one location candidate. Assert only the duplicate group reaches the `merge` callback and progress totals count only eligible duplicate groups.

- [ ] **Step 5: Filter bulk groups and disable destructive controls**

```ts
const eligibleGroups = groups.filter(
  (group) => group.classification === "duplicate",
);
```

The server remains authoritative even if an old browser submits a stale group.

- [ ] **Step 6: Run merge tests**

Run:

```bash
pnpm --filter @workspace/api-server test -- organization-merge-family-guard.test.ts
pnpm exec vitest run artifacts/adventure-zone/src/features/organizations/bulk-duplicate-merge.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/routes/organizations.ts artifacts/api-server/src/features/organizations/organization-merge-family-guard.test.ts artifacts/adventure-zone/src/features/organizations/bulk-duplicate-merge.ts artifacts/adventure-zone/src/features/organizations/bulk-duplicate-merge.test.ts artifacts/adventure-zone/src/components/organizations/duplicates-view.tsx
git commit -m "fix: protect organization locations from duplicate merging"
```

### Task 10: Verify migration, representative families, and production builds

**Files:**
- Create: `scripts/verify-organization-location-hierarchy.ts`
- Create: `scripts/verify-organization-location-hierarchy.test.ts`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-08-12-organization-location-hierarchy-design.md` only if implementation reveals a factual interface correction.

**Interfaces:**
- Produces root script `verify:organization-hierarchy`.
- Verification is read-only unless passed an explicit fixture/test database.

- [ ] **Step 1: Write the failing verification-script test**

Using fixture data, assert the report includes:

```ts
{
  parentCount: 1,
  locationCount: 2,
  orphanedChildCount: 0,
  nestedHierarchyCount: 0,
  familyMergeRiskCount: 0,
  preservedBookingCount: 2,
  preservedActLinkCount: 2
}
```

- [ ] **Step 2: Verify the script test fails**

Run: `pnpm exec vitest run scripts/verify-organization-location-hierarchy.test.ts`

Expected: FAIL because the verification script does not exist.

- [ ] **Step 3: Implement read-only verification**

Report self-parenting, nested hierarchies, orphaned parent IDs, proposed family IDs that appear in eligible duplicate groups, and child relationship counts. Support filtering by organization name so Water Lantern Festival can be inspected without hard-coding it.

- [ ] **Step 4: Run the complete relevant suite**

Run:

```bash
pnpm --filter @workspace/api-server test
pnpm exec vitest run artifacts/adventure-zone/src
pnpm --filter @workspace/db typecheck
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
pnpm verify:organization-hierarchy -- --organization "Water Lantern Festival"
```

Expected: tests, typechecks, and builds PASS; verification reports no nesting, orphans, or merge risks. If production data does not yet contain a reviewed Water Lantern family, the report must say **No matching parent family has been confirmed yet** instead of treating that as success.

- [ ] **Step 5: Perform browser acceptance checks**

Verify on desktop and a narrow mobile viewport:

1. Profiles lists Water Lantern Festival once after the family is confirmed.
2. Its parent profile shows clickable main website and locations.
3. A location shows its direct page and **Part of Water Lantern Festival**.
4. Searching a city or local contact opens the correct child.
5. Grouping and ungrouping preserve the child's timeline and booking counts.
6. The duplicate page does not offer confirmed or proposed locations to bulk merge.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-organization-location-hierarchy.ts scripts/verify-organization-location-hierarchy.test.ts package.json docs/superpowers/specs/2026-08-12-organization-location-hierarchy-design.md
git commit -m "test: verify organization location hierarchy"
```

## Plan self-review

- Spec coverage: schema, one-level validation, parent/child information ownership, websites, parent and child screens, parent-first search, local discovery, ACT suggestions, manual grouping/moving/ungrouping, duplicate-review outcomes, server/client bulk protection, rollback behavior, rollups, provenance preservation, and representative-family verification are each assigned to a task.
- Placeholder scan: no TBD, TODO, “implement later,” generic error-handling instruction, or undefined follow-on task remains.
- Type consistency: `parentOrganizationId`, `OrganizationParentSummary`, `OrganizationLocationSummary`, `OrganizationHierarchyRollups`, `classification`, and hierarchy endpoint names are used consistently across producer and consumer tasks.
