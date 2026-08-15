# Profiles & Event Families UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Profiles into a clean top-level directory with reliable filters, editable family/group membership, one Add Event / Lead flow, and a less cluttered profile-detail experience.

**Architecture:** Keep the existing organization/profile, Event Family, booking, and location data models intact. Fix behavior by introducing one normalized Profiles query contract, server-backed membership search, explicit family/group context in list responses, and focused UI components for the unified creation flow and possible-locations drawer. Preserve ACT/import provenance in storage but remove it from normal user-facing profile UI.

**Tech Stack:** React + TypeScript + Wouter, Express, Drizzle ORM/PostgreSQL, Zod, Vitest + Testing Library, existing Adventure Zone UI primitives and API helpers.

## Global Constraints

- The broad Profiles directory shows standalone profiles, Event Family cards, and organization/group parents by default.
- Individual family/group members are hidden by default and revealed by **Show family/group members**.
- Search may surface hidden members, but must render their parent family/group context.
- Profile-type controls must submit the actual backend/stored values; frontend labels may be friendlier.
- Event Family member search must query the full dataset server-side and must not be limited to page 1.
- Adding/removing family/group membership must not destroy the underlying profile, contacts, bookings, notes, calls, follow-ups, or history.
- “New Event” and “Add Lead” become one flow named **Add Event / Lead**.
- Only event/profile name is required for a minimal new lead; all other creation fields remain optional unless the existing domain model requires them for a specific later booking action.
- Source provenance is removed from normal profile UI only; underlying provenance/import/audit data remains stored.
- Possible Locations is collapsed behind a drawer/sheet trigger.
- No automatic profile merge or silent family/group reassignment.
- Do not redesign Calendar, Route Map, Leg Manager, finance, crew, or calling workflows.

---

## File structure and responsibility map

**Profiles query/list behavior**
- `artifacts/adventure-zone/src/features/organizations/last-resort-input.ts` — canonical frontend Profiles query parser and URL normalization.
- `artifacts/api-server/src/features/organizations/last-resort-input.ts` — canonical API query parser if the API currently maintains its own copy; keep values in sync with frontend.
- `artifacts/api-server/src/features/organizations/organization-repository.ts` — database list filtering, member visibility, parent-context metadata, search exceptions.
- `artifacts/api-server/src/routes/organizations.ts` — request parsing and response shape for Profiles and membership search.
- `artifacts/adventure-zone/src/components/organizations/organization-list.tsx` — filter controls and contextual list rendering.
- `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx` — page composition, family cards, suggestions placement.

**Event Family/group membership**
- `artifacts/api-server/src/routes/event-families.ts` — Event Family membership/search APIs.
- `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx` — family management page.
- Create `artifacts/adventure-zone/src/components/event-families/profile-member-picker.tsx` — reusable server-backed profile picker.
- Reuse/extend organization location/group endpoints rather than creating a second unrelated grouping model.

**Unified creation**
- `artifacts/adventure-zone/src/pages/BookingNewPage.tsx` — becomes the single Add Event / Lead entry page.
- `artifacts/adventure-zone/src/components/bookings/booking-form.tsx` — split/reshape into progressive sections without changing existing booking persistence semantics unnecessarily.
- Create `artifacts/adventure-zone/src/components/bookings/event-lead-match-picker.tsx` — early duplicate/existing-profile suggestions.
- `artifacts/adventure-zone/src/actions/bookings.ts` and corresponding API booking/profile creation route — accept optional family/group association and minimal lead fields.
- `artifacts/adventure-zone/src/App.tsx` and any navigation/action components containing “New Event” or “Add Lead” links — normalize to the same route/copy.

**Profile detail cleanup**
- `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx` — remove provenance display, show family/group context, host compact locations trigger.
- `artifacts/adventure-zone/src/components/organizations/possible-locations-section.tsx` — reuse inside drawer body.
- Create `artifacts/adventure-zone/src/components/organizations/possible-locations-drawer.tsx` — desktop drawer/mobile sheet wrapper.

---

### Task 1: Normalize Profiles filters end-to-end

