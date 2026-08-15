# Leg Manager Portal Crew and Event Aftermath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared seasonal-worker directory, local-worker reuse, work history, rehire warnings, post-event review tasks, 0–5 star event ratings, and incident tracking to the manager portal.

**Architecture:** Crew identity is shared company-wide, while work-history entries and manager notes keep their originating leg/event attribution. “Do Not Rehire” is visible guidance, never an API-level hiring lock. Event reviews are append-only historical entries attached to the canonical booking/event; averages are derived from review rows. Incidents are separate records with their own attachments and can be queued offline using the Release 1 sync system.

**Tech Stack:** TypeScript, Express, Drizzle/PostgreSQL, React, Vitest, Testing Library, existing manager offline queue/blob queue.

## Global Constraints

- No payroll or wage calculations.
- Workers do not receive portal accounts.
- All leg managers may view the shared worker directory and historical feedback.
- A manager may add/edit work history and notes created by their own leg; owner/admin may edit all.
- Worker location is searchable for future route staffing.
- Rehire status is `rehirable`, `undecided`, or `do_not_rehire` and does not block hiring.
- Event rating range is integer 0–5 inclusive.
- Reviews preserve each historical rating/note; do not overwrite one global score.
- Incidents remain separate from general event reviews.
- Post-event review becomes due only after the canonical event end date, falling back to start date when no end date exists.

---

### Task 1: Add shared crew schema and work-history model

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/007_leg_crew.sql`
- Create: `artifacts/api-server/src/features/leg-manager/crew-types.ts`
- Create: `artifacts/api-server/src/features/leg-manager/crew-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/crew-repository.test.ts`

**Interfaces:**
- Tables: `crew_workers`, `crew_work_history`, `crew_manager_notes`.
- Worker fields: name, phone/contact, city, region, location text, rehire status.
- Work history links worker + leg + optional booking/trip, role, dates, rating/note.

- [ ] **Step 1: Write failing shared-visibility/edit-scope tests**

Seed a worker created through Leg A and assert Leg B can read the worker/history but cannot modify Leg A's history entry.

```ts
expect(await listWorkersForManager(legB)).toContainEqual(expect.objectContaining({ id: workerId }));
expect(await updateWorkHistoryAsManager(legB, legAHistoryId, {})).toEqual({ ok: false, code: "FORBIDDEN" });
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts
```

- [ ] **Step 3: Add schema and repository**

Use normalized phone where available to reduce accidental duplicates. Do not automatically merge workers solely on name; return possible matches to the UI for confirmation.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts
git add lib/db/src/schema/index.ts lib/db/migrations/007_leg_crew.sql artifacts/api-server/src/features/leg-manager/crew-types.ts artifacts/api-server/src/features/leg-manager/crew-repository.ts artifacts/api-server/src/features/leg-manager/crew-repository.test.ts
git commit -m "feat: add shared seasonal crew directory"
```

---

### Task 2: Add manager/admin crew APIs and location search

**Files:**
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Create: `artifacts/api-server/src/features/leg-manager/crew-search.ts`
- Create: `artifacts/api-server/src/features/leg-manager/crew-search.test.ts`

**Interfaces:**
- Manager: `GET /manager/crew?query=&city=&region=`
- Manager: `POST /manager/crew`
- Manager: `POST /manager/crew/:workerId/work-history`
- Manager: `POST /manager/crew/:workerId/notes`
- Manager: `PATCH /manager/crew/:workerId/rehire-status`
- Owner: unrestricted crew edit endpoints under `/manager-admin/crew`.

- [ ] **Step 1: Write failing location-search tests**

Assert a manager querying an upcoming event city/region gets exact-area workers first, then broader regional matches, while preserving rehire warning and prior work summary.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-search.test.ts
```

- [ ] **Step 3: Implement search ranking**

Rank by exact city+region, same region, then text/contact matches. Do not hide `do_not_rehire`; include it visibly in results.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-search.test.ts src/features/leg-manager/crew-repository.test.ts
git add artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/features/leg-manager/crew-search.ts artifacts/api-server/src/features/leg-manager/crew-search.test.ts
git commit -m "feat: add crew lookup and work history APIs"
```

