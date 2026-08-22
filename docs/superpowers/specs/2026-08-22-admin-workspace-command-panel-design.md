# Admin Workspace Command Panel Design

**Status:** User-approved product direction; implementation pending  
**Date:** 2026-08-22

## Goal

Reduce Administrator navigation overload by replacing the current all-in-one admin menu with a workspace-oriented Command Panel containing three clear work areas:

- **Booking** — find it, contact it, book it.
- **Marketing** — promote it, mail it, campaign it.
- **Legs & Operations** — route it, set it up, run it.

The change is organizational only. Existing bookings, profiles, contacts, Google Workspace records, Calendar events, files, packages, trips, and operational records remain shared data. No workspace creates a duplicate copy of a business record.

## Product principles

1. The Administrator should see only the tools relevant to the job they are doing right now.
2. The main Command Panel is always reachable from every admin workspace.
3. Booking may open Marketing without losing the Booking page the user was working on.
4. Returning from Marketing to Booking restores that prior Booking location when Marketing was entered from Booking.
5. Google Workspace/Gmail/Calendar ingestion remains one shared infrastructure layer underneath all workspaces.
6. Admin-only system setup, imports, migrations, recovery, and connection settings remain separate from the three day-to-day workspaces.
7. Existing Office Coordinator and Leg Manager portals are not merged into this workspace selector and keep their current role boundaries.

## Administrator login and landing behavior

After a successful Administrator sign-in, the default destination becomes the **Admin Command Panel** rather than `/today`.

The Command Panel presents three large workspace choices:

### Booking

**Purpose:** Sales, outreach, customer/event relationship management, and converting opportunities into booked events.

Suggested card copy:

> Booking  
> Find it, contact it, book it.

Booking contains the existing booking-facing experiences, including:

- Today / booking dashboard
- Profiles and event families
- Contacts
- Calls / guided call workspace
- Follow-ups and booking opportunities
- Research sources / lead discovery
- Bookings
- Schedule / Calendar
- Quick Add / new event / new contact
- Booking-facing package and pricing information
- Office Coordinator oversight, tasks, submitted email drafts, and related booking support
- Needs Answer / booking questions
- Booking Assistant
- profile-level conversations, files, Calendar context, and suggested updates supplied by Google Workspace

The Booking workspace must not expose route-management, crew-management, finance, aftermath, incident, or other operational navigation as normal Booking menu items.

### Marketing

**Purpose:** Promotional outreach conducted at scale rather than one event relationship at a time.

Suggested card copy:

> Marketing  
> Promote it, mail it, campaign it.

Marketing is a dedicated workspace for current and future tools such as:

- mass marketing email campaigns
- promotional email templates
- brochure campaigns
- mailed brochure / promo tracking
- campaign audiences and contact lists
- promotional materials
- campaign history and results
- off-season opportunity campaigns
- future social/promotional tools

Marketing may show shared CRM profile/contact context and shared Google-derived business records where useful, but it does not own a separate copy of contacts or Gmail data.

Marketing is available in two entry modes:

1. **Direct entry from Command Panel** — return action goes to Command Panel.
2. **Entry from Booking** — return action reads **Back to Booking** and restores the exact Booking location saved before entering Marketing.

Example:

```text
Booking profile /profiles/123
→ open Marketing
→ work in Marketing
→ Back to Booking
→ /profiles/123
```

A page refresh or normal in-app navigation inside Marketing must not destroy the saved Booking return destination for the current admin session.

### Legs & Operations

**Purpose:** Prepare, route, staff, run, inspect, and wrap up booked events.

Suggested card copy:

> Legs & Operations  
> Route it, set it up, run it.

This workspace contains operational/admin tools such as:

- Leg management
- route planning / travel
- Trips and route history where applicable
- operational event scheduling/context
- manager communications
- manager finances
- crew management
- event wrap-up
- reviews and incidents
- route issues
- equipment / inflatable inventory
- package operational requirements
- event check-in / checkout
- pre-event and post-event inspection checklists
- setup requirements
- maintenance / condition context

The shared booking/event record may be viewed here for operational execution, but Booking sales/outreach tools should not fill the Operations navigation.

## Shared Administrator tools

System/setup tools do not become a fourth full workspace. They remain accessible from a compact **Admin Tools** area reachable from the Command Panel and/or workspace menu.

This area includes, as applicable:

- Imports & Data
- Paper Notes
- ACT import / migration
- ACT Recovery
- Google Workspace connection and sync settings
- source/review diagnostics
- app settings
- call-script settings
- package/resource configuration
- account and role administration

