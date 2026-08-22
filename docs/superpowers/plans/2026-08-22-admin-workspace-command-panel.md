# Admin Workspace Command Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Administrator's all-in-one navigation with focused Booking, Marketing, and Legs & Operations workspaces while preserving shared CRM/Google data and restoring the exact Booking page after a Booking → Marketing detour.

**Architecture:** Add one pure route/workspace classifier plus session-only Booking return-path helpers, then make the existing admin shell/menu/mobile navigation derive their visible items from that classifier. Add lightweight Command Panel and Marketing home pages, preserve existing URLs/data/services, and keep Admin Tools as a compact maintenance menu rather than a fourth day-to-day workspace.

**Tech Stack:** React, TypeScript, Wouter, Lucide icons, sessionStorage, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-22-admin-workspace-command-panel-design.md`

## Global Constraints

- Workspace names are exactly: `Booking`, `Marketing`, `Legs & Operations`, `Command Panel`, `Admin Tools`.
- Existing CRM, booking, contact, route, Google Workspace, Gmail, Calendar, file, and package records remain shared; this change creates no duplicate data layer.
- Office Coordinator and Leg Manager authentication/role shells are unchanged.
- Administrator sign-in and signed-in `/` land on `/command`.
- Every Administrator workspace exposes a direct `/command` control on desktop and mobile.
- Booking → Marketing stores only a validated Booking app path in sessionStorage under `adventure-zone:booking-return-path`.
- Direct Command Panel → Marketing clears/stays without a Booking return context.
- Invalid/missing Booking return paths fall back to `/today`.
- Marketing exposes only working links; no fake campaign buttons/routes are introduced.
- Google Workspace settings/sync/review remain shared Admin Tools infrastructure; profile-level Google content remains on shared Booking profiles.

---

### Task 1: Add route classification and Booking return-state helpers

**Files:**
- Create: `artifacts/adventure-zone/src/lib/admin-workspace.ts`
- Create: `artifacts/adventure-zone/src/lib/admin-workspace.test.ts`

**Interfaces:**

```ts
export type AdminWorkspace = "command" | "booking" | "marketing" | "operations" | "admin";
export const BOOKING_RETURN_STORAGE_KEY = "adventure-zone:booking-return-path";
export function adminWorkspaceForPath(path: string): AdminWorkspace;
export function isBookingPath(path: string): boolean;
export function saveBookingReturnPath(path: string, storage?: Storage): boolean;
export function readBookingReturnPath(storage?: Storage): string | null;
export function clearBookingReturnPath(storage?: Storage): void;
```

- [ ] **Step 1: Write failing classifier tests**

Cover `/command`, Booking prefixes (`/today`, `/profiles`, `/contacts`, `/bookings`, `/schedule`, `/calendar`, `/calls`, `/research-sources`, `/needs-answer`, `/quick-add`, `/office-coordinator`), Operations prefixes (`/routes`, `/trips`, `/manager-communications`, `/manager-finance`, `/manager-crew`, `/manager-aftermath`, `/manager-issues`), `/marketing*`, and Admin Tools (`/settings*`, `/act-migration*`). Unknown admin paths return `admin`.

- [ ] **Step 2: Write failing return-path tests**

Prove valid Booking paths persist/read, Operations/Admin/Marketing/external-looking paths are rejected, malformed storage never throws, and clear removes the key.

- [ ] **Step 3: Implement pure prefix classification and guarded storage helpers**

Normalize only the pathname portion before classification; same-origin app paths must begin with `/` and must not begin with `//`.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/admin-workspace.test.ts
```

Expected: PASS.

---

### Task 2: Add the three-choice Command Panel and Marketing home

**Files:**
- Create: `artifacts/adventure-zone/src/pages/AdminCommandPanelPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/AdminCommandPanelPage.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/MarketingHomePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/MarketingHomePage.test.tsx`

**Interfaces:**

```tsx
<AdminCommandPanelPage />
<MarketingHomePage />
```

- [ ] **Step 1: Write Command Panel UI tests**

Assert exactly three primary workspace cards with destinations `/today`, `/marketing`, and `/routes`; copy is `Find it, contact it, book it.`, `Promote it, mail it, campaign it.`, and `Route it, set it up, run it.`; Admin Tools is a secondary maintenance link, not a fourth primary card.

- [ ] **Step 2: Implement Command Panel**

Use large touch-friendly semantic links and a short heading explaining that the user is choosing the kind of work they want to do.

- [ ] **Step 3: Write Marketing home tests**

Assert the page identifies shared CRM/Google context, contains only real destinations currently available (Profiles, Office Coordinator/mail support as relevant, Admin Tools), and renders a Back to Booking control only when `readBookingReturnPath()` returns a valid path.

- [ ] **Step 4: Implement Marketing home**

The page is a real workspace landing area, but future campaign/brochure/mass-email modules are described as upcoming organization categories rather than clickable dead controls.

- [ ] **Step 5: Verify**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/AdminCommandPanelPage.test.tsx src/pages/MarketingHomePage.test.tsx
```

Expected: PASS.

---

### Task 3: Make the Administrator menu workspace-specific