---

### Task 3: Build the mobile Crew directory and worker profile

**Files:**
- Create: `artifacts/adventure-zone/src/pages/ManagerCrewPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerWorkerPage.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/worker-form.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/rehire-status.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerCrewPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`

**Interfaces:**
- Consumes crew APIs from Task 2.
- Uses manager offline queue for manager-created notes/history/status updates.

- [ ] **Step 1: Write failing UI tests**

Test city/region search, visible Do Not Rehire warning, work history display, adding a worker, and adding an event-specific history entry.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerCrewPage.test.tsx
```

- [ ] **Step 3: Implement manager crew screens**

Make the upcoming-route location shortcut prominent: “Find workers near [next event city].” Show status, previous legs/events, manager rating/note, and contact info.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerCrewPage.test.tsx
git add artifacts/adventure-zone/src/pages/ManagerCrewPage.tsx artifacts/adventure-zone/src/pages/ManagerWorkerPage.tsx artifacts/adventure-zone/src/components/manager/worker-form.tsx artifacts/adventure-zone/src/components/manager/rehire-status.tsx artifacts/adventure-zone/src/pages/ManagerCrewPage.test.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/manager/manager-shell.tsx
git commit -m "feat: add manager crew directory"
```

---

### Task 4: Add event review schema and post-event due classification

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/008_event_manager_reviews.sql`
- Create: `artifacts/api-server/src/features/leg-manager/event-review-service.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-review-service.test.ts`

**Interfaces:**
- Table `event_manager_reviews`: bookingId, legId, rating 0–5, written feedback, organizer/site notes, crew notes, recommendReturn, clientMutationId, createdAt/updatedAt.
- Produces `isEventReviewDue(booking, now): boolean` using `endsAt ?? startsAt` and America/Chicago business-day semantics consistent with Today.

- [ ] **Step 1: Write failing review timing/rating tests**

Cover future event, event ending today, day after event, multi-day end date, missing end date, and invalid -1/6 ratings.

```ts
expect(isEventReviewDue({ startsAt, endsAt: todayEnd }, now)).toBe(false);
expect(isEventReviewDue({ startsAt: yesterday, endsAt: yesterday }, now)).toBe(true);
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-review-service.test.ts
```

- [ ] **Step 3: Add schema + service**

Add DB check `rating between 0 and 5`. Review create is idempotent by `clientMutationId`; historical reviews remain separate rows.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-review-service.test.ts
git add lib/db/src/schema/index.ts lib/db/migrations/008_event_manager_reviews.sql artifacts/api-server/src/features/leg-manager/event-review-service.ts artifacts/api-server/src/features/leg-manager/event-review-service.test.ts
git commit -m "feat: add post event manager reviews"
```

---

### Task 5: Expose review tasks to manager and event/profile history to admin

**Files:**
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-review-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-review-repository.test.ts`
- Create: `artifacts/adventure-zone/src/pages/ManagerEventReviewPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerEventReviewPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`

**Interfaces:**
- Manager: `GET /manager/reviews/due`.
- Manager: `POST /manager/reviews`.
- Event profile response adds review history and derived average.

- [ ] **Step 1: Write failing API tests**

Assert manager sees only due reviews for their leg and cannot review another leg's booking. Assert two historical reviews yield average without losing either row.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-review-repository.test.ts
```

- [ ] **Step 3: Implement manager review UI**

Fields: 0–5 stars, feedback, organizer/site notes, crew notes, recommend return yes/no/unsure, optional attachments. Home shows count like “2 events still need reviews.”

- [ ] **Step 4: Add admin event/profile history presentation**

