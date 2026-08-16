# Profile and Event Family Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make notes obvious and fully editable on organization/place profiles, specific saved organization locations, and event families, while showing family notes read-only from member profiles and preserving notes through duplicate/location consolidation workflows.

**Architecture:** Keep organization/profile notes on the existing `activities` timeline because that system already owns organization-scoped notes, revisions, imported ACT provenance, and duplicate-merge re-parenting. Add one focused `scoped_notes` persistence model for the two ownership scopes the activity model does not represent cleanly: `organization_location` and `event_family`. Expose owner-scoped CRUD from the existing location and event-family routers, reuse one small frontend `ScopedNotes` component for editable location/family notes and read-only family context, and fetch family notes independently from the member profile so a family-note failure cannot break the profile page.

**Tech Stack:** TypeScript, React, Wouter, Express, Drizzle ORM, PostgreSQL, PGlite, Zod, Vitest, Testing Library, pnpm.

## Global Constraints

- Organization/profile manual notes remain `activities` with `kind = 'note'`; do not create duplicate profile-note records in `scoped_notes`.
- `scoped_notes` is only for `organization_location` and `event_family` ownership in this release.
- A scoped note belongs to exactly one owner; wrong-owner update/delete requests must not mutate the note.
- New scoped notes are local/manual records and are editable/deletable. Do not expose a client-controlled provenance/source field.
- Existing imported ACT activity/history behavior stays intact; this work must not make imported records more destructively editable than they are now.
- Family notes are stored once on the family and displayed read-only on member profiles; never copy them into each member profile.
- Location notes remain attached to the location row when an organization merge re-parents that location.
- Organization notes survive duplicate merges through the existing `activities.organization_id` re-parenting step.
- Failed save/delete operations keep the existing note list visible and show an inline error.
- Family-note fetch failures must not prevent the individual profile from loading.
- No rich text, attachments, reminders, AI rewriting, or global notes search in this release.

---

### Task 1: Add the scoped-note schema, migration, and repository contract

**Files:**
- Create: `lib/db/migrations/041_profile_family_notes.sql`
- Modify: `lib/db/src/event-family-schema.ts`
- Modify: `lib/db/src/migrations.ts`
- Create: `artifacts/api-server/src/features/notes/scoped-note-repository.ts`
- Create: `artifacts/api-server/src/features/notes/scoped-note-repository.test.ts`

**Interfaces:**
- Produces: `ScopedNoteOwner = { kind: "organization_location"; id: string } | { kind: "event_family"; id: string }`
- Produces: `ScopedNoteRecord = { id; body; ownerKind; ownerId; createdAt; updatedAt }`
- Produces: `ScopedNoteRepository.list(owner)`
- Produces: `ScopedNoteRepository.create(owner, body, now)`
- Produces: `ScopedNoteRepository.update(owner, noteId, body, now)`
- Produces: `ScopedNoteRepository.remove(owner, noteId)`
- Consumes: existing `organization_locations` and `event_families` rows as authoritative owners.

- [ ] **Step 1: Write failing repository/schema tests**

Create `scoped-note-repository.test.ts` with a minimal PGlite schema containing organizations, organization locations, event families, and the new migration. Cover both owner kinds, newest-first ordering, empty/wrong-owner rejection, and preservation when a location changes organizations.

```ts
it("does not let a family route edit a location note", async () => {
  const note = await repo.create({ kind: "organization_location", id: LOCATION_ID }, "Load from east gate", NOW);
  const result = await repo.update({ kind: "event_family", id: FAMILY_ID }, note.id, "wrong owner", LATER);
  expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
});

it("keeps a location note when the location moves to another organization", async () => {
  const note = await repo.create({ kind: "organization_location", id: LOCATION_ID }, "Use north lot", NOW);
  await db.update(organizationLocations).set({ organizationId: OTHER_ORG_ID }).where(eq(organizationLocations.id, LOCATION_ID));
  expect(await repo.list({ kind: "organization_location", id: LOCATION_ID })).toEqual([
    expect.objectContaining({ id: note.id, body: "Use north lot" }),
  ]);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/notes/scoped-note-repository.test.ts
```

