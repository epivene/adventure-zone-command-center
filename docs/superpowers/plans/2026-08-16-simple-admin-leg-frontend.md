# Simple Admin + Leg Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing Adventure Zone admin and Leg Manager frontends into a mobile-first, Five9-style workspace with compact navigation, dropdown-heavy actions, slide-in detail panels, and a combined Schedule workspace without removing tools or changing canonical data ownership.

**Architecture:** Keep the existing Wouter routes, API endpoints, React Query/auth providers, calendar/map components, and manager permission boundaries. Add a small reusable navigation/menu layer, a reusable responsive detail sheet, and a `SchedulePage` that composes the existing calendar and route views behind a Calendar/Map toggle. Existing deep URLs remain valid for compatibility; the new shell simply makes them less visually prominent.

**Tech Stack:** React 19, TypeScript, Wouter, Tailwind CSS, Radix UI dropdown/dialog primitives, Vaul drawer where appropriate, Lucide icons, Vitest, Testing Library.

## Global Constraints

- Hide complexity, not capability.
- Do not remove or weaken profiles, organizations, notes/history, call outcomes, follow-ups, booking/event data, event-family/duplicate workflows, calendar, routes, ACT import/recovery, manager operations, money, receipts, mileage, cash/settlement, crew, reviews, incidents, or route-issue tools.
- Do not introduce a second app or database.
- Preserve existing backend APIs and authorization boundaries unless a frontend integration test exposes a real defect.
- Design mobile-first; desktop is an adaptation of the same interaction model.
- Admin primary navigation: Today, Profiles, Schedule, Menu.
- Leg Manager primary navigation: Home, Schedule, Money, Crew, Menu.
- Phone detail panels are near full-screen; tablet/desktop detail panels are approximately 42–45% width.
- Empty informational cards should not occupy prominent space.
- Existing direct URLs remain routable even when the primary navigation changes.

---

## File Structure

### New files

- `artifacts/adventure-zone/src/components/navigation/app-menu.tsx` — grouped Admin menu content shared by desktop dropdown and mobile sheet.
- `artifacts/adventure-zone/src/components/navigation/mobile-bottom-nav.tsx` — four-item Admin bottom navigation plus Menu trigger.
- `artifacts/adventure-zone/src/components/navigation/responsive-detail-sheet.tsx` — responsive right drawer / mobile near-full-screen detail container.
- `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx` — lightweight profile workspace with Overview, History, Events, and Actions menu.
- `artifacts/adventure-zone/src/components/profiles/profile-actions-menu.tsx` — grouped Add/Edit/Organize/More actions.
- `artifacts/adventure-zone/src/pages/SchedulePage.tsx` — combined Calendar/Map workspace that reuses existing calendar and route components.
- `artifacts/adventure-zone/src/components/schedule/schedule-view-toggle.tsx` — Calendar/Map segmented control.
- `artifacts/adventure-zone/src/components/manager/manager-menu.tsx` — grouped Manager menu content.
- `artifacts/adventure-zone/src/components/manager/manager-mobile-nav.tsx` — Home/Schedule/Money/Crew/Menu navigation.

### Primary modified files

- `artifacts/adventure-zone/src/App.tsx`
- `artifacts/adventure-zone/src/App.admin-navigation.test.ts`
- `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`
- `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`
- `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- `artifacts/adventure-zone/src/components/today/summary-cards.tsx`
- `artifacts/adventure-zone/src/components/today/follow-up-list.tsx`
- `artifacts/adventure-zone/src/components/today/next-call-card.tsx`
- `artifacts/adventure-zone/src/pages/CalendarPage.tsx`
- `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
- `artifacts/adventure-zone/src/index.css`

---

### Task 1: Simplify Admin navigation without losing routes

