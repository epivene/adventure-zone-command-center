# Profile Archive and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users archive unwanted event profiles from normal CRM workflows and later restore the exact same profile without affecting linked contacts, bookings, notes, history, or relationships.

**Architecture:** Add nullable `archived_at` lifecycle state to organizations only, wrap archive/restore in a profile lifecycle repository/service with audit entries, and make all active-profile query boundaries explicitly exclude archived organizations. Add a minimal Archived records page plus an Archive profile action on profile detail.

**Tech Stack:** PostgreSQL migrations, Drizzle ORM, TypeScript, Express, Zod, React, Wouter, Vitest, Testing Library, PGlite, existing audit/auth helpers.

## Global Constraints

- Archive only the profile/organization row; linked contacts and bookings remain active.
- Archiving does not delete or archive notes, ACT history, activities, event-family membership, organization relationships, or other linked data.
- Archived profiles disappear from Profiles lists/search, caller/profile matching, Today/profile-driven results, profile selection for new bookings, event-family/group assignment selectors, and other normal profile pickers.
- Active contacts/bookings may still display an archived parent with an `Archived` indicator rather than losing the relationship.
- Restore clears `archived_at` on the same organization row and never creates duplicate contacts, bookings, activities, or relationships.
- Archive/restore is authenticated, transactional, audited, and idempotent.
- Stale client requests must not be able to assign an archived profile to new bookings or groups.
- After successful archive from profile detail, redirect to `/archived`.
- Tests must be observed failing before production implementation.

---

### Task 1: Add organization archive state and lifecycle repository

**Files:**
- Create: `lib/db/migrations/044_profile_archiving.sql` (use the next available migration number if main has advanced)
- Modify: `lib/db/src/migrations.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/src/features/record-lifecycle/profile-lifecycle-repository.ts`
- Create: `artifacts/api-server/src/features/record-lifecycle/profile-lifecycle-service.ts`
- Create: `artifacts/api-server/src/features/record-lifecycle/profile-lifecycle.pglite.test.ts`

**Interfaces:**
- Produces:
```ts
export type ProfileArchiveState = {
  id: string;
  archivedAt: Date | null;
};

export interface ProfileLifecycleService {
  archive(profileId: string, actorId: string | null): Promise<ProfileArchiveState>;
  restore(profileId: string, actorId: string | null): Promise<ProfileArchiveState>;
  listArchived(): Promise<Array<{
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    archivedAt: Date;
  }>>;
}
```

- [ ] **Step 1: Write failing PGlite lifecycle test**

Seed one organization, one linked contact, one linked booking, activity associations/history, event-family membership, and organization relationship. Assert:
```ts
const archived = await service.archive(profileId, "user-1");
expect(archived.archivedAt).not.toBeNull();
```
Then assert only `organizations.archived_at` changed; all linked row IDs still exist.

Restore and assert the same organization row is active again and all linked IDs remain exactly once.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/record-lifecycle/profile-lifecycle.pglite.test.ts
```
Expected: FAIL because schema/service do not exist.

- [ ] **Step 3: Add migration/schema field**

Migration:
```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS organizations_archived_at_idx ON organizations (archived_at);
```
Register it after the latest existing migration and add nullable Drizzle timestamp `archivedAt` to `organizations`.

- [ ] **Step 4: Implement archive/restore transactions**

Archive:
1. lock the organization row
2. return stable `PROFILE_NOT_FOUND` when absent
3. if already archived, return current state without changing linked rows
4. set `archived_at = now()`
5. write an audit entry describing profile archive

Restore mirrors the above and sets `archived_at = null`.

`listArchived()` returns only archived organizations ordered newest archived first, then name.

- [ ] **Step 5: Run GREEN + migration idempotency**

Run the focused test. Apply migrations twice to fresh PGlite and assert no failure.

- [ ] **Step 6: Commit**

```bash
git add lib/db artifacts/api-server/src/features/record-lifecycle
git commit -m "feat: add profile archive lifecycle"
```

---

### Task 2: Exclude archived profiles from active profile workflows

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`
- Modify: `artifacts/api-server/src/features/caller-finder/caller-finder-service.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`
- Modify relevant profile picker/search services used by booking creation and event-family/group assignment
- Create: `artifacts/api-server/src/features/record-lifecycle/profile-active-query-boundaries.pglite.test.ts`

**Interfaces:**
- Consumes: `organizations.archivedAt`
- Produces active-only profile search/detail/picker results.