Expected: FAIL because the migration/repository do not exist.

- [ ] **Step 3: Add migration 041 and register it for Render startup**

Use two nullable FKs with an exactly-one-owner check. Keep deletion restrictive so notes are never silently discarded by deleting an owner.

```sql
create table if not exists scoped_notes (
  id uuid primary key default gen_random_uuid(),
  organization_location_id uuid references organization_locations(id) on delete restrict,
  event_family_id uuid references event_families(id) on delete restrict,
  body text not null,
  source text not null default 'local',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scoped_notes_exactly_one_owner check (
    (organization_location_id is not null)::int +
    (event_family_id is not null)::int = 1
  ),
  constraint scoped_notes_body_nonblank check (nullif(trim(body), '') is not null),
  constraint scoped_notes_source_local check (source = 'local')
);
create index if not exists scoped_notes_location_created_idx
  on scoped_notes(organization_location_id, created_at desc)
  where organization_location_id is not null;
create index if not exists scoped_notes_family_created_idx
  on scoped_notes(event_family_id, created_at desc)
  where event_family_id is not null;
```

Register `041_profile_family_notes.sql` in `lib/db/src/migrations.ts` with:

```ts
{
  name: "041_profile_family_notes.sql",
  markerSql: "SELECT to_regclass(current_schema() || '.scoped_notes') IS NOT NULL AS ready",
},
```

- [ ] **Step 4: Add the Drizzle table and repository**

Define `scopedNotes` in `lib/db/src/event-family-schema.ts`, importing `organizationLocations` from `./schema`. The repository should translate the discriminated owner into the appropriate FK and verify the owner exists before create.

```ts
export type ScopedNoteOwner =
  | { kind: "organization_location"; id: string }
  | { kind: "event_family"; id: string };

export type ScopedNoteMutationResult =
  | { ok: true; note: ScopedNoteRecord }
  | { ok: false; code: "OWNER_NOT_FOUND" | "NOT_FOUND" };
```

For update/delete, include both `noteId` and the selected owner column in the SQL `where`; do not load by note ID and mutate without owner scoping.