The implementation should avoid making Admin Tools another long always-visible menu. It is an occasional maintenance area.

## Navigation model

### Workspace identity

Every Administrator page is classified into one of:

```ts
type AdminWorkspace = "command" | "booking" | "marketing" | "operations" | "admin";
```

A route-to-workspace classifier is the single authority used by the shell/menu to decide which navigation to display.

### Persistent Command Panel access

Every Administrator workspace must display a clear **Command Panel** control on desktop and mobile.

It must not require opening multiple nested dropdowns.

Selecting it navigates to the three-workspace landing page.

### Workspace-specific menus

The menu displayed inside a workspace contains only that workspace's navigation plus compact shared actions:

- Command Panel
- optional Admin Tools entry
- account/sign-out

The existing menu pattern of showing Booking, Legs & Operations, Imports & Data, and Settings together is retired for Administrator navigation.

### Booking ↔ Marketing handoff

Booking exposes a visible Marketing shortcut.

When this shortcut is used:

1. save the current Booking path as `bookingReturnPath`;
2. navigate to the Marketing workspace;
3. display **Back to Booking** in Marketing;
4. use the saved path when returning;
5. validate that the stored path belongs to Booking before navigating to it;
6. fall back to the Booking home (`/today`) if the stored path is missing or invalid.

A direct Command Panel → Marketing entry must not manufacture a Booking return path.

### Browser back behavior

Normal browser Back/Forward remains functional. The explicit **Back to Booking** action is a convenience route restore and must not replace browser history semantics.

## Route classification

Initial classification should preserve existing URLs rather than renaming the entire application.

### Booking routes

At minimum:

```text
/today
/profiles*
/organizations*
/event-families*
/event-profiles*
/contacts*
/bookings*
/schedule*
/calendar*
/calls*
/research-sources*
/needs-answer*
/quick-add*
/office-coordinator*
```

Booking-facing settings such as call scripts or package/pricing editing may be linked from Booking where contextually helpful, but their maintenance pages may classify as Admin Tools.

### Operations routes

At minimum:

```text
/routes*
/trips*
/manager-communications*
/manager-finance*
/manager-crew*
/manager-aftermath*
/manager-issues*
/admin/event-wrap-up style routes represented by ADMIN_WRAP_UP_PATH
```

The implementation should classify new inspection/check-in/checkout/inventory operational routes here when those features are added.

### Marketing routes

Marketing starts with a dedicated workspace home route and should own new marketing-specific pages. Existing shared CRM pages are not duplicated merely to populate Marketing.

Suggested namespace:

```text
/marketing
/marketing/campaigns*
/marketing/brochures*
/marketing/templates*
/marketing/audiences*
```

Only pages that actually exist should be exposed. The first implementation may provide a useful Marketing home that links current relevant tools and clearly leaves room for future campaign features without creating fake/nonfunctional buttons.

### Admin Tools routes

At minimum:

```text
/settings*
/act-migration*
```

Google Workspace settings/review routes introduced by the approved Google sync implementation remain Admin Tools unless a specific profile-level view is being rendered inside Booking.

## Google Workspace compatibility

The workspace restructure must not fork or duplicate the approved Gmail/Calendar sync design.

Google Workspace remains a shared infrastructure/data layer with one archive, one set of source identities, one matching system, and one sync lifecycle.

### Booking presentation

Booking may show:

- complete customer/event Gmail conversations on profiles;
- files/contracts linked to profiles and bookings;
- Google Calendar items linked to profiles/bookings;
- Schedule entries supplied by local synced Google Calendar data;
- suggested profile updates;
- follow-up context derived from approved business sources.

### Marketing presentation

Marketing may show:

- promotional/brochure-oriented conversations;
- campaign-relevant contact/profile audiences;
- promo templates;
- brochure history;
- mass-marketing campaign history;
- future campaign analytics.

It consumes shared Google/CRM data rather than creating a separate Gmail archive.

### Operations presentation

Operations may consume booking date/location/package context and shared Calendar information required to execute an event. It does not automatically gain access to unrelated Gmail bodies merely because the underlying source exists.

### Admin Tools presentation

The actual Google connection, OAuth/scope configuration, backfill status, repair state, unmatched/conflict review, and sync administration live in Admin Tools.

No change in workspace UI weakens existing role access rules. Administrator/Office Coordinator/Leg Manager permissions remain enforced server-side by the Google Workspace implementation.

## Shell behavior

The current `AppShell` top navigation (`Today`, `Profiles`, `Schedule`) should become workspace-aware.

### Command Panel