**Files:**
- Create: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Create: `artifacts/adventure-zone/src/components/navigation/mobile-bottom-nav.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Test: `artifacts/adventure-zone/src/App.admin-navigation.test.ts`
- Test: `artifacts/adventure-zone/src/components/navigation/app-shell.test.tsx`

**Interfaces:**
- Produces: `<AppMenu />`, `<MobileBottomNav />`
- Preserves: all existing URLs in `App.tsx`
- Adds: `/schedule` route while keeping `/calendar` and `/routes` valid

- [ ] **Step 1: Write failing route-contract tests**

```ts
it("adds the combined Schedule route while keeping legacy calendar and routes URLs", () => {
  expect(appSource).toContain('<Route path="/schedule" component={SchedulePage} />');
  expect(appSource).toContain('<Route path="/calendar" component={CalendarPage} />');
  expect(appSource).toContain('<Route path="/routes" component={RoutesPage} />');
});
```

- [ ] **Step 2: Write a failing shell test for the four primary Admin destinations**

```tsx
it("shows only Today, Profiles, Schedule, and Menu as primary mobile navigation", () => {
  render(<AppShell><div>content</div></AppShell>);
  expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Profiles" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Bookings" })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/App.admin-navigation.test.ts src/components/navigation/app-shell.test.tsx
```

Expected: FAIL because `/schedule`, `AppMenu`, and the simplified primary navigation do not exist yet.

- [ ] **Step 4: Build `AppMenu` with grouped collapsible sections**

Use these visible groups and retain all destinations:

```ts
const adminMenuGroups = [
  { label: "Bookings & Follow-ups", items: ["Bookings", "Calls", "Quick add"] },
  { label: "Legs & Operations", items: ["Leg management", "Communications", "Finances", "Crew", "Reviews & incidents"] },
  { label: "Imports & Data", items: ["Act! import", "ACT recovery"] },
  { label: "Reports & History", items: ["Trips", "Archived / history entry points"] },
  { label: "Settings", items: ["Packages & resources", "Settings", "Sign out"] },
];
```

Implement desktop as a Radix dropdown/popover and mobile as a bottom sheet; show group headings immediately and let each group expand/collapse.

- [ ] **Step 5: Replace the permanent Admin sidebar/mobile button wall**

Desktop shell: compact top navigation with Today, Profiles, Schedule, Menu.

Mobile shell: fixed bottom navigation with Today, Profiles, Schedule, Menu.

Keep `New event` available under a small `+ Add` menu rather than a permanent large navigation button.

- [ ] **Step 6: Add `/schedule` to `App.tsx` without deleting existing routes**

Import `SchedulePage`, register `/schedule`, and leave `/calendar`, `/routes`, `/bookings`, settings, manager-admin, ACT, contact, and profile routes intact.

- [ ] **Step 7: Run tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/App.admin-navigation.test.ts src/components/navigation/app-shell.test.tsx
pnpm --filter @workspace/adventure-zone run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/App.admin-navigation.test.ts artifacts/adventure-zone/src/components/navigation

git commit -m "feat: simplify admin navigation"
```

---

### Task 2: Build the responsive detail-sheet foundation

**Files:**
- Create: `artifacts/adventure-zone/src/components/navigation/responsive-detail-sheet.tsx`
- Create: `artifacts/adventure-zone/src/components/navigation/responsive-detail-sheet.test.tsx`
- Modify: `artifacts/adventure-zone/src/index.css`

**Interfaces:**
- Produces:

```ts
type ResponsiveDetailSheetProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: React.ReactNode;
  fullPageHref?: string;
};
```

- [ ] **Step 1: Write failing interaction tests**

```tsx
it("renders a back/close control and full profile link when open", () => {
  render(
    <ResponsiveDetailSheet open onOpenChange={() => {}} title="Jane Doe" fullPageHref="/profiles/1">
      details
    </ResponsiveDetailSheet>,
  );
  expect(screen.getByRole("button", { name: /back|close/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open full/i })).toHaveAttribute("href", "/profiles/1");
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/navigation/responsive-detail-sheet.test.tsx
```

- [ ] **Step 3: Implement responsive behavior**

Use Radix Dialog or Vaul Drawer already present in the package. Mobile breakpoint behavior: near full-screen content. Desktop/tablet: right-side panel with `width: min(45vw, 44rem)` and a sensible minimum width.

- [ ] **Step 4: Add shared safe-area/mobile spacing styles**

Ensure bottom navigation and sheet content respect `env(safe-area-inset-bottom)` and do not cover form controls.