- [ ] **Step 5: Run repository tests and database package build**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/notes/scoped-note-repository.test.ts
pnpm --filter @workspace/db build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations/041_profile_family_notes.sql lib/db/src/event-family-schema.ts lib/db/src/migrations.ts artifacts/api-server/src/features/notes/scoped-note-repository.ts artifacts/api-server/src/features/notes/scoped-note-repository.test.ts
git commit -m "feat: add scoped location and family notes storage"
```

---

### Task 2: Expose owner-scoped note CRUD on location and family APIs

**Files:**
- Modify: `artifacts/api-server/src/routes/organization-locations.ts`
- Modify: `artifacts/api-server/src/routes/event-families.ts`
- Create: `artifacts/api-server/src/features/notes/scoped-note-routes.test.ts`

**Interfaces:**
- Produces location endpoints:
  - `GET /organizations/:id/locations/:locationId/notes`
  - `POST /organizations/:id/locations/:locationId/notes`
  - `PATCH /organizations/:id/locations/:locationId/notes/:noteId`
  - `DELETE /organizations/:id/locations/:locationId/notes/:noteId`
- Produces family endpoints:
  - `GET /event-families/:id/notes`
  - `POST /event-families/:id/notes`
  - `PATCH /event-families/:id/notes/:noteId`
  - `DELETE /event-families/:id/notes/:noteId`
- Request body: `{ body: string }` for create/update.
- Response list: `{ notes: ScopedNoteRecord[] }`; mutation response: `{ ok: true, note }` or `{ ok: true }` for delete.

- [ ] **Step 1: Write failing API behavior tests**

Test successful create/list/update/delete for each owner kind plus these guards:
- empty note returns 400;
- missing owner returns 404;
- location ID that exists under another organization cannot be used through the wrong parent org;
- note ID owned by another location/family returns 404 and remains unchanged.

```ts
expect(await request(app)
  .patch(`/api/event-families/${FAMILY_ID}/notes/${LOCATION_NOTE_ID}`)
  .set(ownerAuth())
  .send({ body: "wrong scope" }))
  .toMatchObject({ status: 404 });
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/notes/scoped-note-routes.test.ts
```

Expected: FAIL because note routes do not exist.

- [ ] **Step 3: Add common validation and nested CRUD handlers**

Use one shared schema in the route modules:

```ts
const noteBodySchema = z.object({
  body: z.string().trim().min(1, "Add note text.").max(4000),
});
```

For location routes, first verify `locationRepo().findById(organizationId, locationId)` so a location cannot be addressed through the wrong parent organization. Then call `ScopedNoteRepository` with `{ kind: "organization_location", id: locationId }`.

For family routes, rely on the repository's owner existence check and map `OWNER_NOT_FOUND` to 404.

- [ ] **Step 4: Keep error responses specific and stable**

Map mutation outcomes as follows:

```ts
if (!result.ok && result.code === "OWNER_NOT_FOUND") {
  res.status(404).json({ ok: false, error: "Note owner not found" });
  return;
}
if (!result.ok && result.code === "NOT_FOUND") {
  res.status(404).json({ ok: false, error: "Note not found for this owner" });
  return;
}
```

Do not return a generic 500 for wrong-owner requests.

- [ ] **Step 5: Run route tests and API build**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/notes/scoped-note-routes.test.ts
pnpm --filter @workspace/api-server build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/organization-locations.ts artifacts/api-server/src/routes/event-families.ts artifacts/api-server/src/features/notes/scoped-note-routes.test.ts
git commit -m "feat: add location and event family note APIs"
```

---

### Task 3: Build one reusable scoped-notes frontend component and API actions

**Files:**
- Create: `artifacts/adventure-zone/src/features/notes/scoped-note-types.ts`
- Create: `artifacts/adventure-zone/src/actions/scoped-notes.ts`
- Create: `artifacts/adventure-zone/src/components/notes/scoped-notes.tsx`
- Create: `artifacts/adventure-zone/src/components/notes/scoped-notes.test.tsx`

**Interfaces:**
- Produces `ScopedNoteView = { id; body; createdAt; updatedAt }`.
- Produces `ScopedNotes` props:

```ts
type ScopedNotesProps = {
  title: string;
  notes: ScopedNoteView[];
  readOnly?: boolean;
  emptyText?: string;
  onCreate?: (body: string) => Promise<ScopedNoteView>;
  onUpdate?: (id: string, body: string) => Promise<ScopedNoteView>;
  onDelete?: (id: string) => Promise<void>;
  footer?: React.ReactNode;
};
```

- Produces API action helpers for location and family notes.

- [ ] **Step 1: Write failing component tests**

Cover:
- editable mode shows `Add note`, creates and prepends the returned note;
- edit changes only after successful mutation;
- failed delete leaves the note visible and shows the error;
- read-only mode displays notes but no Add/Edit/Delete controls;
- created and updated metadata are visible, with `Updated …` only when timestamps differ.