**Files:**
- Modify: `artifacts/adventure-zone/src/features/organizations/last-resort-input.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Test: `artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx`
- Create or modify: `artifacts/api-server/src/features/organizations/organization-repository.test.ts`

**Interfaces:**
- Consumes: existing `OrganizationListQuery`, profile records, URL query params.
- Produces: one normalized query contract with `showMembers: boolean`, exact profile-type values, and preserved combined filters.

- [ ] **Step 1: Write failing frontend query tests**

Add tests proving:

```ts
expect(buildOrParseQuery("?type=festival_event&region=MT&hasPhone=yes&showMembers=yes")).toMatchObject({
  placeType: "festival_event",
  region: "MT",
  hasPhone: true,
  showMembers: true,
});
```

Also assert that selecting the visible Event option submits the actual stored/API value rather than `event`, and Reset returns `/profiles` with no active filters.

- [ ] **Step 2: Run the focused frontend tests and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage.test.tsx
```

Expected: FAIL because current profile type values and `showMembers` behavior are not aligned.

- [ ] **Step 3: Write failing repository/API tests for combined filtering**

Cover at least:

```ts
{
  placeType: "festival_event",
  region: "MT",
  hasPhone: true,
  hasBooking: true,
  showMembers: false,
}
```

and assert all predicates are applied together rather than one parameter silently disappearing.

- [ ] **Step 4: Run the focused API tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts
```

- [ ] **Step 5: Implement the canonical query contract**

Extend the Zod transform to produce:

```ts
type OrganizationListQuery = {
  search: string;
  lastResort: "all" | "only";
  travelLegId: string | null;
  placeType: string | null;
  region: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  hasFollowUp: boolean;
  hasBooking: boolean;
  hasLocations: boolean;
  showMembers: boolean;
  page: number;
  pageSize: number;
};
```

Use a URL parameter named `showMembers=yes`.

- [ ] **Step 6: Fix filter controls to use exact values**

Populate profile-type options from the actual supported constants or a shared map such as:

```ts
const PROFILE_TYPE_OPTIONS = [
  { value: "festival_event", label: "Event" },
  { value: "venue", label: "Venue" },
  { value: "company", label: "Company" },
] as const;
```

Do not submit an invented umbrella value if the backend does not store it.

- [ ] **Step 7: Add the Show family/group members control**

Render a checkbox/toggle:

```tsx
<input name="showMembers" type="checkbox" value="yes" defaultChecked={query.showMembers} />
```

and preserve it through pagination links.

- [ ] **Step 8: Pass every supported filter through `OrganizationsPage.loadProfiles`**

Ensure `pageSize`, `showMembers`, and all currently supported contact/activity filters are carried to `/organizations` rather than dropped.

- [ ] **Step 9: Run frontend/API tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add artifacts/adventure-zone/src/features/organizations/last-resort-input.ts artifacts/adventure-zone/src/components/organizations/organization-list.tsx artifacts/adventure-zone/src/pages/OrganizationsPage.tsx artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/routes/organizations.ts artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx artifacts/api-server/src/features/organizations/organization-repository.test.ts
git commit -m "fix: make profile filters reliable"
```

---

### Task 2: Hide grouped members by default and surface contextual search matches

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Test: `artifacts/api-server/src/features/organizations/organization-repository.test.ts`
- Test: `artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 `OrganizationListQuery.showMembers`.
- Produces: list records with optional parent context:

```ts
type ProfileParentContext =
  | { kind: "event_family"; id: string; name: string }
  | { kind: "organization_group"; id: string; name: string }
  | null;
```

- [ ] **Step 1: Write failing repository tests for default visibility**

Fixture:
- standalone profile A;
- Event Family member B;
- Water Lantern child/location C;
- parent/group records.

Assert default list excludes B and C but includes A plus the relevant family/group top-level representation.

- [ ] **Step 2: Add failing search exception test**

Search for B by name and assert it is returned even with `showMembers: false`, with:

```ts
parentContext: { kind: "event_family", id: familyId, name: "Fourth of July" }
```

- [ ] **Step 3: Run API test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts
```

- [ ] **Step 4: Implement member visibility predicates**

Default behavior:
- no search + `showMembers=false`: exclude family/group children;
- `showMembers=true`: include them;
- search present: allow matching hidden members and attach `parentContext`.

Do not retire/delete records to achieve hiding.

- [ ] **Step 5: Render contextual member search results**

In the list card, render:

```tsx
{organization.parentContext ? (
  <p className="text-xs font-medium text-slate-500">
    {organization.parentContext.kind === "event_family" ? "Part of" : "Location of"}{" "}
    {organization.parentContext.name}
  </p>
) : null}
```

Keep the underlying profile link editable.

- [ ] **Step 6: Update count/copy semantics**

Ensure “Showing X of Y profiles” reflects the filtered directory/search result, not the raw hidden-member total.

- [ ] **Step 7: Run frontend and API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage.test.tsx
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/routes/organizations.ts artifacts/adventure-zone/src/components/organizations/organization-list.tsx artifacts/adventure-zone/src/pages/OrganizationsPage.tsx artifacts/api-server/src/features/organizations/organization-repository.test.ts artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx
git commit -m "feat: make grouped profiles contextual"
```

---

### Task 3: Replace the Event Family page-1 picker with server-backed member search

**Files:**
- Create: `artifacts/adventure-zone/src/components/event-families/profile-member-picker.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx`
- Modify: `artifacts/api-server/src/routes/event-families.ts`
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Create: `artifacts/adventure-zone/src/components/event-families/profile-member-picker.test.tsx`
- Create or modify: `artifacts/api-server/src/routes/event-families.test.ts`

**Interfaces:**
- Produces API:

```http
GET /event-families/:familyId/member-candidates?q=&page=1&pageSize=20
```

Response:

```ts
type EventFamilyMemberCandidate = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  parentContext: ProfileParentContext;
  membership: "available" | "current_family" | "other_family_or_group";
};
```

- [ ] **Step 1: Write failing API tests proving search is not page-1-limited**

Create more than one page of profiles and place the desired candidate beyond the first page. Query by its name and expect it returned.

- [ ] **Step 2: Add conflict-state tests**

Assert:
- current-family member is marked/excluded appropriately;
- profile owned by another family/group is returned with `membership: "other_family_or_group"` and is not silently reassigned by POST.

- [ ] **Step 3: Run API tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/event-families.test.ts
```

- [ ] **Step 4: Implement member-candidate endpoint**

Use server-side search against the complete dataset, not `/organizations?page=1` followed by frontend filtering.

- [ ] **Step 5: Write failing picker component tests**

Prove:
- typing updates search;
- results render city/state;
- other-family/group membership is visibly marked;
- available result can be selected;
- failed search shows retry without blanking the page.

- [ ] **Step 6: Implement `ProfileMemberPicker`**

Use debounced or submit-based server search with the existing `apiGet` helper. The component owns loading/error/query state and emits `onSelect(profileId)` only for explicitly selectable candidates.

- [ ] **Step 7: Replace the old `<select>` in `EventFamilyPage`**

Remove:

```ts
apiGet<any>("/organizations?page=1")
```

and all local `availableProfiles` filtering.

Render:
- **Add existing profile** with `ProfileMemberPicker`;
- **Create new event in this family** link to `/bookings/new?familyId=<id>`.

- [ ] **Step 8: Preserve existing remove-member behavior**

Keep DELETE membership-only semantics and existing confirmation copy.

- [ ] **Step 9: Run component/API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/event-families.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-families/profile-member-picker.test.tsx
```

- [ ] **Step 10: Commit**

```bash
git add artifacts/adventure-zone/src/components/event-families/profile-member-picker.tsx artifacts/adventure-zone/src/components/event-families/profile-member-picker.test.tsx artifacts/adventure-zone/src/pages/EventFamilyPage.tsx artifacts/api-server/src/routes/event-families.ts artifacts/api-server/src/routes/event-families.test.ts artifacts/api-server/src/features/organizations/organization-repository.ts
git commit -m "feat: add searchable event family members"
```

---

### Task 4: Make organization/location groups editable from their parent context

**Files:**
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/components/organizations/possible-locations-section.tsx`
- Modify: relevant organization/group API route under `artifacts/api-server/src/routes/organizations.ts`
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Create: `artifacts/adventure-zone/src/components/organizations/group-member-manager.tsx`
- Create: `artifacts/adventure-zone/src/components/organizations/group-member-manager.test.tsx`

**Interfaces:**
- Reuse Task 3 candidate-search response shape where practical; do not create a second incompatible profile-picker contract.
- Produce explicit unlink operation that removes group/location membership but preserves the child profile.