The Command Panel should use a lightweight admin shell or the shared shell in command mode. It should emphasize the three workspace cards rather than showing a full work menu.

### Booking shell

Primary navigation should prioritize Booking's common daily actions, for example:

```text
Today | Profiles | Schedule
```

The exact current high-value primary navigation can remain, but the dropdown/menu is Booking-only.

### Operations shell

Primary navigation may prioritize:

```text
Operations Home | Legs | Schedule/Trips
```

Only implement links to existing, working pages.

### Marketing shell

Primary navigation may prioritize:

```text
Marketing Home | Campaigns/Brochures when available
```

The shell displays **Back to Booking** when a valid Booking return path exists.

### Mobile

Mobile bottom navigation and menu behavior must respect the active workspace instead of always showing Booking-oriented global links.

The Command Panel control must remain readily available on small screens.

## State persistence

Workspace return context is UI navigation state, not business data.

Recommended behavior:

- store the last Booking route used to enter Marketing in `sessionStorage`;
- namespace the value, e.g. `adventure-zone:booking-return-path`;
- store only same-origin app paths;
- reject paths outside the Booking route classifier;
- clear or replace it when a new Booking → Marketing transition occurs;
- sign-out should clear it where practical;
- do not persist this state to the database.

The current workspace itself is derived from the URL and does not require server storage.

## Assistant behavior

The existing Booking Assistant remains available where helpful. The workspace shell may pass/derive active workspace context so the assistant knows whether the Administrator is currently in Booking, Marketing, or Operations.

This restructure does not require creating three independent assistants.

## Accessibility and usability

- Workspace cards are semantic links/buttons with clear names and descriptions.
- Keyboard navigation works for Command Panel and menus.
- Active workspace and active primary page use `aria-current` where appropriate.
- Mobile targets remain touch friendly.
- Workspace names remain consistent: **Booking**, **Marketing**, **Legs & Operations**, **Command Panel**, **Admin Tools**.
- Avoid jargon-heavy replacement labels.

## Error and fallback behavior

- Unknown Administrator routes still use the existing Not Found behavior.
- Missing/invalid Marketing return context falls back safely to `/today`.
- A route that cannot be classified defaults to Admin Tools/neutral navigation rather than exposing every workspace menu.
- Navigation state failures must never block page rendering or authentication.

## Testing strategy

### Route/workspace unit tests

Prove:

- `/today`, profiles, contacts, calls, bookings, schedule classify as Booking;
- routes/trips/manager operational pages classify as Operations;
- `/marketing*` classifies as Marketing;
- `/settings*` classifies as Admin Tools;
- `/command` classifies as Command Panel;
- invalid stored Booking return paths are rejected.

### Administrator navigation tests

Prove:

- successful admin sign-in lands on Command Panel;
- signed-in `/` redirects to Command Panel;
- Command Panel shows exactly the three main workspace choices;
- Booking menu does not show Legs & Operations management items;
- Operations menu does not show Booking outreach items;
- Marketing can be entered directly from Command Panel;
- Marketing can be entered from Booking while retaining the current Booking route;
- Back to Booking restores that path;
- Command Panel remains accessible from all three workspaces;
- sign-out remains available.

### Mobile tests

Prove the bottom navigation and mobile menu change by workspace and retain a Command Panel path.

### Google Workspace regression tests

The restructure must preserve the existing/admin navigation tests for Google Workspace settings/review routes and must not move profile-level Google conversations/files/calendar data out of Booking profiles.

## Non-goals

This feature does not:

- duplicate the booking database for Operations;
- create separate Gmail archives per workspace;
- create a second Google Calendar sync;
- change Office Coordinator authentication or role permissions;
- change Leg Manager authentication or role permissions;
- redesign every Booking/Operations page internally;
- implement every future Marketing campaign feature in the first navigation PR;
- rename all existing URLs merely to match workspace names.

## Completion criteria

The restructure is complete when:

- Administrator sign-in opens the three-choice Command Panel;
- Booking, Marketing, and Legs & Operations each have focused navigation;
- the user can always return to Command Panel;
- Booking can open Marketing and restore the exact prior Booking page;
- direct Marketing entry returns naturally to Command Panel;
- Admin Tools remain reachable without cluttering the day-to-day menus;
- mobile navigation respects workspaces;
- all existing shared business data remains shared;
- Google Workspace/Gmail/Calendar sync remains one shared system and continues to project data into the appropriate workspace views;
- Office Coordinator and Leg Manager portals keep their existing role boundaries;
- navigation and relevant regression tests pass.