```tsx
render(<ScopedNotes title="Family notes" notes={[note]} readOnly />);
expect(screen.getByText("Shared booking advice")).toBeVisible();
expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/notes/scoped-notes.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add API actions**

Use existing `apiGet`, `apiPost`, `apiPatch`, `apiDelete`; do not use raw fetch in consumers.

```ts
export async function listFamilyNotes(familyId: string) {
  return (await apiGet<{ notes: ScopedNoteView[] }>(`/event-families/${familyId}/notes`)).notes;
}
export async function createFamilyNote(familyId: string, body: string) {
  return (await apiPost<{ note: ScopedNoteView }>(`/event-families/${familyId}/notes`, { body })).note;
}
```

Add equivalent location helpers with both `organizationId` and `locationId` in the path.

- [ ] **Step 4: Implement `ScopedNotes` with conservative mutation state**

Keep its displayed list in local state initialized from `notes`. Sort newest first. On delete, wait for `onDelete` to resolve before removing the note.

```ts
try {
  await onDelete?.(id);
  setItems((current) => current.filter((note) => note.id !== id));
} catch (error) {
  setMutationError(messageFrom(error));
}
```

Do the same for create/update: only commit the visible change after server success.

- [ ] **Step 5: Run component tests and frontend typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/notes/scoped-notes.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/features/notes/scoped-note-types.ts artifacts/adventure-zone/src/actions/scoped-notes.ts artifacts/adventure-zone/src/components/notes/scoped-notes.tsx artifacts/adventure-zone/src/components/notes/scoped-notes.test.tsx
git commit -m "feat: add reusable scoped notes UI"
```

---

### Task 4: Make organization/profile note creation explicit without duplicating the activity model

**Files:**
- Modify: `artifacts/adventure-zone/src/components/activities/activity-timeline.tsx`
- Modify: `artifacts/adventure-zone/src/components/activities/activity-timeline.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`

**Interfaces:**
- Extends `ActivityTimeline` with `noteComposer?: boolean`.
- Preserves existing `ActivityTimeline` behavior for all other call sites.
- Organization profile continues using `createActivityAction`, `editActivityAction`, `deleteActivityAction`, and `parent={{ organizationId: profile.id }}`.

- [ ] **Step 1: Add a failing `noteComposer` UI test**

```tsx
render(
  <ActivityTimeline
    activities={[]}
    parent={{ organizationId: ORG_ID }}
    noteComposer
    createActivity={createActivity}
    loadRevisions={loadRevisions}
  />,
);
fireEvent.click(screen.getByRole("button", { name: "Add note" }));
expect(screen.queryByLabelText("Activity type")).not.toBeInTheDocument();
fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Call in January" } });
fireEvent.click(screen.getByRole("button", { name: "Save note" }));
await waitFor(() => expect(createActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: "note", body: "Call in January" })));
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/activities/activity-timeline.test.tsx
```

Expected: FAIL because `noteComposer` is not supported.

- [ ] **Step 3: Add note-focused labels while preserving the full timeline**

When `noteComposer` is true:
- force creation kind to `note`;
- hide the activity-kind selector;
- show `Add note` / `Cancel note`;
- label textarea `Note`;
- save as `Save note`;
- use `No notes or call history recorded.` as the empty state.

Do **not** filter existing activities out of the timeline: calls/imported history should still be visible in the existing `Notes & call outcomes` card.

- [ ] **Step 4: Enable note mode on the event profile workspace**

Change only the profile timeline call:

```tsx
<ActivityTimeline
  noteComposer
  activities={...}
  parent={{ organizationId: profile.id }}
  createActivity={createActivityAction}
  editActivity={editActivityAction}
  deleteActivity={deleteActivityAction}
  ...
/>
```

The current activity repository already blocks deletion of imported activities with `sourceRecordId`; do not weaken that guard.

