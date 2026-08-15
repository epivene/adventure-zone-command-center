# Leg Manager Portal Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the secure, mobile-first, offline-capable leg-manager portal foundation using existing travel legs, trips, bookings, and routes as the source of truth.

**Architecture:** Remove the current nine-leg constraints first, then add a leg-scoped password/session model beside the existing owner auth. Mount manager API routes before owner-only middleware and require a dedicated `requireLegManagerMiddleware` on every manager endpoint. The first offline mutation type is a schedule/route issue, proving the IndexedDB queue, idempotency, conflict/version behavior, and admin review flow before financial data is added.

**Tech Stack:** TypeScript, Express, Drizzle/PostgreSQL, React, Wouter, Vitest, Testing Library, IndexedDB, service worker, Node `crypto.scrypt` and HMAC.

## Global Constraints

- One manager per leg; no individual employee accounts.
- Manager routes are server-scoped to one leg; UI filtering is not security.
- Admin/owner auth remains separate and retains master access.
- Archived legs are preserved; their manager access is disabled immediately.
- First-time manager login requires internet.
- Official bookings/calendar/routes are read-only to managers.
- Offline changes are queued, visible as Saved offline / Syncing / Synced / Needs attention, and never silently discarded.
- Schedule conflict reporting replaces direct manager schedule edits.
- No hard-coded maximum of nine travel legs remains.

---

### Task 1: Remove the nine-leg product/database limit and make archive the normal lifecycle

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/003_unlimited_travel_legs.sql`
- Modify: `artifacts/api-server/src/features/routes/travel-leg-editor.ts`
- Modify: `artifacts/api-server/src/routes/routes-map.ts`
- Modify: `artifacts/api-server/src/features/routes/travel-leg-editor.test.ts`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Test: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx`

**Interfaces:**
- Produces: `TravelLegService.addLeg(): Promise<Result<TravelLeg, never>>` with no `LEG_LIMIT_REACHED` branch.
- Preserves: `archiveLeg(id)`, `restoreLeg(id)`, `listTravelLegs({ includeArchived })`.

- [ ] **Step 1: Add failing service/database tests for more than nine legs**

Add a service test that seeds nine rows and expects `addLeg()` to create the tenth. Add a migration-level assertion that `travel_legs_sort_order_between_1_and_9` no longer exists.

```ts
it("adds a tenth active leg", async () => {
  const repo = createTravelLegRepositoryWith(9);
  const result = await new TravelLegService(repo).addLeg();
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.sortOrder).toBe(10);
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:
```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/travel-leg-editor.test.ts
```
Expected: the tenth-leg assertion fails because `LEG_LIMIT_REACHED` is returned.

- [ ] **Step 3: Remove the schema check and service/API limit**

Delete the schema check:
```ts
check(
  "travel_legs_sort_order_between_1_and_9",
  sql`${table.sortOrder} between 1 and 9`,
),
```

Migration:
```sql
alter table travel_legs
  drop constraint if exists travel_legs_sort_order_between_1_and_9;
```

Remove `TravelLegAddError`, the `current.length >= 9` guard, and the max-nine API copy. Return the inserted leg normally.

- [ ] **Step 4: Change the leg editor UX to Active + View Archived**

Remove copy saying “between 1 and 9.” Keep archived rows out of the default editor list and add an explicit `View Archived` toggle/button that reveals read-only archived cards with Restore. Remove the normal Delete action from the UI so archive is the supported lifecycle.

- [ ] **Step 5: Run focused API/UI tests**

Run:
```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/travel-leg-editor.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```
Expected: PASS, including a tenth-leg case and archived visibility toggle.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/index.ts lib/db/migrations/003_unlimited_travel_legs.sql artifacts/api-server/src/features/routes/travel-leg-editor.ts artifacts/api-server/src/routes/routes-map.ts artifacts/api-server/src/features/routes/travel-leg-editor.test.ts artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx
git commit -m "feat: make travel legs unlimited and archiveable"
```

---