- [ ] **Step 5: Run test and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/navigation/responsive-detail-sheet.test.tsx
pnpm --filter @workspace/adventure-zone run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/navigation/responsive-detail-sheet* artifacts/adventure-zone/src/index.css
git commit -m "feat: add responsive detail sheet"
```

---

### Task 3: Turn Today into the focused Five9-style work queue

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/summary-cards.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/follow-up-list.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/next-call-card.tsx`
- Create: `artifacts/adventure-zone/src/components/today/needs-attention.tsx`
- Create: `artifacts/adventure-zone/src/pages/TodayPage.simple-layout.test.tsx`

**Interfaces:**
- Consumes: existing `/today` payload and `/calls/config`
- Produces visible order: Up Next → Follow-ups → Today/Upcoming Events → Needs Attention → Recent/secondary activity

- [ ] **Step 1: Write a failing layout test**

```tsx
it("presents Today as a work queue and hides zero-value attention cards", async () => {
  mockToday({ followUpCount: 0, contractCount: 0, newLeadCount: 0, visibleRouteWarningCount: 0 });
  render(<TodayPage />);
  expect(await screen.findByRole("heading", { name: "Up Next" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Follow-ups" })).toBeInTheDocument();
  expect(screen.queryByText("0 route issues", { exact: false })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/TodayPage.simple-layout.test.tsx
```

- [ ] **Step 3: Reorder existing Today components rather than replacing data logic**

Keep current API calls and assisted-calling behavior. Promote the current next call / call queue to an `Up Next` section, place follow-ups directly below it, then upcoming/today events, then conditional attention sections.

- [ ] **Step 4: Make `SummaryCards` conditional**

Render only non-zero or actionable cards. If all values are zero, render nothing.

- [ ] **Step 5: Move secondary areas lower and collapse where appropriate**

Keep renewals, post-event plans, trips, and activity available, but do not let them dominate the initial mobile viewport.

