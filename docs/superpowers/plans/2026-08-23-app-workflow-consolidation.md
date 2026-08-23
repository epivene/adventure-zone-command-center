# Adventure Zone Command Center Workflow Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate redundant user-facing destinations into canonical Calls, Schedule, Profiles, and Admin routes while preserving useful behavior and keeping old URLs working through quiet redirects.

**Architecture:** Introduce explicit canonical-route helpers and compatibility redirects first, then move overlapping workflows into the surviving workspaces before retiring old destinations. Reuse existing `CallerFinder`, `QuickAddCaller`, `CallWorkspace`, `CalendarContent`, `RoutesContent`, organization/contact repositories, and existing admin pages rather than rebuilding backend systems.

**Tech Stack:** React, TypeScript, Wouter, Vitest, Testing Library, Express/Drizzle only where existing quick-caller orchestration is reused.

**Spec:** `docs/superpowers/specs/2026-08-23-app-workflow-consolidation-design.md`

## Global Constraints

- One user job has one canonical workspace.
- Useful behavior moves before any legacy destination is retired.
- Legacy URLs redirect quietly and preserve relevant query parameters.
- New internal links must use canonical URLs rather than depending on redirects.
- Contacts, organizations, bookings, events, routes, and timeline records keep their existing data responsibilities.
- `/calls/log` remains the lightweight/mobile log mode.
- Operational leg management remains under Operations; route browsing belongs to Schedule.
- Office Coordinator and Manager permission/workspace boundaries must not change.
- ACT Import and ACT Recovery remain separate tools.
- No source business data or CRM records are modified merely because navigation changes.

---

### Task 1: Establish canonical route helpers and compatibility redirects

**Files:**
- Create: `artifacts/adventure-zone/src/lib/canonical-routes.ts`
- Create: `artifacts/adventure-zone/src/lib/canonical-routes.test.ts`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Test: `artifacts/adventure-zone/src/App.route-consolidation.test.tsx`

**Interfaces:**
- Produces `canonicalCallsPath(search?: string): string`, `canonicalSchedulePath(input): string`, `canonicalProfilePath(id: string): string`, and `CanonicalRedirect`.
- Legacy route components consume these helpers and preserve supported query strings.

- [ ] **Step 1: Write route-helper tests**

Add tests covering these exact transformations:

```ts
expect(canonicalCallsPath("?contactId=1&bookingId=2")).toBe("/calls/workspace?contactId=1&bookingId=2");
expect(canonicalSchedulePath({ view: "map", search: "?season=2027&leg=abc" }))
  .toBe("/schedule?view=map&season=2027&leg=abc");
expect(canonicalProfilePath("profile-123")).toBe("/profiles/profile-123");
```

Also test that duplicate canonical query keys are normalized rather than emitted twice.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/canonical-routes.test.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the canonical helpers**

Use `URLSearchParams` and preserve only meaningful existing parameters. `canonicalSchedulePath` must set `view=map` ahead of preserved `season`, `leg`, and `status` parameters.

- [ ] **Step 4: Write route-component tests for legacy paths**

Add a source/router contract asserting `App.tsx` no longer mounts the old pages directly for these aliases:

```ts
/calls/new
/calls/mobile
/quick-add
/calendar
/routes
/organizations
/event-profiles/:id
/act-migration
```

and instead mounts redirect components targeting the canonical destinations.

- [ ] **Step 5: Implement compatibility redirects in `App.tsx`**

Use Wouter `Redirect` or a tiny redirect component that preserves `useSearch()` where needed. Keep `/calls/log`, `/profiles`, `/profiles/:profileId`, `/schedule`, and `/settings/act-migration` as real destinations.

- [ ] **Step 6: Run focused route tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/canonical-routes.test.ts src/App.route-consolidation.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/lib/canonical-routes.ts artifacts/adventure-zone/src/lib/canonical-routes.test.ts artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/App.route-consolidation.test.tsx
git commit -m "refactor: establish canonical app routes"
```

---

### Task 2: Merge Find Caller and Quick Add Caller into Calls

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/caller-finder.tsx` only if an explicit no-match/add action is missing
- Reuse: `artifacts/adventure-zone/src/components/contacts/quick-add-caller.tsx`
- Reuse: `artifacts/api-server/src/features/contacts/quick-caller-service.ts`
- Test: `artifacts/adventure-zone/src/pages/CallWorkspacePage.quick-add.test.tsx`
- Test: existing caller-finder and quick-caller tests

**Interfaces:**
- Calls accepts `mode=add`, `phone`, and `q` query parameters.
- `QuickAddCaller` continues posting to `/calls/quick-caller`.
- Successful creation navigates directly to `/calls/workspace?contactId=<new-id>`.