- [ ] **Step 1: Write failing tests for Water Lantern-style parent behavior**

Assert parent UI exposes:
- **Add existing profile/location**;
- **Create new event/location in this group**;
- existing linked child list;
- unlink action.

- [ ] **Step 2: Write failing repository/API unlink test**

After unlinking a child, assert the child organization/profile still exists with its contacts/history intact.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/group-member-manager.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts
```

- [ ] **Step 4: Implement `GroupMemberManager`**

Reuse `ProfileMemberPicker` or extract a shared base picker if needed. Avoid copying the full search implementation.

- [ ] **Step 5: Add explicit group membership endpoints/actions**

Support add/unlink with clear conflict responses if the child already belongs elsewhere.

- [ ] **Step 6: Wire create-new link with group preselection**

Use:

```text
/bookings/new?groupId=<parent-id>
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/group-member-manager.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/components/organizations/group-member-manager.tsx artifacts/adventure-zone/src/components/organizations/group-member-manager.test.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx artifacts/adventure-zone/src/components/organizations/possible-locations-section.tsx artifacts/api-server/src/routes/organizations.ts artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/features/organizations/organization-repository.test.ts
git commit -m "feat: manage grouped profile members"
```

---

### Task 5: Move Event Family Suggestions to a small bottom-of-page maintenance action

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-families/event-family-suggestions.tsx`
- Test: `artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx`

**Interfaces:**
- Consumes existing suggestions API/component behavior.
- Produces compact collapsed trigger such as **Review family suggestions** with optional count badge.

- [ ] **Step 1: Write failing layout test**

Assert the normal page order is:
1. Profiles header/filters/content;
2. family cards/directory;
3. compact suggestions control at the bottom.

Also assert the full suggestions panel is not expanded by default.

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage.test.tsx
```

- [ ] **Step 3: Convert suggestions to collapsed maintenance UI**

Keep existing review functionality but render only the small trigger initially. Expand inline or into a drawer/modal only after the user chooses it.

- [ ] **Step 4: Run test**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/pages/OrganizationsPage.tsx artifacts/adventure-zone/src/components/event-families/event-family-suggestions.tsx artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx
git commit -m "refactor: de-emphasize family suggestions"
```

---

### Task 6: Unify New Event and Add Lead into one progressive Add Event / Lead flow

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/BookingNewPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/bookings/booking-form.tsx`
- Create: `artifacts/adventure-zone/src/components/bookings/event-lead-match-picker.tsx`
- Create: `artifacts/adventure-zone/src/components/bookings/event-lead-match-picker.test.tsx`
- Modify: `artifacts/adventure-zone/src/actions/bookings.ts`
- Modify: corresponding booking/profile creation API route/service under `artifacts/api-server/src/features/bookings/` and `artifacts/api-server/src/routes/`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: any components/pages found by repository search for visible `New Event` or `Add Lead` entry links.
- Create or modify: `artifacts/adventure-zone/src/pages/BookingNewPage.test.tsx`
- Create or modify: booking creation API/service tests.

**Interfaces:**
- Query preselection:

```ts
type AddEventLeadContext = {
  familyId: string | null;
  groupId: string | null;
};
```

- Minimal creation input must support:

```ts
{
  name: string;
  familyId?: string | null;
  groupId?: string | null;
  city?: string | null;
  region?: string | null;
  address?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  source?: string | null;
  status?: string | null;
  travelLegId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  followUpAt?: string | null;
  followUpNote?: string | null;
}
```

- [ ] **Step 1: Inventory all creation entry points**

Run repository search for:

```text
"New Event"
"Add Lead"
"/bookings/new"
```

Document the exact files in the task commit message/body and update each user-facing entry to the same route/copy.

- [ ] **Step 2: Write failing page tests**

Prove:
- heading is `Add Event / Lead`;
- name alone can submit a minimal lead;
- blank optional fields do not block submit;
- `?familyId=...` and `?groupId=...` preselect context;
- advanced details are collapsed/optional initially.

- [ ] **Step 3: Write failing match-picker tests**

As the user enters a name, render likely existing matches before creation. Selecting a match should take the user to/reuse the existing profile rather than create another duplicate.

- [ ] **Step 4: Run frontend tests and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/BookingNewPage.test.tsx src/components/bookings/event-lead-match-picker.test.tsx
```