- [ ] **Step 6: Run focused tests and existing Today component tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/TodayPage.simple-layout.test.tsx src/components/today/*.test.tsx
pnpm --filter @workspace/adventure-zone run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/pages/TodayPage.tsx artifacts/adventure-zone/src/pages/TodayPage.simple-layout.test.tsx artifacts/adventure-zone/src/components/today
git commit -m "feat: simplify Today work queue"
```

---

### Task 4: Add slide-in profile workspace and grouped Actions menu

**Files:**
- Create: `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-actions-menu.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Reuse: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Reuse: `artifacts/adventure-zone/src/pages/ContactDetailPage.tsx`

**Interfaces:**
- Produces:

```ts
type ProfileSheetTarget = {
  profileId?: string;
  contactId?: string;
  bookingId?: string;
};
```

- Tabs: Overview, History, Events
- Actions groups: Add, Edit, Organize, More

- [ ] **Step 1: Write failing profile-sheet tests**

```tsx
it("shows Overview History Events tabs and grouped Actions", async () => {
  render(<ProfileDetailSheet target={{ profileId: "p1" }} open onOpenChange={() => {}} />);
  expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Events" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Actions" }));
  expect(screen.getByText("Add")).toBeInTheDocument();
  expect(screen.getByText("Edit")).toBeInTheDocument();
  expect(screen.getByText("Organize")).toBeInTheDocument();
  expect(screen.getByText("More")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/profiles/profile-detail-sheet.test.tsx
```

- [ ] **Step 3: Implement the lightweight panel using existing profile data endpoints/components**

Do not duplicate profile mutation logic. Link to the existing full edit/detail routes for complex workflows while exposing common actions directly where an existing endpoint/component already supports them.

- [ ] **Step 4: Populate grouped actions**

Visible group contents:

- Add: Note, Follow-up, Event
- Edit: Profile, Contact info, Status
- Organize: Add to Organization, Add to Event Family, Handle Duplicate/Merge
- More: Open Full Profile, Archive/Delete where allowed

- [ ] **Step 5: Wire Today and Profiles rows to open the sheet**

Use the sheet for normal click/tap behavior; preserve explicit deep links for opening full pages in a new tab or via `Open full profile`.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/profiles/profile-detail-sheet.test.tsx src/pages/ContactDetailPage.test.tsx
pnpm --filter @workspace/adventure-zone run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/profiles artifacts/adventure-zone/src/pages/TodayPage.tsx artifacts/adventure-zone/src/pages/OrganizationsPage.tsx
git commit -m "feat: add profile slide-in workspace"
```

---

### Task 5: Combine Calendar and Routes into Schedule

**Files:**
- Create: `artifacts/adventure-zone/src/pages/SchedulePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/SchedulePage.test.tsx`
- Create: `artifacts/adventure-zone/src/components/schedule/schedule-view-toggle.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CalendarPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- `SchedulePage` supports `view=calendar|map`
- Shared controls: Season, Leg, Status
- Calendar remains canonical for date display; Routes remains canonical for map/leg management tools

- [ ] **Step 1: Write failing Schedule tests**

```tsx
it("switches between Calendar and Map without losing shared filters", async () => {
  render(<SchedulePage />);
  expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Map" }));
  expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Leg")).toBeInTheDocument();
  expect(screen.getByLabelText("Status")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SchedulePage.test.tsx
```

- [ ] **Step 3: Extract embeddable Calendar content from `CalendarPage`**

Keep `EventCalendar`, active-month loading, multi-day event dates, and history suggestions. Export a content component that `SchedulePage` can render without duplicating fetch logic.

- [ ] **Step 4: Extract embeddable Route content from `RoutesPage`**

Keep event map, potential/confirmed route behavior, travel-leg management, manager preview, trip focus, equipment handoffs, and route issue review. Move administrative management sections below the main map so Schedule stays visually simple at first glance.

- [ ] **Step 5: Implement Calendar/Map segmented toggle and shared filters**

Default Admin Schedule to Calendar. Switching to Map keeps selected season/leg/status in component state and URL query parameters.

- [ ] **Step 6: Preserve direct routes**

`/calendar` continues rendering `CalendarPage`; `/routes` continues rendering `RoutesPage`; `/schedule` is the new primary navigation destination.

- [ ] **Step 7: Run tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SchedulePage.test.tsx src/App.admin-navigation.test.ts
pnpm --filter @workspace/adventure-zone run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/pages/SchedulePage* artifacts/adventure-zone/src/pages/CalendarPage.tsx artifacts/adventure-zone/src/pages/RoutesPage.tsx artifacts/adventure-zone/src/components/schedule artifacts/adventure-zone/src/App.tsx
git commit -m "feat: combine calendar and routes into Schedule"
```

---

### Task 6: Simplify Leg Manager navigation and Home

**Files:**
- Create: `artifacts/adventure-zone/src/components/manager/manager-menu.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/manager-mobile-nav.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/manager-shell.simple-nav.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Modify: `artifacts/adventure-zone/src/App.manager-routing.test.tsx`

**Interfaces:**
- Primary manager destinations: Home, Schedule, Money, Crew, Menu
- Menu retains: Receipts, Operations/Mileage, Incidents, Reviews, Messages, Route issues/history, Settings/sign out where applicable

- [ ] **Step 1: Write failing manager-nav test**

```tsx
it("uses Home Schedule Money Crew Menu as manager primary navigation", () => {
  renderManagerShell();
  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Money" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Crew" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Messages" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/manager-shell.simple-nav.test.tsx src/App.manager-routing.test.tsx
```

- [ ] **Step 3: Replace Messages primary nav with Menu**

Messages remain available inside Menu and retain unread count/badge there. Keep the existing 15-second unread refresh logic.

- [ ] **Step 4: Rename visible manager Route destination to Schedule**

Keep the route URL `/manager/route` for compatibility in this phase; change the shell label and page heading language to Schedule.

- [ ] **Step 5: Simplify Manager Home**

First viewport order:

1. Current leg context
2. Next stop/event
3. Today's money summary if available
4. Receipts/mileage requiring completion if available
5. Crew snapshot
6. Needs Attention only when non-zero/actionable
7. `+ Add` dropdown for Receipt, Expense, Mileage, Issue, Incident

Remove the permanent six-card destination grid because those destinations now live in primary nav or Menu.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/manager-shell.simple-nav.test.tsx src/App.manager-routing.test.tsx
pnpm --filter @workspace/adventure-zone run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/manager artifacts/adventure-zone/src/pages/ManagerHomePage.tsx artifacts/adventure-zone/src/App.manager-routing.test.tsx
git commit -m "feat: simplify manager navigation and home"
```

---

### Task 7: Make Manager Schedule and detail interactions match Admin

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerRoutePage.simple-layout.test.tsx`
- Reuse: `artifacts/adventure-zone/src/components/navigation/responsive-detail-sheet.tsx`
- Reuse: `artifacts/adventure-zone/src/components/manager/manager-scoped-map.tsx`
- Reuse: `artifacts/adventure-zone/src/components/manager/report-schedule-issue.tsx`

**Interfaces:**
- Manager Schedule defaults to route/next-stop emphasis
- Event tap opens responsive detail sheet
- Official schedule remains read-only
- `Report schedule issue` remains the mutation path for schedule corrections

- [ ] **Step 1: Write failing manager Schedule test**

```tsx
it("opens scheduled event details without granting schedule edit controls", async () => {
  render(<ManagerRoutePage />);
  const event = await screen.findByRole("button", { name: /Sample Event/i });
  await userEvent.click(event);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /edit booking/i })).not.toBeInTheDocument();
  expect(screen.getByText(/report schedule/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerRoutePage.simple-layout.test.tsx
```

- [ ] **Step 3: Keep map as the primary visual and move route details into compact sections**

On mobile, let the map occupy most of the available screen height; put stop details and filters into compact cards/sheets instead of a long page before the map.

- [ ] **Step 4: Open event detail in `ResponsiveDetailSheet`**

Show address, date/time, route context, manager-facing notes, crew snapshot where available, and post-event/review status. Do not expose admin-only edit controls.

- [ ] **Step 5: Keep issue reporting obvious**

Place `ReportScheduleIssue` inside the event/route detail experience and at the Schedule page level.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerRoutePage.simple-layout.test.tsx
pnpm --filter @workspace/adventure-zone run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx artifacts/adventure-zone/src/pages/ManagerRoutePage.simple-layout.test.tsx
git commit -m "feat: simplify manager Schedule workspace"
```

---

### Task 8: Regression pass for hidden-but-preserved tools

**Files:**
- Modify: relevant tests only if failures expose intentional navigation changes
- Test: existing Admin, manager, profile, calendar, route, ACT, follow-up, call-workspace suites

**Interfaces:**
- Verifies no feature was accidentally made unreachable

- [ ] **Step 1: Run the complete frontend test suite**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck and production build**

```bash
pnpm --filter @workspace/adventure-zone run typecheck
pnpm --filter @workspace/adventure-zone run build
```

Expected: PASS.

- [ ] **Step 3: Verify route reachability with source-level contract tests**

Add assertions for every lower-frequency destination moved into Menu: bookings, contacts, calls, manager finance, communications, crew admin, aftermath, manager issues, packages/resources, ACT import, ACT recovery, quick add, receipts, manager operations, manager reviews, manager incidents, manager messages.

- [ ] **Step 4: Perform responsive smoke checks**

Check at least these viewport classes manually or with existing browser tooling:

- 390×844 phone
- 768×1024 tablet
- 1440×900 desktop

Verify: bottom nav does not cover content, Menu opens and scrolls, profile sheet closes correctly, Schedule toggle works, map remains usable, forms remain reachable, and desktop panel width is approximately 42–45%.

- [ ] **Step 5: Commit any regression-test updates**

```bash
git add artifacts/adventure-zone/src
git commit -m "test: protect simplified frontend workflows"
```

---

## Self-Review Checklist

- Spec coverage: Admin Today, Profiles sheet, Schedule Calendar/Map, Admin Menu, Manager Home, Manager Schedule, Money/Crew primary nav, grouped menus, mobile-first behavior, conditional cards, preserved deep routes, and no permission/data-model changes are all mapped to tasks.
- Placeholder scan: no TBD/TODO/implement-later placeholders remain.
- Type consistency: `ResponsiveDetailSheetProps` and `ProfileSheetTarget` are defined before later tasks consume them.
- Scope: this plan intentionally does not redesign individual Money, Crew, ACT, finance, or admin-manager feature internals; it changes how users reach and frame them.
- Compatibility: `/calendar`, `/routes`, `/manager/route`, and all existing specialized routes remain available during this redesign.