### Task 2: Add leg-manager credential and session-version storage

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/004_leg_manager_access.sql`
- Create: `artifacts/api-server/src/features/leg-manager/leg-manager-auth.ts`
- Create: `artifacts/api-server/src/features/leg-manager/leg-manager-auth.test.ts`

**Interfaces:**
- Produces: `hashLegManagerPassword(password): Promise<{ hash: string; salt: string }>`
- Produces: `verifyLegManagerPassword(password, hash, salt): Promise<boolean>`
- Produces: `issueLegManagerToken(input: { legId: string; sessionVersion: number }): { token: string; expiresAt: string } | null`
- Produces: `verifyLegManagerToken(token): LegManagerTokenClaims | null`

- [ ] **Step 1: Write failing password/token tests**

Test password hashing, incorrect-password rejection, leg ID/session version preservation, tamper rejection, and expiry.

```ts
expect(await verifyLegManagerPassword("correct", hash, salt)).toBe(true);
expect(await verifyLegManagerPassword("wrong", hash, salt)).toBe(false);
expect(verifyLegManagerToken(token)).toMatchObject({ legId, sessionVersion: 3 });
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-auth.test.ts
```
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add the access table**

Schema shape:
```ts
export const legManagerAccess = pgTable("leg_manager_access", {
  legId: uuid("leg_id").primaryKey().references(() => travelLegs.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  sessionVersion: integer("session_version").default(1).notNull(),
  managerName: text("manager_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Use Node `crypto.scrypt` with a random salt for the password. Do not introduce a plaintext password column.

- [ ] **Step 4: Implement signed leg tokens**

Token payload format:
```ts
`leg.${legId}.${sessionVersion}.${expiresAtMs}.${signature}`
```
Use the existing `SESSION_SECRET`; sign the payload with HMAC-SHA256. Keep the same ~30-day TTL as owner sessions unless a later product decision changes it.

- [ ] **Step 5: Run auth tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-auth.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/index.ts lib/db/migrations/004_leg_manager_access.sql artifacts/api-server/src/features/leg-manager/leg-manager-auth.ts artifacts/api-server/src/features/leg-manager/leg-manager-auth.test.ts
git commit -m "feat: add leg manager password sessions"
```

---

### Task 3: Enforce leg-scoped authorization and admin password controls

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/leg-manager-middleware.ts`
- Create: `artifacts/api-server/src/features/leg-manager/leg-manager-middleware.test.ts`
- Create: `artifacts/api-server/src/routes/leg-manager-auth.ts`
- Create: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- Produces Express augmentation `req.legManager = { legId: string; managerName: string | null }`.
- Produces `requireLegManagerMiddleware`.
- Public: `POST /manager/auth/login` with `{ legId, password }`.
- Manager: `GET /manager/auth/me`.
- Owner: `PUT /manager-admin/legs/:legId/access` with `{ password, managerName? }`.
- Owner: `POST /manager-admin/legs/:legId/sign-out-all`.

- [ ] **Step 1: Add failing authorization tests**

Cover valid token, wrong leg, archived leg, stale session version, changed password, and sign-out-all.

```ts
expect(await authorize(tokenForLegA)).toMatchObject({ legId: legA });
await archiveLeg(legA);
expect(await authorize(tokenForLegA)).toBeNull();
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-middleware.test.ts
```

- [ ] **Step 3: Implement repository + middleware**

Every manager request must load `legManagerAccess` joined to `travelLegs`, require `archivedAt IS NULL`, and require token `sessionVersion === stored sessionVersion`.

- [ ] **Step 4: Mount auth routes in the correct order**

Update `routes/index.ts` so public manager login is mounted before `requireOwnerMiddleware`, while `/manager-admin/*` remains behind owner middleware and `/manager/*` data routes use manager middleware internally.

- [ ] **Step 5: Implement reset/sign-out semantics**

Changing the password updates hash/salt and increments `sessionVersion`. Sign Out All Devices increments `sessionVersion` without changing the password.

- [ ] **Step 6: Run auth/API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-auth.test.ts src/features/leg-manager/leg-manager-middleware.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager artifacts/api-server/src/routes/leg-manager-auth.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: enforce leg manager scoped access"
```

---

### Task 4: Add the manager portal shell and separate manager sign-in

**Files:**
- Create: `artifacts/adventure-zone/src/lib/manager-auth-context.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerSignInPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerSignInPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- Produces `ManagerAuthProvider` with `signIn(legId,password)`, `signOut()`, `manager`, and `managerApi()`.
- Routes: `/manager/sign-in`, `/manager`, `/manager/*`.

- [ ] **Step 1: Write failing sign-in/routing tests**

Test that owner login still goes to `/today`, manager login goes to `/manager`, and a manager token never unlocks owner routes.

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerSignInPage.test.tsx
```

- [ ] **Step 3: Implement a separate manager auth context**

Store manager bearer token under a different storage key than owner auth. `managerApi()` always sends that token and never falls back to owner auth.

- [ ] **Step 4: Build the mobile manager shell**

Bottom navigation starts with Home, Events/Route, Money, Receipts, Crew, More. Only Home and Events/Route need real content in Release 1; later destinations may route to a simple “coming in next release” page only if needed to avoid dead links, otherwise hide them until implemented.

- [ ] **Step 5: Run UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerSignInPage.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/lib/manager-auth-context.tsx artifacts/adventure-zone/src/components/manager artifacts/adventure-zone/src/pages/ManagerSignInPage.tsx artifacts/adventure-zone/src/pages/ManagerHomePage.tsx artifacts/adventure-zone/src/pages/ManagerSignInPage.test.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add leg manager portal shell"
```

---

### Task 5: Build read-only manager route/calendar data from existing trips and bookings

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/leg-manager-dashboard.ts`
- Create: `artifacts/api-server/src/features/leg-manager/leg-manager-dashboard.test.ts`
- Create: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Test: `artifacts/adventure-zone/src/pages/ManagerRoutePage.test.tsx`

**Interfaces:**
- Manager: `GET /manager/dashboard`.
- Manager: `GET /manager/route`.
- Response references existing trip/booking IDs; no copied event rows.

- [ ] **Step 1: Write failing leg-scope data tests**

Seed Leg A and Leg B trips/bookings and assert a Leg A token returns only A.

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-dashboard.test.ts
```

- [ ] **Step 3: Implement route/dashboard query**

Use existing `trips`, `tripStops`, `bookings`, and `tripSegments`. Return the current/next trip, ordered stops, segment mileage estimates, next event, and recent/next schedule window for the authenticated leg.

- [ ] **Step 4: Render the mobile Home + Events/Route screens**

Show next event, destination, event dates, route segment, sync state, and a prominent Report Schedule/Route Issue action. Do not expose schedule edit controls.

- [ ] **Step 5: Run API/UI tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-dashboard.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerRoutePage.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/leg-manager-dashboard.ts artifacts/api-server/src/features/leg-manager/leg-manager-dashboard.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/pages/ManagerHomePage.tsx artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx artifacts/adventure-zone/src/pages/ManagerRoutePage.test.tsx
git commit -m "feat: show leg scoped route and event schedule"
```

---

### Task 6: Add schedule/route issue reporting with admin review

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/005_leg_schedule_issues.sql`
- Create: `artifacts/api-server/src/features/leg-manager/schedule-issue-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/schedule-issue-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Create: `artifacts/adventure-zone/src/components/manager/report-schedule-issue.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerIssuesAdminPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- `leg_schedule_issues`: `id`, `legId`, optional `bookingId`/`tripId`, `kind`, `notes`, `status`, `clientMutationId`, timestamps, `resolvedAt`, `resolutionNote`.
- Manager: `POST /manager/issues`.
- Owner: `GET /manager-admin/issues?status=open`.
- Owner: `POST /manager-admin/issues/:id/resolve`.

- [ ] **Step 1: Write failing idempotency/scope tests**

Post the same `clientMutationId` twice and assert one row is created. Attempt to attach a Leg A manager report to a Leg B booking and expect 403/validation rejection.

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/schedule-issue-repository.test.ts
```

- [ ] **Step 3: Implement schema/repository/routes**

Supported kinds are `wrong_datetime`, `wrong_location`, `wrong_leg`, `route_problem`, `event_details_changed`, `other`.

- [ ] **Step 4: Add manager form + owner review page**

Manager can submit notes and optional booking/trip context. Owner can mark resolved and record a resolution note; schedule correction itself still happens through existing admin booking/route tools.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/schedule-issue-repository.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/report-schedule-issue.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/index.ts lib/db/migrations/005_leg_schedule_issues.sql artifacts/api-server/src/features/leg-manager/schedule-issue-repository.ts artifacts/api-server/src/features/leg-manager/schedule-issue-repository.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/adventure-zone/src/components/manager/report-schedule-issue.tsx artifacts/adventure-zone/src/pages/ManagerIssuesAdminPage.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add manager schedule issue workflow"
```

---

### Task 7: Add IndexedDB offline queue, service worker, and sync states

**Files:**
- Create: `artifacts/adventure-zone/src/lib/manager-offline-db.ts`
- Create: `artifacts/adventure-zone/src/lib/manager-sync-queue.ts`
- Create: `artifacts/adventure-zone/src/lib/manager-sync-queue.test.ts`
- Create: `artifacts/adventure-zone/src/components/manager/manager-sync-status.tsx`
- Create: `artifacts/adventure-zone/public/sw.js`
- Modify: `artifacts/adventure-zone/src/components/connectivity/offline-banner.tsx`
- Modify: `artifacts/adventure-zone/src/components/manager/report-schedule-issue.tsx`

**Interfaces:**
- `queueManagerMutation({ id, method, path, body, createdAt })`.
- `flushManagerMutationQueue(managerApi)`.
- Mutation state: `saved_offline | syncing | synced | needs_attention`.

- [ ] **Step 1: Write failing queue tests**

Test enqueue while offline, FIFO replay, retry without duplication, 409 conflict becoming `needs_attention`, and manager sign-out clearing leg-private cached data.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/manager-sync-queue.test.ts
```

- [ ] **Step 3: Implement IndexedDB queue**

Keep queued JSON mutations and cached route/dashboard data scoped by `legId`. Do not store manager plaintext passwords.

- [ ] **Step 4: Add service worker shell caching**

Cache the portal app shell/static assets only. API responses containing private leg data stay in IndexedDB controlled by the app instead of a shared HTTP cache.

- [ ] **Step 5: Wire route issue submit into the queue**

Online submits may still flow through the same queue so every mutation gets the same idempotency behavior. On reconnect, flush and show status.

- [ ] **Step 6: Run queue/UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/manager-sync-queue.test.ts src/components/manager/report-schedule-issue.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/lib/manager-offline-db.ts artifacts/adventure-zone/src/lib/manager-sync-queue.ts artifacts/adventure-zone/src/lib/manager-sync-queue.test.ts artifacts/adventure-zone/src/components/manager/manager-sync-status.tsx artifacts/adventure-zone/public/sw.js artifacts/adventure-zone/src/components/connectivity/offline-banner.tsx artifacts/adventure-zone/src/components/manager/report-schedule-issue.tsx
git commit -m "feat: add offline manager sync queue"
```

---

### Task 8: Add owner manager-access controls to the existing leg administration UI

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/leg-manager-access.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/leg-manager-access.test.tsx`

**Interfaces:**
- Consumes owner endpoints from Task 3.
- Produces Change Password, Manager Name, Sign Out All Devices, Portal Enabled/Disabled state.

- [ ] **Step 1: Write failing owner-control tests**

Assert archived legs show portal disabled, changing password does not reveal stored password, and Sign Out All Devices requires confirmation.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/leg-manager-access.test.tsx
```

- [ ] **Step 3: Implement the admin access card**

Show status only; never return password hash/salt to the browser. Password fields are write-only.

- [ ] **Step 4: Run UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/leg-manager-access.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/pages/RoutesPage.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx artifacts/adventure-zone/src/components/routes/leg-manager-access.tsx artifacts/adventure-zone/src/components/routes/leg-manager-access.test.tsx
git commit -m "feat: add leg manager access controls"
```

---

### Task 9: Release 1 verification

**Files:** none unless verification reveals defects.

- [ ] **Step 1: Run focused API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/travel-leg-editor.test.ts src/features/leg-manager
```
Expected: all pass.

- [ ] **Step 2: Run focused web tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerSignInPage.test.tsx src/pages/ManagerRoutePage.test.tsx src/lib/manager-sync-queue.test.ts src/components/routes/leg-manager-access.test.tsx
```
Expected: all pass.

- [ ] **Step 3: Run typechecks**

```bash
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server typecheck
```
If the API workspace still has known unrelated baseline errors, record those exact errors and run a scoped `tsconfig.manager.json` including all new/modified manager files; do not claim full API typecheck passes unless it actually does.

- [ ] **Step 4: Build both artifacts**

```bash
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```
Expected: both exit 0.

- [ ] **Step 5: Run permission smoke tests**

Verify with seeded Leg A/Leg B data that Leg A token receives 403/404 for attempted Leg B private data and that owner routes remain owner-only.

- [ ] **Step 6: Open Release 1 PR only after fresh green evidence**