- [ ] **Step 1: Write a failing Calls quick-add test**

Render `CallWorkspacePage` with `/calls/workspace?mode=add&phone=7015550100&q=Amy`. Assert the page renders `QuickAddCaller` prefilled with the supplied phone/query rather than `CallerFinder` alone.

- [ ] **Step 2: Write a failing no-match transition test**

Render the finder state and simulate the existing no-match/add action. Assert Calls switches to add mode without navigating to `/quick-add`.

- [ ] **Step 3: Run the focused tests and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/CallWorkspacePage.quick-add.test.tsx
```

- [ ] **Step 4: Implement add mode inside `CallWorkspacePage`**

Parse:

```ts
const addMode = params.get("mode") === "add";
const initialPhone = params.get("phone") ?? "";
const initialQuery = params.get("q") ?? "";
```

When there is no selected caller and `addMode` is true, render `QuickAddCaller`. On success, navigate to the canonical Calls route with the new `contactId` and remove `mode=add`.

- [ ] **Step 5: Keep duplicate review behavior**

Do not bypass `QuickAddCaller` duplicate candidates. The existing quick-caller backend remains authoritative for exact/likely duplicate handling.

- [ ] **Step 6: Update finder add-new action**

If `CallerFinder` currently links to `/quick-add`, change that action to `/calls/workspace?mode=add` while preserving entered `phone`/`q` values.

- [ ] **Step 7: Run Calls tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/CallWorkspacePage* src/components/calls/caller-finder* src/components/contacts/quick-add-caller*
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx artifacts/adventure-zone/src/pages/CallWorkspacePage.quick-add.test.tsx artifacts/adventure-zone/src/components/calls/caller-finder.tsx
git commit -m "refactor: merge caller creation into Calls"
```

---

### Task 3: Retire Quick Add as a real destination

**Files:**
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Modify: any Add-menu component that points to `/quick-add`
- Modify/Delete after coverage: `artifacts/adventure-zone/src/pages/QuickAddPage.tsx`
- Test: `artifacts/adventure-zone/src/components/navigation/app-menu*.test.ts`
- Test: `artifacts/adventure-zone/src/App.route-consolidation.test.tsx`

**Interfaces:**
- `/quick-add` remains only as a compatibility redirect to `/calls/workspace?mode=add`.
- No normal UI emits `/quick-add`.

- [ ] **Step 1: Add a failing internal-link guard**

Scan app navigation source and assert it does not contain `href="/quick-add"` or `href: "/quick-add"` outside the compatibility route test.

- [ ] **Step 2: Run the guard and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/navigation/app-menu*.test.ts src/App.route-consolidation.test.tsx
```

- [ ] **Step 3: Replace Quick Add navigation with canonical Calls add mode**

The Add menu should offer caller creation only if that shortcut remains useful, and its target must be `/calls/workspace?mode=add`.

- [ ] **Step 4: Remove `QuickAddPage.tsx` only after no real route imports it**

Delete the page file and its now-obsolete dedicated page tests. Keep `QuickAddCaller` because Calls reuses the component.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/navigation/app-menu* src/App.route-consolidation.test.tsx src/pages/CallWorkspacePage*
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 6: Commit**

```bash
git add -A artifacts/adventure-zone/src/components/navigation artifacts/adventure-zone/src/pages/QuickAddPage.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "refactor: retire standalone Quick Add page"
```

---

### Task 4: Make Schedule the only calendar/route browsing destination

**Files:**
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: navigation/menu files that link to `/calendar` or route-browsing `/routes`
- Keep/reuse: `artifacts/adventure-zone/src/pages/SchedulePage.tsx`
- Keep/reuse: `artifacts/adventure-zone/src/pages/CalendarPage.tsx` as `CalendarContent`
- Keep/reuse: `artifacts/adventure-zone/src/pages/RoutesPage.tsx` as `RoutesContent`
- Test: `artifacts/adventure-zone/src/pages/SchedulePage.route-aliases.test.ts`

**Interfaces:**
- `/calendar` redirects to `/schedule` preserving supported filters.
- route-browsing `/routes` redirects to `/schedule?view=map`.
- Operations leg-management links must target the leg-management surface, not the legacy route-browser URL.

- [ ] **Step 1: Write failing redirect and navigation tests**

Assert:

```ts
/calendar?season=2027 -> /schedule?season=2027
/routes?season=2027&leg=abc -> /schedule?view=map&season=2027&leg=abc
```

and assert normal Schedule navigation points to `/schedule`.

- [ ] **Step 2: Run focused tests and confirm RED where old links remain**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SchedulePage* src/App.route-consolidation.test.tsx
```

- [ ] **Step 3: Update internal calendar links**

Replace user-facing `/calendar` links with `/schedule`. Preserve explicit scheduling filters when generated dynamically.