Show average rating plus each review’s date, leg, rating, and notes. Do not collapse history into one editable rating.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-review-repository.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerEventReviewPage.test.tsx
git add artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/event-profiles.ts artifacts/api-server/src/features/leg-manager/event-review-repository.ts artifacts/api-server/src/features/leg-manager/event-review-repository.test.ts artifacts/adventure-zone/src/pages/ManagerEventReviewPage.tsx artifacts/adventure-zone/src/pages/ManagerEventReviewPage.test.tsx artifacts/adventure-zone/src/pages/ManagerHomePage.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx
git commit -m "feat: add event aftermath review workflow"
```

---

### Task 6: Add incident records and attachments

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/009_leg_incidents.sql`
- Create: `artifacts/api-server/src/features/leg-manager/incident-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/incident-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Create: `artifacts/adventure-zone/src/pages/ManagerIncidentPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerIncidentsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerIncidentPage.test.tsx`

**Interfaces:**
- Incident fields: type, occurredAt, booking/trip/location context, peopleInvolved, description, actionTaken, followUpNeeded, clientMutationId, revision.
- Uses existing manager blob queue for attachments.

- [ ] **Step 1: Write failing scope/idempotency tests**

Assert duplicate offline retry creates one incident, Leg A cannot link to Leg B booking, and owner can read all.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/incident-repository.test.ts
```

- [ ] **Step 3: Implement incident API + mobile form**

Do not bury incident fields in review JSON. Incident can optionally link to an event review but remains independently queryable.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/incident-repository.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerIncidentPage.test.tsx
git add lib/db/src/schema/index.ts lib/db/migrations/009_leg_incidents.sql artifacts/api-server/src/features/leg-manager/incident-repository.ts artifacts/api-server/src/features/leg-manager/incident-repository.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/adventure-zone/src/pages/ManagerIncidentPage.tsx artifacts/adventure-zone/src/pages/ManagerIncidentsPage.tsx artifacts/adventure-zone/src/pages/ManagerIncidentPage.test.tsx
git commit -m "feat: add leg incident tracking"
```

---

### Task 7: Add owner crew/review/incident administration views

**Files:**
- Create: `artifacts/adventure-zone/src/pages/ManagerCrewAdminPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`

**Interfaces:**
- Owner can filter by leg, trip, event, worker, review status, incident follow-up state, and archived legs.

- [ ] **Step 1: Write failing admin-view tests**

Assert archived leg history remains visible through the deliberate archived filter and owner can open worker/review/incident records across legs.

- [ ] **Step 2: Implement admin views and run tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerAftermathAdminPage.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/adventure-zone/src/pages/ManagerCrewAdminPage.tsx artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.tsx artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.test.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/pages/RoutesPage.tsx
git commit -m "feat: add admin crew and aftermath views"
```

---

### Task 8: Release 3 verification

- [ ] **Step 1: Run crew/review/incident API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/crew-repository.test.ts src/features/leg-manager/crew-search.test.ts src/features/leg-manager/event-review-service.test.ts src/features/leg-manager/event-review-repository.test.ts src/features/leg-manager/incident-repository.test.ts
```

- [ ] **Step 2: Run manager/admin UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerCrewPage.test.tsx src/pages/ManagerEventReviewPage.test.tsx src/pages/ManagerIncidentPage.test.tsx src/pages/ManagerAftermathAdminPage.test.tsx
```

- [ ] **Step 3: Run typechecks/builds**

```bash
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```
As in prior releases, disclose unrelated baseline API typecheck errors instead of masking them; run a scoped config only to prove new manager files when necessary.

- [ ] **Step 4: Run end-to-end permission/history smoke case**

Use Leg A to add a local worker and review an ended event; use Leg B to find that worker by area and read the prior history; confirm Leg B cannot edit Leg A's history. Add an incident offline on Leg A, reconnect, verify one incident row and attachment, and verify owner sees it in the admin aftermath view.
