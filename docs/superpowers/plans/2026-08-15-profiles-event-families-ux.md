# Profiles & Event Families UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Profiles a clean top-level directory with reliable filters, editable family/group membership, one Add Event / Lead flow, and a less cluttered profile detail experience.

**Architecture:** Keep existing profile, Event Family, booking, location, ACT provenance, and history data models intact. Normalize the Profiles query contract, add server-backed membership search and parent context, reuse existing grouping/location semantics, and move bulky secondary UI into drawers. Use TDD for each behavior change and keep Calendar/Routes/Leg Manager out of scope.

**Tech Stack:** React, TypeScript, Wouter, Express, Drizzle ORM/PostgreSQL, Zod, Vitest, Testing Library, existing API helpers/UI primitives.

## Global Constraints

- Profiles shows standalone profiles, Event Family cards, and organization/group parents by default.
- Individual family/group members are hidden by default and revealed by **Show family/group members**.
- Search can surface hidden members, but must show their parent context.
- Profile-type UI values must match backend/stored values exactly.
- Event Family member search must search the whole dataset server-side.
- Membership changes must never delete underlying profiles/history.
- “New Event” and “Add Lead” become **Add Event / Lead** and route to one flow.
- Name is the only required field for a minimal new lead.
- Source provenance stays stored but is removed from normal profile UI.
- Possible Locations moves into a drawer/sheet.
- No automatic merge or silent reassignment between families/groups.

---

### Task 1: Normalize Profiles filters

**Files:**
- Modify: `artifacts/adventure-zone/src/features/organizations/last-resort-input.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Test: `artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx`
- Create/modify: `artifacts/api-server/src/features/organizations/organization-repository.test.ts`

**Produces:** `OrganizationListQuery` with `showMembers: boolean` and exact profile-type values.

- [ ] Write failing frontend tests proving `type=festival_event`, `region`, `leg`, phone/email, follow-up/booking, possible-locations, Last Resort, page/pageSize, and `showMembers=yes` survive URL parsing and submission together.
- [ ] Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage.test.tsx` and confirm RED.
- [ ] Write failing API/repository tests for combined filters and exact type values.
- [ ] Run: `pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-repository.test.ts` and confirm RED.
- [ ] Extend the query schema/transform to include `showMembers` and ensure `OrganizationsPage.loadProfiles()` forwards every supported filter, including pageSize.
- [ ] Replace invented `type=event` with actual stored/API values, using friendly labels only for display.
- [ ] Add **Show family/group members** checkbox using `showMembers=yes` and preserve it in pagination links.
- [ ] Run both focused test files and confirm PASS.
- [ ] Commit: `git commit -m "fix: make profile filters reliable"`.

---

### Task 2: Hide grouped members by default and show contextual search matches

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Test: `artifacts/api-server/src/features/organizations/organization-repository.test.ts`
- Test: `artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx`

**Produces:**
```ts
type ProfileParentContext =
  | { kind: "event_family"; id: string; name: string }
  | { kind: "organization_group"; id: string; name: string }
  | null;
```

- [ ] Write failing repository tests with standalone, Event Family member, organization child, and parent records.
- [ ] Assert default list excludes grouped children, while `showMembers=true` includes them.
- [ ] Add failing search test proving a hidden child can be returned with `parentContext` when its name/contact/location matches.
- [ ] Run repository test and confirm RED.
- [ ] Implement default member hiding without deleting/retiring data; make search the explicit exception.
- [ ] Return `parentContext` in matching records.
- [ ] Render “Part of …” or “Location of …” beneath contextual search results and keep the underlying editable profile link.
- [ ] Ensure result counts reflect visible filtered results.
- [ ] Run API + frontend tests and confirm PASS.
- [ ] Commit: `git commit -m "feat: make grouped profiles contextual"`.

---

### Task 3: Replace the Event Family page-1 picker with server-backed search

**Files:**
- Create: `artifacts/adventure-zone/src/components/event-families/profile-member-picker.tsx`
- Create: `artifacts/adventure-zone/src/components/event-families/profile-member-picker.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx`
- Modify: `artifacts/api-server/src/routes/event-families.ts`
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Create: `artifacts/api-server/src/routes/event-families.test.ts`