- [ ] **Step 4: Update route-map links**

Replace route-browsing links with `/schedule?view=map`. Do not repoint operational leg-edit links if they serve a different management page; verify each `/routes` link by intent before changing it.

- [ ] **Step 5: Keep `CalendarContent` and `RoutesContent` as reusable view modules**

Do not delete `CalendarPage.tsx` or `RoutesPage.tsx` merely because their direct routes redirect if `SchedulePage` imports their content exports.

- [ ] **Step 6: Run Schedule tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SchedulePage* src/pages/CalendarPage* src/pages/RoutesPage* src/App.route-consolidation.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/pages/SchedulePage* artifacts/adventure-zone/src/components/navigation
 git commit -m "refactor: consolidate calendar and route browsing into Schedule"
```

---

### Task 5: Make Profiles the central CRM directory, including Contacts

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Inspect/reuse: `artifacts/adventure-zone/src/pages/ContactsPage.tsx`
- Modify: navigation/menu files
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Test: `artifacts/adventure-zone/src/pages/OrganizationsPage.directory-modes.test.tsx`

**Interfaces:**
- `/profiles` is the canonical CRM directory.
- Directory mode is represented with `?type=all|events|organizations|contacts` or an equivalent single URL-state contract.
- Contact detail/edit routes remain `/contacts/:id` and `/contacts/:id/edit`.

- [ ] **Step 1: Write a failing Profiles directory-mode test**

Assert Profiles exposes user-selectable modes for `All`, `Events`, `Organizations`, and `Contacts`, with the default search spanning the supported record types.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage.directory-modes.test.tsx
```

- [ ] **Step 3: Extract reusable Contacts list/search content if needed**

If `ContactsPage.tsx` owns rendering that Profiles cannot reuse, move only the list/search UI into a focused component such as:

```ts
src/components/profiles/contact-directory-view.tsx
```

Do not merge contact and organization database models.

- [ ] **Step 4: Implement Profiles directory modes**

Profiles should switch record-type views without navigating to another top-level workspace. Contact results still link to `/contacts/:id`; event/organization results link to `/profiles/:profileId`.

- [ ] **Step 5: Remove All Contacts from primary navigation**

Replace the existing `All contacts` navigation item with `Profiles`, or remove it when Profiles is already present in that workspace.

- [ ] **Step 6: Redirect `/organizations` to `/profiles`**

Preserve search/filter parameters that Profiles understands.

- [ ] **Step 7: Decide `/contacts` compatibility behavior only after Profiles has contact coverage**

Once contact discovery is proven in Profiles, change `/contacts` into a quiet redirect to `/profiles?type=contacts`. Keep `/contacts/new`, `/contacts/:id`, and `/contacts/:id/edit` as real routes.

- [ ] **Step 8: Run Profiles/Contacts tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage* src/pages/ContactsPage* src/pages/Contact*
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 9: Commit**

```bash
git add artifacts/adventure-zone/src/pages/OrganizationsPage.tsx artifacts/adventure-zone/src/pages/ContactsPage.tsx artifacts/adventure-zone/src/components/profiles artifacts/adventure-zone/src/components/navigation artifacts/adventure-zone/src/App.tsx
git commit -m "refactor: consolidate CRM discovery into Profiles"
```

---

### Task 6: Normalize profile-detail and ACT migration aliases

**Files:**
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: internal profile-link helpers/components
- Modify: ACT migration links/menu buttons
- Test: `artifacts/adventure-zone/src/lib/canonical-routes.test.ts`
- Test: `artifacts/adventure-zone/src/App.route-consolidation.test.tsx`

**Interfaces:**
- Canonical profile detail: `/profiles/:profileId`.
- `/event-profiles/:id` redirects to `/profiles/:id`.
- Canonical ACT import: `/settings/act-migration`.
- `/act-migration` redirects to `/settings/act-migration`.

- [ ] **Step 1: Add failing source/link guards for legacy profile URLs**

Search app source tests for generated `/event-profiles/` links and distinguish creation/edit routes from detail routes. Detail navigation must use `/profiles/:id`; `/event-profiles/new` may remain canonical for creation unless separately redesigned.

- [ ] **Step 2: Replace internal detail links**

Update profile cards, search results, Today links, assistant navigation, booking references, and other user-facing links that open profile detail.

- [ ] **Step 3: Replace internal `/act-migration` links**

All Admin Tools navigation must use `/settings/act-migration`.