- [ ] **Step 5: Run tests and frontend build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/activities/activity-timeline.test.tsx
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/activities/activity-timeline.tsx artifacts/adventure-zone/src/components/activities/activity-timeline.test.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx
git commit -m "feat: make profile note entry explicit"
```

---

### Task 5: Add location notes inside each expanded location card

**Files:**
- Modify: `artifacts/adventure-zone/src/components/organizations/location-card.tsx`
- Create: `artifacts/adventure-zone/src/components/organizations/location-card.test.tsx`
- Modify: `artifacts/api-server/src/features/organization-locations/location-repository.ts`
- Modify: `artifacts/api-server/src/features/organization-locations/location-repository.pglite.test.ts`

**Interfaces:**
- Consumes location note API helpers from Task 3.
- Produces an editable `Location notes` section inside the expanded location card.
- Extends `DrizzleLocationRepository.remove()` dependency detection so a location with scoped notes returns `has_dependents` instead of hitting an FK error.

- [ ] **Step 1: Write failing location-card UI tests**

Mock location detail plus note helpers. Assert notes are not fetched while collapsed, are fetched on first expand, and editable `Location notes` appears inside that location.

```tsx
fireEvent.click(screen.getByRole("button", { name: /Main Stage/ }));
expect(await screen.findByRole("heading", { name: "Location notes" })).toBeVisible();
expect(listLocationNotes).toHaveBeenCalledWith(ORG_ID, LOCATION_ID);
```

Also cover an independent note-load error: address/contacts/bookings detail still renders with a small retry/error state for notes.

- [ ] **Step 2: Add a failing location deletion dependency test**

Extend the PGlite setup to apply migration 041, insert a note on a location with no other dependents, then expect:

```ts
expect(await repo.remove(ORG_A, LOC_2)).toBe("has_dependents");
```

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/location-card.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/organization-locations/location-repository.pglite.test.ts
```

Expected: UI test fails because no location notes UI exists; repository test fails because scoped notes are not counted as dependents.

- [ ] **Step 4: Integrate `ScopedNotes` into `LocationCard`**

Maintain independent note state:

```ts
const [locationNotes, setLocationNotes] = useState<ScopedNoteView[]>([]);
const [notesError, setNotesError] = useState<string | null>(null);
```

On first expansion, load detail and notes independently (or with `Promise.allSettled`) so note failure does not set `detailError`. Render:

```tsx
<ScopedNotes
  title="Location notes"
  notes={locationNotes}
  onCreate={(body) => createLocationNote(orgId, location.id, body)}
  onUpdate={(noteId, body) => updateLocationNote(orgId, location.id, noteId, body)}
  onDelete={(noteId) => deleteLocationNote(orgId, location.id, noteId)}
/>
```

- [ ] **Step 5: Count scoped notes as location dependents**

Import `scopedNotes` and add a sixth count query:

```ts
this.database
  .select({ value: count() })
  .from(scopedNotes)
  .where(eq(scopedNotes.organizationLocationId, locationId))
```

Include it in `hasDependents`. Keep the existing API's friendly 409 copy.

- [ ] **Step 6: Run focused tests and builds**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/location-card.test.tsx src/components/organizations/possible-locations-drawer.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/organization-locations/location-repository.pglite.test.ts
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/organizations/location-card.tsx artifacts/adventure-zone/src/components/organizations/location-card.test.tsx artifacts/api-server/src/features/organization-locations/location-repository.ts artifacts/api-server/src/features/organization-locations/location-repository.pglite.test.ts
git commit -m "feat: add notes to organization locations"
```

---

### Task 6: Add editable family notes on the event-family page

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/EventFamilyPage.test.tsx`

**Interfaces:**
- Consumes: `listFamilyNotes`, `createFamilyNote`, `updateFamilyNote`, `deleteFamilyNote`.
- Produces: editable `Family notes` card on `/event-families/:familyId`.
- Family detail/member management remains usable if note loading fails.

- [ ] **Step 1: Write failing family-page tests**

Cover:
- family page loads family detail and notes;
- Family notes renders before/near members;
- create/edit/delete calls the family-scoped helpers;
- notes endpoint failure renders a local retry/error message while member profiles and add-member controls remain visible.

```tsx
expect(await screen.findByText("Fourth of July")).toBeVisible();
expect(screen.getByText("Miles City Celebration")).toBeVisible();
expect(screen.getByRole("alert")).toHaveTextContent("Could not load family notes");
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventFamilyPage.test.tsx
```