**Produces API:** `GET /event-families/:familyId/member-candidates?q=&page=1&pageSize=20`

Candidate shape:
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

- [ ] Write failing API test with the desired profile beyond the first Profiles page and prove query search still finds it.
- [ ] Add tests for current-family and other-family/group membership states; POST must not silently reassign another owner’s member.
- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/routes/event-families.test.ts` and confirm RED.
- [ ] Implement server-backed member-candidate search over the full dataset.
- [ ] Write failing picker UI tests for search, city/state context, membership warning, selection, loading, and retry.
- [ ] Implement `ProfileMemberPicker` using `apiGet` and explicit selectable states.
- [ ] Remove `apiGet("/organizations?page=1")` and local `availableProfiles` filtering from `EventFamilyPage`.
- [ ] Render **Add existing profile** and **Create new event in this family** linking to `/bookings/new?familyId=<familyId>`.
- [ ] Preserve current remove-member behavior as unlink-only.
- [ ] Run component/API tests and confirm PASS.
- [ ] Commit: `git commit -m "feat: add searchable event family members"`.

---

### Task 4: Add equivalent member management to organization/location groups

**Files:**
- Create: `artifacts/adventure-zone/src/components/organizations/group-member-manager.tsx`
- Create: `artifacts/adventure-zone/src/components/organizations/group-member-manager.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Test: `artifacts/api-server/src/features/organizations/organization-repository.test.ts`

- [ ] Write failing UI test for a Water Lantern-style parent exposing **Add existing profile/location**, **Create new event/location in this group**, child list, and unlink.
- [ ] Write failing API/repository test proving unlink preserves child profile, contacts, and history.
- [ ] Run focused UI/API tests and confirm RED.
- [ ] Reuse the Task 3 search/picker contract where practical rather than creating a second incompatible picker.
- [ ] Add explicit add/unlink group membership endpoints with conflict responses for children already owned elsewhere.
- [ ] Link **Create new event/location in this group** to `/bookings/new?groupId=<parentId>`.
- [ ] Run tests and confirm PASS.
- [ ] Commit: `git commit -m "feat: manage grouped profile members"`.

---