- [ ] **Step 5: Write failing backend creation tests**

Cover:
- name-only creation;
- optional fields `null`/blank normalization;
- successful family association in same logical operation;
- successful group association;
- association failure does not return a falsely grouped success.

- [ ] **Step 6: Implement progressive form sections**

Structure:
1. Identity — name + existing matches.
2. Relationship — Event Family/group.
3. Location/contact — optional.
4. Operational details — optional expandable section.

Keep existing booking-only requirements inside the booking-specific section instead of making them requirements for a basic lead.

- [ ] **Step 7: Implement `EventLeadMatchPicker`**

Use server-backed profile search and show enough context to avoid choosing the wrong similarly named event.

- [ ] **Step 8: Implement preselected family/group association**

Read URL params in `BookingNewPage`, pass them into the form, and submit them in the creation request.

- [ ] **Step 9: Normalize all entry points**

Every visible “New Event” / “Add Lead” action that creates the same record type should display **Add Event / Lead** and navigate to `/bookings/new` with optional context query params.

- [ ] **Step 10: Post-create navigation**

After successful creation, navigate to the new editable profile/event workspace, not a duplicate list entry. Preserve family/group context in the created record.

- [ ] **Step 11: Run frontend/backend tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/BookingNewPage.test.tsx src/components/bookings/event-lead-match-picker.test.tsx
pnpm --filter @workspace/api-server exec vitest run <exact-booking-creation-test-files-found-during-step-1>
```

Before committing, replace the angle-bracket command above in the working notes with the exact existing test file paths discovered in Step 1; do not commit a temporary workflow or script containing placeholders.

- [ ] **Step 12: Commit**

```bash
git add artifacts/adventure-zone/src/pages/BookingNewPage.tsx artifacts/adventure-zone/src/components/bookings/booking-form.tsx artifacts/adventure-zone/src/components/bookings/event-lead-match-picker.tsx artifacts/adventure-zone/src/components/bookings/event-lead-match-picker.test.tsx artifacts/adventure-zone/src/actions/bookings.ts artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/pages/BookingNewPage.test.tsx artifacts/api-server/src/features/bookings artifacts/api-server/src/routes
git commit -m "feat: unify event and lead creation"
```

---

### Task 7: Remove Source provenance from normal UI and add family/group context banners

**Files:**
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Modify: profile detail response shape in `artifacts/api-server/src/routes/event-profiles.ts`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts` if parent context is assembled there.
- Create or modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.test.tsx`

**Interfaces:**
- Consumes Task 2 `ProfileParentContext` concept.
- Produces compact context banner with parent link; provenance remains in backend storage but is not rendered.

- [ ] **Step 1: Write failing UI tests**

Assert:

```ts
expect(screen.queryByText(/Source provenance/i)).not.toBeInTheDocument();
expect(screen.getByText(/Part of Fourth of July/i)).toBeInTheDocument();
```

and equivalent `Location of Water Lantern Festival` case.

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-profiles/event-profile-workspace.test.tsx
```

- [ ] **Step 3: Add parent context to profile detail response**

Expose only user-facing relationship context needed for navigation; do not remove ACT provenance columns/data.

- [ ] **Step 4: Remove provenance presentation from workspace**

Delete/hide the normal Source provenance panel/row while leaving import/debug APIs untouched.

- [ ] **Step 5: Render family/group context banner**

Use a compact link near the profile identity section:

```tsx
<Link href={parentHref}>Part of {parentName}</Link>
```

or `Location of` for organization groups.

- [ ] **Step 6: Run test**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-profiles/event-profile-workspace.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.test.tsx artifacts/api-server/src/routes/event-profiles.ts artifacts/api-server/src/features/event-profiles/event-profile-repository.ts
git commit -m "refactor: simplify profile relationship context"
```

---

### Task 8: Move Possible Locations into a drawer/sheet

**Files:**
- Create: `artifacts/adventure-zone/src/components/organizations/possible-locations-drawer.tsx`
- Create: `artifacts/adventure-zone/src/components/organizations/possible-locations-drawer.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Reuse: `artifacts/adventure-zone/src/components/organizations/possible-locations-section.tsx`

**Interfaces:**
- Consumes existing Possible Locations data/actions unchanged.
- Produces trigger:

```tsx
<button type="button">Possible locations ({count})</button>
```

with drawer open/close state local to the profile workspace.

- [ ] **Step 1: Write failing drawer tests**

Prove:
- giant location list is absent while drawer closed;
- trigger shows count;
- clicking trigger reveals existing locations UI;
- close hides drawer without unmounting/resetting the surrounding profile page;
- drawer-local failure state does not blank the profile workspace.

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/possible-locations-drawer.test.tsx
```

- [ ] **Step 3: Implement responsive drawer/sheet wrapper**

Use existing dialog/sheet primitives if present in the repo. Desktop should behave as a right-side drawer; mobile should occupy most of the viewport. Do not add a new UI dependency solely for this drawer.

- [ ] **Step 4: Move `PossibleLocationsSection` into drawer body**

Keep all current add/edit/select behavior inside the drawer rather than rewriting location logic.

- [ ] **Step 5: Wire the compact trigger into profile workspace**

Remove the always-expanded location block from normal profile flow.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/possible-locations-drawer.test.tsx src/components/event-profiles/event-profile-workspace.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/organizations/possible-locations-drawer.tsx artifacts/adventure-zone/src/components/organizations/possible-locations-drawer.test.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx
git commit -m "feat: move possible locations into drawer"
```

---

### Task 9: Full integration regression and cleanup

**Files:**
- Modify only files required by failures discovered in this integration pass.
- Do not add permanent GitHub Actions workflows for one-off verification.

**Interfaces:**
- Consumes all prior tasks.
- Produces one coherent Profiles/Event Families UX with no duplicate creation paths or hidden broken filters.

- [ ] **Step 1: Run the full focused frontend suite**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/pages/OrganizationsPage.test.tsx \
  src/components/event-families/profile-member-picker.test.tsx \
  src/components/organizations/group-member-manager.test.tsx \
  src/pages/BookingNewPage.test.tsx \
  src/components/bookings/event-lead-match-picker.test.tsx \
  src/components/event-profiles/event-profile-workspace.test.tsx \
  src/components/organizations/possible-locations-drawer.test.tsx
```

- [ ] **Step 2: Run the focused API suite**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/organizations/organization-repository.test.ts \
  src/routes/event-families.test.ts
```

Also include the exact existing booking creation route/service test files discovered during Task 6.

- [ ] **Step 3: Run DB/API/frontend builds and type checks**

```bash
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

If the repository still contains unrelated pre-existing type errors, document the exact unrelated failures and separately run TypeScript/build checks scoped to all changed files/packages; do not mislabel unrelated baseline failures as regressions from this feature.

- [ ] **Step 4: Search for duplicate user-facing creation copy**

```bash
git grep -n -E 'New Event|Add Lead' -- artifacts/adventure-zone/src
```

Any remaining user-facing instance that creates the same event/lead record must be renamed/routed to **Add Event / Lead**. Historical docs/tests may retain old text where explicitly testing migration history.

- [ ] **Step 5: Verify no normal UI still renders Source provenance**

```bash
git grep -n -i 'Source provenance' -- artifacts/adventure-zone/src
```

Expected: no normal production UI match. Test fixtures/docs are acceptable only if intentionally asserting absence/history.

- [ ] **Step 6: Verify no family picker fetches only page 1**

```bash
git grep -n '/organizations?page=1' -- artifacts/adventure-zone/src/pages/EventFamilyPage.tsx artifacts/adventure-zone/src/components/event-families
```

Expected: no match.

- [ ] **Step 7: Inspect final diff for scope**

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Confirm no Calendar, Route Map, Leg Manager, finance, crew, or unrelated ACT importer files changed unless required by a shared navigation string and explicitly justified.

- [ ] **Step 8: Commit integration fixes if needed**

```bash
git add <only-files-changed-by-integration-fixes>
git commit -m "test: finalize profiles and event families ux"
```

Skip this commit if no changes were necessary.

- [ ] **Step 9: Open a draft PR**

PR title:

```text
feat: simplify profiles and event family workflows
```

PR body must summarize:
- reliable filters;
- hidden grouped members + contextual search;
- server-backed family/group membership;
- compact family suggestions;
- unified Add Event / Lead;
- provenance removal from normal UI;
- Possible Locations drawer;
- verification commands/results.

Do not merge without explicit user approval.