**Files:**
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-shell.test.tsx`

**Interfaces:**

```tsx
<AppMenu workspace={workspace} mobile={boolean} />
```

- [ ] **Step 1: Update source/UI tests first**

Prove Booking menu includes Bookings, Calls, Office Coordinator, Research Sources, Quick add, Contacts, and Marketing but excludes leg finance/crew/aftermath/issues. Operations menu includes Leg management, Communications, Finances, Crew, Reviews & incidents, Route issues and excludes Calls/Research Sources. Marketing menu stays compact. All menus contain Command Panel, Admin Tools, and Sign out.

- [ ] **Step 2: Replace one global menu list with workspace menu definitions**

Keep shared maintenance destinations grouped under one collapsed/compact Admin Tools group: Paper notes, ACT import, ACT recovery, Call scripts, Packages & resources, Settings. Future `/settings/google-workspace` and review routes naturally classify as Admin Tools without requiring a new workspace.

- [ ] **Step 3: Add the Booking → Marketing action**

Use `useLocation()` inside `AppMenu`; when Marketing is selected from Booking, call `saveBookingReturnPath(location)` before navigation. Do not save from Command Panel, Operations, Marketing, or Admin Tools.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/navigation/app-shell.test.tsx src/lib/admin-workspace.test.ts
```

Expected: PASS.

---

### Task 4: Make desktop and mobile shells workspace-aware

**Files:**
- Modify: `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/mobile-bottom-nav.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/mobile-bottom-nav.performance.test.tsx`

**Interfaces:**

`AppShell` derives `workspace = adminWorkspaceForPath(location)` and supplies it to both desktop and mobile navigation.

- [ ] **Step 1: Write shell expectations**

Booking desktop keeps Today / Profiles / Schedule plus Marketing shortcut. Operations desktop prioritizes Legs (`/routes`), Communications, and Crew. Marketing desktop shows Marketing Home plus Back to Booking when valid. Command/Admin modes avoid exposing unrelated work menus.

- [ ] **Step 2: Add persistent Command Panel control**

Desktop brand/explicit control points to `/command` instead of `/today` while active workspace links remain nearby.

- [ ] **Step 3: Make mobile bottom nav workspace-specific**

Booking: Command Panel, Today, Profiles, Schedule, Menu. Operations: Command Panel, Legs, Communications, Crew, Menu. Marketing: Command Panel, Marketing, Back to Booking when valid, Menu. Admin: Command Panel plus Menu. Preserve opaque `bg-white` mobile surface and no backdrop blur.

- [ ] **Step 4: Keep assistant/message behavior safe**

Do not change server permissions or manager/Office shells. Keep the existing floating assistant/profile hiding behavior and manager-message unread polling; only navigation destinations change.

- [ ] **Step 5: Verify**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/navigation/app-shell.test.tsx src/components/navigation/mobile-bottom-nav.performance.test.tsx
```

Expected: PASS.

---

### Task 5: Route Administrator login through Command Panel and preserve existing URLs

**Files:**
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/App.admin-navigation.test.ts`
- Modify: `artifacts/adventure-zone/src/lib/auth-context.tsx`

- [ ] **Step 1: Add failing navigation contract assertions**

Assert `/command` → `AdminCommandPanelPage`, `/marketing` → `MarketingHomePage`, signed-in `HomeRoute` redirects to `/command`, SignIn success navigates to `/command`, and every existing Booking/Operations/Admin route remains mounted unchanged.

- [ ] **Step 2: Add page imports/routes and change login redirects**

Place `/command` and `/marketing` near the top of `AdminProtectedApp`'s switch. Keep legacy `/today`, `/profiles`, `/schedule`, `/routes`, settings, manager-admin and ACT URLs unchanged.

- [ ] **Step 3: Clear Booking return state on Administrator sign-out**

Call `clearBookingReturnPath()` from owner `signOut`; do not touch Office/Manager auth contexts.

- [ ] **Step 4: Verify route regressions**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/App.admin-navigation.test.ts src/lib/admin-workspace.test.ts
```

Expected: PASS.

---

### Task 6: Full frontend verification and PR gate

**Files:** all files above.

- [ ] **Step 1: Run focused navigation suite**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/lib/admin-workspace.test.ts \
  src/pages/AdminCommandPanelPage.test.tsx \
  src/pages/MarketingHomePage.test.tsx \
  src/components/navigation/app-shell.test.tsx \
  src/components/navigation/mobile-bottom-nav.performance.test.tsx \
  src/App.admin-navigation.test.ts
```

- [ ] **Step 2: Run frontend typecheck/build**

```bash
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

- [ ] **Step 3: Regression spot-check**

Confirm Office Coordinator and Leg Manager route patterns are unchanged; `/settings/*` remains reachable; Booking profile/Schedule routes remain unchanged for Google Workspace projection work; no new Gmail/Calendar storage or sync code exists in this branch.

- [ ] **Step 4: Open implementation PR**

PR summary must call out: three workspaces, persistent Command Panel, Booking-return memory, mobile workspace navigation, Admin Tools separation, and unchanged shared Google Workspace architecture.