### Task 5: Move Event Family Suggestions to the bottom as a maintenance action

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-families/event-family-suggestions.tsx`
- Test: `artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx`

- [ ] Write failing page-order test asserting normal Profiles content comes before a compact **Review family suggestions** control.
- [ ] Assert full suggestions UI is collapsed by default.
- [ ] Run OrganizationsPage test and confirm RED.
- [ ] Convert suggestions to a small bottom-page trigger with optional count badge; expand only on click.
- [ ] Run test and confirm PASS.
- [ ] Commit: `git commit -m "refactor: de-emphasize family suggestions"`.

---

### Task 6: Unify New Event and Add Lead into one progressive Add Event / Lead flow

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/BookingNewPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/bookings/booking-form.tsx`
- Create: `artifacts/adventure-zone/src/components/bookings/event-lead-match-picker.tsx`
- Create: `artifacts/adventure-zone/src/components/bookings/event-lead-match-picker.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/BookingNewPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/actions/bookings.ts`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/api-server/src/routes/bookings.ts`
- Create: `artifacts/api-server/src/routes/bookings.test.ts`

**Minimal creation input:**
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

- [ ] Search production frontend for `New Event`, `Add Lead`, and `/bookings/new`; record every user-facing entry point in the implementation notes.
- [ ] Write failing `BookingNewPage` tests proving heading is **Add Event / Lead**, name alone submits, optional fields may be blank, advanced details are optional, and family/group query params preselect context.
- [ ] Write failing `EventLeadMatchPicker` test proving likely existing matches appear before creation and choosing one reuses/navigates to the existing profile.
- [ ] Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/BookingNewPage.test.tsx src/components/bookings/event-lead-match-picker.test.tsx` and confirm RED.
- [ ] Write failing `artifacts/api-server/src/routes/bookings.test.ts` covering name-only creation, blank normalization, family association, group association, and truthful failure when association cannot be completed.
- [ ] Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/bookings.test.ts` and confirm RED.
- [ ] Reshape the form into progressive sections: Identity; Relationship/grouping; Location/contact; optional Operational details.
- [ ] Implement early server-backed match suggestions.
- [ ] Read `familyId`/`groupId` from URL and include them in the same logical creation operation.
- [ ] Change every equivalent user-facing creation action to **Add Event / Lead** and route it to `/bookings/new`.
- [ ] On success, navigate to the new editable profile/event workspace and preserve family/group context.
- [ ] Run frontend/API tests and confirm PASS.
- [ ] Commit: `git commit -m "feat: unify event and lead creation"`.

---

### Task 7: Remove Source provenance from normal profile UI and add relationship context

**Files:**
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Create/modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.test.tsx`
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Modify if needed: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`

- [ ] Write failing test asserting **Source provenance** is absent from normal UI.
- [ ] Add failing cases for “Part of Fourth of July” and “Location of Water Lantern Festival” parent context links.
- [ ] Run workspace test and confirm RED.
- [ ] Add user-facing parent context to profile detail response without removing provenance/import data from storage.
- [ ] Remove provenance presentation from `event-profile-workspace.tsx`.
- [ ] Render compact parent relationship banner/link near profile identity.
- [ ] Run test and confirm PASS.
- [ ] Commit: `git commit -m "refactor: simplify profile relationship context"`.

---

### Task 8: Move Possible Locations into a drawer/sheet

**Files:**
- Create: `artifacts/adventure-zone/src/components/organizations/possible-locations-drawer.tsx`
- Create: `artifacts/adventure-zone/src/components/organizations/possible-locations-drawer.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Reuse: `artifacts/adventure-zone/src/components/organizations/possible-locations-section.tsx`

- [ ] Write failing tests proving the full locations list is hidden while closed, trigger shows count, open reveals the existing locations UI, close returns to the same profile, and drawer failure does not blank the page.
- [ ] Run drawer test and confirm RED.
- [ ] Implement responsive wrapper using existing dialog/sheet primitives: right-side drawer on desktop, near-full-screen sheet on mobile.
- [ ] Put existing `PossibleLocationsSection` inside the drawer rather than duplicating location logic.
- [ ] Replace the always-expanded block with **Possible locations (N)** trigger.
- [ ] Run drawer + profile workspace tests and confirm PASS.
- [ ] Commit: `git commit -m "feat: move possible locations into drawer"`.

---

### Task 9: Integration verification and PR

**Files:** Only modify product/test files required by regressions found here. Do not add permanent one-off workflows.

- [ ] Run focused frontend suite:
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
- [ ] Run focused API suite:
```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/organizations/organization-repository.test.ts \
  src/routes/event-families.test.ts \
  src/routes/bookings.test.ts
```
- [ ] Run builds/checks:
```bash
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```
- [ ] Verify duplicate creation copy is gone from production UI:
```bash
git grep -n -E 'New Event|Add Lead' -- artifacts/adventure-zone/src
```
Any remaining production action creating the same record must become **Add Event / Lead**.
- [ ] Verify normal UI no longer renders provenance:
```bash
git grep -n -i 'Source provenance' -- artifacts/adventure-zone/src
```
- [ ] Verify Event Family UI no longer fetches only page 1:
```bash
git grep -n '/organizations?page=1' -- artifacts/adventure-zone/src/pages/EventFamilyPage.tsx artifacts/adventure-zone/src/components/event-families
```
- [ ] Inspect scope with `git diff --stat main...HEAD` and `git diff --name-only main...HEAD`; confirm unrelated Calendar/Routes/Leg Manager files are absent.
- [ ] If integration fixes were needed, commit only those files with `git commit -m "test: finalize profiles and event families ux"`.
- [ ] Open a **draft** PR titled `feat: simplify profiles and event family workflows` summarizing filters, contextual members, family/group management, unified creation, provenance cleanup, locations drawer, and verification results.
- [ ] Do **not** merge without explicit user approval.