Expected: FAIL because the family page does not load/render notes.

- [ ] **Step 3: Add independent note-loading state**

Do not fold note failure into the page-wide `error` that currently replaces the family when loading fails. Use:

```ts
const [familyNotes, setFamilyNotes] = useState<ScopedNoteView[]>([]);
const [familyNotesError, setFamilyNotesError] = useState<string | null>(null);
async function loadNotes() { ... }
```

Call `load()` and `loadNotes()` independently when `familyId` changes.

- [ ] **Step 4: Render editable Family notes**

```tsx
<section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
  <ScopedNotes
    title="Family notes"
    notes={familyNotes}
    onCreate={(body) => createFamilyNote(family.id, body)}
    onUpdate={(noteId, body) => updateFamilyNote(family.id, noteId, body)}
    onDelete={(noteId) => deleteFamilyNote(family.id, noteId)}
  />
</section>
```

If initial fetch failed, show `Retry family notes` without blocking the family/member UI.

- [ ] **Step 5: Run tests and frontend build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventFamilyPage.test.tsx
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/pages/EventFamilyPage.tsx artifacts/adventure-zone/src/pages/EventFamilyPage.test.tsx
git commit -m "feat: add editable event family notes"
```

---

### Task 7: Show family notes read-only on member profiles with failure isolation

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/features/event-profiles/event-profile-repository.ts` only if a typed prop/model addition is needed; do not add copied note storage.

**Interfaces:**
- `EventProfilePage` consumes `profile.familyContext` already returned by `/event-profiles/:id`.
- When `familyContext.kind === "event_family"`, it independently calls `listFamilyNotes(familyContext.id)`.
- `EventProfileWorkspace` receives `familyNotes`, `familyNotesError`, and an optional retry callback.
- Produces a read-only `Family notes — <family name>` card linking to `/event-families/:familyId`.

- [ ] **Step 1: Add failing member-profile tests**

Extend `EventProfilePage.test.tsx` with a family-linked profile:

```ts
const familyProfile = {
  ...profile,
  familyContext: { kind: "event_family", id: FAMILY_ID, name: "Fourth of July" },
};
```

Cover:
- family notes render on the profile;
- no Add/Edit/Delete controls exist in that card;
- family note text does not get added to `profile.notes` / the local activity timeline;
- link points to the family page;
- failed family-note request still renders the profile, contacts, call buttons, and profile notes plus a retry state.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfilePage.test.tsx
```

Expected: FAIL because member profiles do not fetch family notes.

- [ ] **Step 3: Fetch family notes after the profile resolves**

Keep this separate from the primary profile request:

```ts
if (normalized.familyContext?.kind === "event_family") {
  void listFamilyNotes(normalized.familyContext.id)
    .then(setFamilyNotes)
    .catch(() => setFamilyNotesError("Could not load family notes."));
}
```

Reset family-note state when `profileId`/family changes. Provide a retry function that only re-fetches family notes.

- [ ] **Step 4: Render read-only shared context beside profile notes**

In `EventProfileWorkspace`, near the `Notes & call outcomes` card:

```tsx
{profile.familyContext?.kind === "event_family" ? (
  <ScopedNotes
    title={`Family notes — ${profile.familyContext.name}`}
    notes={familyNotes}
    readOnly
    footer={<Link href={`/event-families/${profile.familyContext.id}`}>Open event family</Link>}
  />
) : null}
```

If `familyNotesError` exists, render a small local error/retry box in the same card area instead of failing the workspace.

- [ ] **Step 5: Run tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventProfilePage.test.tsx src/components/notes/scoped-notes.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx artifacts/adventure-zone/src/features/event-profiles/event-profile-repository.ts
git commit -m "feat: show family notes on member profiles"
```

---