- [ ] **Step 4: Run focused guards**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/canonical-routes.test.ts src/App.route-consolidation.test.tsx src/components/profiles/*test* src/pages/*Profile*test*
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/lib/canonical-routes* artifacts/adventure-zone/src/components artifacts/adventure-zone/src/pages
git commit -m "refactor: normalize profile and ACT import routes"
```

---

### Task 7: Sweep remaining internal legacy links

**Files:**
- Create: `artifacts/adventure-zone/src/lib/no-legacy-navigation.test.ts`
- Modify: any frontend file still emitting retired routes

**Interfaces:**
- Test acts as a regression guard against reintroducing retired user-facing destinations.

- [ ] **Step 1: Write a source-contract test**

Scan `src` files excluding `App.tsx`, route tests, and canonical redirect helpers. Fail on user-facing link literals matching:

```ts
/quick-add
/calls/new
/calls/mobile
/calendar
/organizations
/event-profiles/<detail id>
/act-migration
```

Treat `/event-profiles/new` and `/event-profiles/:id/edit` separately because they remain creation/edit routes in this project.

- [ ] **Step 2: Run the guard and list every remaining offender**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/no-legacy-navigation.test.ts
```

Expected: FAIL until all internal callers use canonical routes.

- [ ] **Step 3: Replace each offender by intent**

Use `/calls/workspace`, `/calls/log`, `/schedule`, `/profiles`, `/profiles/:id`, and `/settings/act-migration` as appropriate. Preserve query context.

- [ ] **Step 4: Re-run guard until PASS**

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src
git commit -m "refactor: remove legacy internal navigation"
```

---

### Task 8: Remove only page shells that no longer own real behavior

**Files:**
- Delete if unused: `artifacts/adventure-zone/src/pages/QuickAddPage.tsx`
- Delete/convert only if no longer imported as content: legacy page shells identified by static import search
- Keep: `CalendarPage.tsx` and `RoutesPage.tsx` while `SchedulePage` imports `CalendarContent`/`RoutesContent`
- Keep: contact detail/edit/create pages
- Test: route/import contract tests

**Interfaces:**
- Compatibility routing lives in `App.tsx`/canonical redirect helpers, not dead page shells.

- [ ] **Step 1: Search imports for each retirement candidate**

Before deleting a file, confirm it is not imported by another surviving page. `QuickAddPage.tsx` should be removable after Task 3; Calendar/Routes content files are expected to remain.

- [ ] **Step 2: Delete only proven dead shells**

Do not delete components such as `CallerFinder`, `QuickAddCaller`, `CalendarContent`, or `RoutesContent` that now power canonical workspaces.

- [ ] **Step 3: Run route tests and typecheck after deletions**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/App.route-consolidation.test.tsx src/lib/no-legacy-navigation.test.ts
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 4: Commit**

```bash
git add -A artifacts/adventure-zone/src
git commit -m "chore: remove retired page shells"
```

---

### Task 9: Full regression verification

**Files:**
- No production changes unless verification exposes a defect.

**Interfaces:**
- Verifies that consolidation changed navigation/workflow ownership without breaking role-specific portals or data behavior.

- [ ] **Step 1: Run Calls-focused tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/CallWorkspacePage* src/pages/MobileCallLogPage* src/components/calls/*test* src/components/contacts/quick-add-caller*
```

- [ ] **Step 2: Run Profiles-focused tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage* src/pages/ContactsPage* src/pages/EventProfilePage* src/pages/Contact*
```

- [ ] **Step 3: Run Schedule-focused tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SchedulePage* src/pages/CalendarPage* src/pages/RoutesPage*
```

- [ ] **Step 4: Run route/navigation guards**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/App.route-consolidation.test.tsx src/lib/canonical-routes.test.ts src/lib/no-legacy-navigation.test.ts src/components/navigation/*test*
```

- [ ] **Step 5: Run role-specific smoke tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/office* src/pages/manager* src/components/office* src/components/manager*
```

If repository naming differs, use the existing Office Coordinator and Manager test files discovered by `find`/test listing rather than broad shell globbing.

- [ ] **Step 6: Run frontend typecheck and build**

```bash
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

- [ ] **Step 7: Run API tests only if Calls orchestration/backend code changed**

```bash
pnpm --filter @workspace/api-server test -- src/features/contacts src/routes/calls*
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
```

- [ ] **Step 8: Review final diff against the spec**

Confirm:

```text
Today / Bookings / Profiles / Calls / Schedule / Research remain the primary daily destinations.
Old bookmarks redirect quietly.
Calls owns find + add + call + log.
Schedule owns calendar + route browsing.
Profiles owns CRM discovery including Contacts.
Office/Manager permissions are unchanged.
ACT Import and ACT Recovery remain separate.
No CRM/business records are migrated or altered by this frontend consolidation.
```

- [ ] **Step 9: Open a draft PR**

PR description must list the canonical route map, retired destinations, preserved redirects, workflow merges, verification evidence, and any GitHub Actions runner limitation.