- [ ] **Step 1: Write failing active-query boundary test**

Seed one active and one archived organization with contacts/bookings. Assert archived organization is absent from:
```ts
listOrganizations/searchOrganizations
getEventProfile active lookup
caller/profile matching
Today profile-driven rows
booking/event profile selectors
event-family/group selectors
```
Assert linked contacts/bookings themselves remain queryable and active.

- [ ] **Step 2: Run RED**

Run the new focused PGlite/service test plus existing organization/caller/Today tests. Expected: archived profile leaks into at least one active workflow.

- [ ] **Step 3: Add explicit active predicates**

At each active profile boundary add the equivalent of:
```ts
isNull(organizations.archivedAt)
```
Do not filter contacts/bookings solely because their linked organization is archived unless the query is specifically selecting profiles.

For active contact/booking displays that join an archived parent, expose enough state to render an `Archived` indicator instead of dropping the parent relationship.

- [ ] **Step 4: Run GREEN**

Run the focused boundary test and existing caller/Today/profile repository suites. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/organizations artifacts/api-server/src/features/event-profiles artifacts/api-server/src/features/caller-finder artifacts/api-server/src/features/follow-ups artifacts/api-server/src/features/record-lifecycle/profile-active-query-boundaries.pglite.test.ts
git commit -m "feat: hide archived profiles from active workflows"
```

---

### Task 3: Reject stale writes targeting archived profiles

**Files:**
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Modify booking creation/update routes/services that accept `organizationId`
- Modify event-family/group membership write routes/services
- Create: `artifacts/api-server/src/features/record-lifecycle/profile-archived-write-guard.test.ts`

**Interfaces:**
- Produces stable conflict error code/message for archived-target writes, e.g.:
```ts
{ ok: false, error: "That profile is archived. Restore it before using it." }
```
with HTTP `409`.

- [ ] **Step 1: Write failing stale-client tests**

Seed an archived organization and directly POST its ID through:
- new booking/event profile selection path
- event-family/group assignment path

Assert both return 409 even though the client bypasses UI filtering.

- [ ] **Step 2: Run RED**

Run focused route/service tests. Expected: requests currently accept archived IDs.

- [ ] **Step 3: Add shared active-profile assertion**

Create or reuse a helper with exact contract:
```ts
export async function assertActiveProfile(database, profileId: string): Promise<void>;
```
It must distinguish missing from archived if route copy requires different messages, but never mutate state.

Call it inside the same transaction as each write before inserting membership/booking rows.

- [ ] **Step 4: Run GREEN**

Run focused stale-client tests plus existing booking/family route tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes artifacts/api-server/src/features/record-lifecycle artifacts/api-server/src/features/event-families artifacts/api-server/src/features/bookings
git commit -m "fix: reject writes to archived profiles"
```

---

### Task 4: Add authenticated archive/restore API

**Files:**
- Create: `artifacts/api-server/src/routes/profile-lifecycle.ts`
- Create: `artifacts/api-server/src/routes/profile-lifecycle.test.ts`
- Modify: `artifacts/api-server/src/app.ts`

**Interfaces:**
- Produces:
```http
GET  /profile-lifecycle/archived
POST /profile-lifecycle/:id/archive
POST /profile-lifecycle/:id/restore
```
Responses:
```ts
{ ok: true, profile: ProfileArchiveState }
{ ok: true, profiles: ArchivedProfileSummary[] }
{ ok: false, error: string }
```

- [ ] **Step 1: Write failing API tests**

Assert:
- unauthenticated requests follow existing auth rejection behavior
- invalid UUID => 400
- missing profile => 404
- archive success => `archivedAt` populated
- repeat archive => 200/idempotent
- restore success => `archivedAt: null`
- repeat restore => 200/idempotent

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/profile-lifecycle.test.ts
```
Expected: FAIL with 404 routes.

- [ ] **Step 3: Implement routes**

Use existing request logger/auth pattern and the lifecycle service from Task 1. Do not expose database internals or linked records in mutation responses.

- [ ] **Step 4: Run GREEN**

Run route tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/profile-lifecycle.ts artifacts/api-server/src/routes/profile-lifecycle.test.ts artifacts/api-server/src/app.ts
git commit -m "feat: add profile archive API"
```

---

### Task 5: Add Archived records page and client actions