### Task 8: Lock down merge preservation and run release verification

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-merge-location-order.test.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-repository.test.ts` if needed for local/imported guard regression
- Modify: `artifacts/api-server/src/features/notes/scoped-note-repository.test.ts`
- No production-file change expected unless a regression reveals one.

**Interfaces:**
- Preserves: duplicate merge re-parents `activities.organizationId` before deleting the duplicate.
- Preserves: location notes by stable `organization_location_id` while the location's `organization_id` changes.
- Preserves: imported activity deletion protection.

- [ ] **Step 1: Add explicit organization-note merge regression**

Extend the existing source-order regression to require the activity move to occur before duplicate deletion:

```ts
const activityMove = mergeSource.indexOf(".where(eq(activities.organizationId, dupId))");
const organizationDelete = mergeSource.indexOf("tx.delete(organizations)");
expect(activityMove).toBeGreaterThanOrEqual(0);
expect(activityMove).toBeLessThan(organizationDelete);
```

This test documents why existing organization/profile notes do not need a second persistence table.

- [ ] **Step 2: Keep location-note re-parent regression in the repository test**

Ensure Task 1's test still verifies a `scoped_notes.organization_location_id` remains valid and visible after changing `organization_locations.organization_id`.

- [ ] **Step 3: Add/retain imported-activity protection regression**

If existing coverage does not already assert it, add a repository test showing an activity with `sourceRecordId` cannot be deleted and is left untouched.

- [ ] **Step 4: Run the complete focused notes suite**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/notes/scoped-note-repository.test.ts \
  src/features/notes/scoped-note-routes.test.ts \
  src/features/organization-locations/location-repository.pglite.test.ts \
  src/features/organizations/organization-merge-location-order.test.ts \
  src/features/activities/activity-repository.test.ts

pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/activities/activity-timeline.test.tsx \
  src/components/notes/scoped-notes.test.tsx \
  src/components/organizations/location-card.test.tsx \
  src/components/organizations/possible-locations-drawer.test.tsx \
  src/pages/EventFamilyPage.test.tsx \
  src/pages/EventProfilePage.test.tsx
```

Expected: all PASS.

- [ ] **Step 5: Run production verification**

```bash
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all PASS.

- [ ] **Step 6: Inspect the final diff against the approved spec**

Verify all of the following before opening/merging a PR:
- profile has an obvious Add note flow and existing note/call history remains present;
- profile manual notes still use activities, not `scoped_notes`;
- each location has editable Location notes inside its own expanded card;
- family page has editable Family notes;
- member profile has read-only family notes and a family link;
- family-note failure does not fail the member profile;
- failed note deletion leaves the visible note intact;
- location deletion with notes returns a controlled dependency conflict;
- organization/location note preservation tests pass;
- no rich text/attachments/reminders/AI/global-search scope slipped in.

- [ ] **Step 7: Commit any final regression-only changes**

```bash
git add artifacts/api-server/src/features/organizations/organization-merge-location-order.test.ts artifacts/api-server/src/features/activities/activity-repository.test.ts artifacts/api-server/src/features/notes/scoped-note-repository.test.ts
git commit -m "test: lock down note preservation behavior"
```

---

## Completion Criteria

Implementation is complete only when:

1. A user can add, edit, and delete a manual organization/profile note from the profile workspace.
2. A user can add, edit, and delete a note scoped to one saved organization location.
3. A user can add, edit, and delete a family-level note from the event-family page.
4. A family member profile shows the same family notes read-only without copying them into the profile activity list.
5. Organization notes survive duplicate organization merges.
6. Location notes survive location re-parenting during duplicate/consolidation workflows.
7. Wrong-owner note mutations are rejected without data loss.
8. Protected imported activity/history behavior is unchanged.
9. Note mutation failures do not silently remove or overwrite visible notes.
10. Focused tests, typechecks, database build, API build, and frontend build all pass.