**Files:**
- Create: `artifacts/adventure-zone/src/actions/profile-lifecycle.ts`
- Create: `artifacts/adventure-zone/src/features/record-lifecycle/profile-lifecycle-types.ts`
- Create: `artifacts/adventure-zone/src/pages/ArchivedRecordsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ArchivedRecordsPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: navigation/settings component that owns admin menu links

**Interfaces:**
- Produces web route `/archived`
- Client actions:
```ts
export function getArchivedProfiles(): Promise<ArchivedProfileSummary[]>;
export function archiveProfile(profileId: string): Promise<ProfileArchiveState>;
export function restoreProfile(profileId: string): Promise<ProfileArchiveState>;
```

- [ ] **Step 1: Write failing page tests**

Assert page:
- renders archived profile name + city/state + archived date
- has `Restore` button
- asks confirmation `Restore this profile to normal lists and searches?`
- removes restored card after successful restore
- preserves card and shows inline error on failure
- shows useful empty state when none archived

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ArchivedRecordsPage.test.tsx
```
Expected: FAIL because page/actions do not exist.

- [ ] **Step 3: Implement client actions/page/navigation**

Use one-column mobile-first cards. Keep the page profile-only; do not add contact/booking archive sections in this scope.

- [ ] **Step 4: Run GREEN**

Run page test plus `App.admin-navigation.test.ts` or the repo's current navigation test. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/actions/profile-lifecycle.ts artifacts/adventure-zone/src/features/record-lifecycle artifacts/adventure-zone/src/pages/ArchivedRecordsPage.tsx artifacts/adventure-zone/src/pages/ArchivedRecordsPage.test.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation
git commit -m "feat: add archived profile workspace"
```

---

### Task 6: Add Archive profile control to profile detail

**Files:**
- Create: `artifacts/adventure-zone/src/components/record-lifecycle/archive-profile-button.tsx`
- Create: `artifacts/adventure-zone/src/components/record-lifecycle/archive-profile-button.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx`

**Interfaces:**
- Consumes: `archiveProfile(profileId)`
- On success: navigate to `/archived`.

- [ ] **Step 1: Write failing shared-control test**

Assert button label `Archive profile` and exact confirmation:
```text
Archive this profile? It will disappear from Profiles, search, caller matching, Today, and normal event selection. Its contacts, bookings, notes, history, and relationships will stay intact.
```
Assert cancel does nothing, success navigates to `/archived`, and API failure stays on the profile with inline error.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/record-lifecycle/archive-profile-button.test.tsx
```
Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement and integrate**

Place beside Edit in the profile detail header/action menu, using existing destructive secondary styling and mobile tap sizing. Disable while submitting.

- [ ] **Step 4: Run GREEN + profile page regression**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/record-lifecycle/archive-profile-button.test.tsx \
  src/pages/EventProfilePage.test.tsx \
  src/pages/ArchivedRecordsPage.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/record-lifecycle artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx
git commit -m "feat: add profile archive control"
```

---

### Task 7: Final cross-feature verification and permanent CI

**Files:**
- Modify only tests/workflow files required to make archive coverage permanent.
- Prefer existing `.github/workflows/calendar-route-handoff-ci.yml` ACT/CRM gate rather than a temporary workflow.

**Interfaces:**
- Verifies the full archive/restore contract.

- [ ] **Step 1: Run focused API suites**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/record-lifecycle \
  src/routes/profile-lifecycle.test.ts \
  src/features/organizations \
  src/features/event-profiles \
  src/features/caller-finder \
  src/features/follow-ups
```
Expected: PASS.

- [ ] **Step 2: Run focused frontend suites**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/pages/ArchivedRecordsPage.test.tsx \
  src/components/record-lifecycle/archive-profile-button.test.tsx \
  src/pages/EventProfilePage.test.tsx \
  src/App.admin-navigation.test.ts
```
Expected: PASS.

- [ ] **Step 3: Run builds/typechecks**

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```
Expected: exit 0 except only already-documented repository-wide informational errors if the permanent workflow marks them non-blocking.

- [ ] **Step 4: Verify data invariants in PGlite test**

After archive + restore, assert exact original IDs remain for:
- organization
- organization-contact relationships
- bookings
- activity associations/history
- event-family membership

Assert no duplicate count increases.

- [ ] **Step 5: Ensure permanent CI includes lifecycle tests**

Add focused lifecycle/page tests to the existing permanent workflow if broad directory execution does not already cover them. Do not create a temporary implementation-only workflow.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/calendar-route-handoff-ci.yml artifacts/api-server artifacts/adventure-zone
git commit -m "test: gate profile archive and restore"
```
