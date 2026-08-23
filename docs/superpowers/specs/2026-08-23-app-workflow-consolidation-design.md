# Adventure Zone Command Center Workflow Consolidation Design

## Status

Approved architecture captured from the August 23, 2026 app audit. This document defines what should be consolidated before any route or page implementation begins.

## Goal

Reduce redundant pages and competing workflows so each common job has one clear destination, while preserving useful functionality and keeping old URLs working through quiet redirects.

## Core principle

One user job should have one canonical workspace.

If two pages answer the same user question, they should become one page with focused modes, tabs, drawers, or contextual actions instead of remaining separate destinations.

Retiring a page does **not** mean deleting useful behavior. Useful behavior moves first, internal links are updated to the canonical destination, and legacy URLs remain as compatibility redirects.

## Canonical admin workspaces

### Today

Purpose: decide what needs attention now.

Today surfaces priorities and next actions, then deep-links into the workspace where the work is actually completed. It should not become a duplicate of Calls, Bookings, Profiles, Schedule, or Research.

### Bookings

Purpose: manage the booking pipeline, contracts, probabilities, next steps, and booking-specific work.

The list page remains a work queue. Detailed booking actions stay on booking detail pages rather than expanding the list into a giant workspace.

### Profiles

Purpose: serve as the central CRM directory and record hub for events, organizations, locations, and contacts.

Profiles owns discovery and search across those records. Contacts remain real records with their own detail/edit pages, but **All Contacts** stops competing as a major top-level destination.

Profiles should offer simple directory modes or filters such as Events / Organizations / Contacts while retaining a unified default search.

### Calls

Purpose: own the complete calling workflow.

The canonical flow is:

1. Find caller by phone, name, event/profile, or other supported identifiers.
2. Review possible matches.
3. If no usable match exists, add the caller inline without leaving Calls.
4. Open the selected caller/profile context.
5. Use guided scripts and prior context.
6. Place/log the call.
7. Record outcome, notes, and follow-up.

The existing CallerFinder and calling workspace should be reused. A separate Quick Add Caller destination should not survive as an independent workflow.

### Schedule

Purpose: answer when and where booked/potential work happens.

Schedule is the single user-facing destination for:

- Calendar view
- Route/map view
- shared season, leg, and status filters

Operational **leg management** remains under Operations because editing leg structure is different from viewing scheduled routes.

### Research

Purpose: discover new opportunities.

Research does not grow its own mini-CRM. When an opportunity is worth pursuing, it hands data into the canonical Add Event / Lead flow.

### Office Coordinator

Purpose: Amy's role-specific Office Coordinator workflow.

This remains separate because it represents a different permission/work lane rather than a duplicate admin page.

### Operations

Purpose: run operational business functions.

Operations groups related destinations such as:

- Legs / leg management
- Crew
- Finance
- Communications
- Reviews / incidents / route issues

These remain focused pages under one operational workspace rather than being flattened into one oversized screen.

### Admin Tools

Purpose: system maintenance, imports, recovery, business setup, and integrations.

Admin Tools remains grouped into:

- Data & Imports
- Business Setup
- Connections
- System

Specialized tools such as ACT Import, ACT Recovery, Paper Notes, Attendance History, Business Sources, Packages/Resources, templates, and Google Workspace remain distinct because they perform genuinely different maintenance jobs.

## Canonical route map

### Calls

Canonical full calling route:

`/calls/workspace`

Legacy/secondary behavior:

- `/calls/new` → redirect to `/calls/workspace`, preserving relevant query parameters.
- `/quick-add` → redirect to `/calls/workspace?mode=add`, preserving supported phone/query parameters.
- `/calls/mobile` → redirect to `/calls/log`, preserving context parameters.
- `/calls/log` remains the lightweight/mobile log mode when the full assisted workspace is unnecessary.

The Calls workspace must support the missing-caller creation flow before `/quick-add` is retired.

### Schedule

Canonical route:

`/schedule`

Legacy routes:

- `/calendar` → `/schedule`
- `/routes` → `/schedule?view=map`

Query parameters that still have meaning, such as season, leg, and status, should be carried forward.

The existing CalendarContent and RoutesContent implementations should continue to power the two Schedule views rather than being duplicated.

### Profiles

Canonical directory:

`/profiles`

Canonical profile detail:

`/profiles/:profileId`

Legacy routes:

- `/organizations` → `/profiles`
- `/event-profiles/:id` → `/profiles/:id`

Contact detail/edit routes may remain because individual people are real linked records:

- `/contacts/:id`
- `/contacts/:id/edit`

The standalone `/contacts` directory should stop being a prominent navigation destination. Its useful search/list functionality should be available from Profiles before it is retired or redirected.

### ACT migration

Canonical route:

`/settings/act-migration`

Legacy route:

- `/act-migration` → `/settings/act-migration`

ACT Recovery remains separate at `/settings/act-recovery` because import and recovery are different jobs.

## Creation flows

### Add Event / Lead

Keep the existing Add Event / Lead workflow as the canonical event/profile intake flow.

Other pages should hand prefilled data into this flow rather than creating their own parallel event-creation experiences.

It continues to support existing event/profile selection, contacts, families/organization context, location, booking details, travel leg, research source context, and dates where available.

### Add Contact

Keep the full Add Contact form for detailed manual entry.

It is no longer treated as a competing main workspace. It should be launched contextually from Profiles or other relevant records.

### Add caller from Calls

Calls gets a lightweight create-caller mode for the case where search finds no usable existing record.

This flow should:

- show duplicate candidates before creation;
- collect only the minimum useful caller/contact data needed to continue;
- create/link the record using the existing quick-caller backend behavior where appropriate;
- return directly to the selected caller in the Calls workspace;
- offer access to the full contact/profile afterward rather than forcing full CRM entry before a call can continue.

## Pages that stay distinct

The following should **not** be merged merely to reduce page count:

- Today and Bookings
- Bookings and Profiles
- Research and Profiles
- Office Coordinator and the admin Booking workspace
- Manager portal and admin Operations screens
- Admin Tools and normal daily workspaces
- Booking detail and profile detail
- Contact detail and profile detail
- ACT Import and ACT Recovery
- Paper Notes and Attendance History

They may share components/data, but they answer different user questions.

## Navigation rules

The normal admin experience should emphasize these primary work destinations:

- Today
- Bookings
- Profiles
- Calls
- Schedule
- Research

Role/workspace navigation handles Office Coordinator, Operations, and Marketing as appropriate.

Admin Tools remains under More/settings-style navigation rather than competing with daily workflow pages.

Navigation must point directly at canonical routes. Legacy redirects are backward compatibility only; new internal links should not continue generating obsolete URLs.

## Redirect behavior

Legacy routes must redirect quietly without presenting an error or interstitial.

Redirects should preserve relevant context/query parameters whenever the canonical destination supports them.

Examples:

- `/calls/new?contactId=...&bookingId=...` → `/calls/workspace?contactId=...&bookingId=...`
- `/quick-add?phone=...&q=...` → `/calls/workspace?mode=add&phone=...&q=...`
- `/routes?season=2027&leg=...` → `/schedule?view=map&season=2027&leg=...`
- `/event-profiles/<id>` → `/profiles/<id>`

Old bookmarks and links remain usable, but automated tests should prevent new code from reintroducing obsolete internal destinations.

## Surviving-page organization guardrails

Consolidation must not turn the surviving pages into giant undifferentiated screens.

Use focused modes and progressive disclosure:

- Calls progresses from finder/add mode into caller workspace.
- Profiles uses record-type filters/modes rather than separate directories.
- Schedule uses Calendar / Route view switching with shared filters.
- Operations groups focused subpages instead of one enormous page.
- Admin Tools groups specialized maintenance pages instead of flattening them together.

List/index pages should answer "what should I open?"; record/detail pages should answer "what can I do with this record?"

## Internal-link cleanup

As each legacy destination is retired:

1. Identify all internal links that still generate it.
2. Replace them with the canonical route.
3. Keep the old route only as a redirect.
4. Add a route/link contract test so new code does not drift back to the retired path.

This applies to links generated from Today, profiles, call actions, booking pages, menu items, buttons, assistant-generated navigation, and other app surfaces.

## Backend scope

This project is primarily a frontend/navigation and workflow consolidation.

Existing backend services should be reused unless a surviving workspace needs a small orchestration change, such as exposing the existing quick-caller creation behavior directly inside Calls.

Do not merge unrelated database models simply because their frontend discovery is consolidated. Contacts, organizations, bookings, events, routes, and timeline records retain their existing data responsibilities.

## Migration strategy

Implementation should be phased so each step leaves the app usable:

1. Establish canonical route constants/redirect behavior and regression tests.
2. Consolidate Calls finder + quick-add behavior before retiring `/quick-add`.
3. Consolidate Schedule destinations around `/schedule`.
4. Consolidate Profiles discovery and remove All Contacts from primary navigation.
5. Normalize profile and ACT migration aliases.
6. Replace remaining internal legacy links.
7. Remove page files that are no longer real destinations only after redirect and feature coverage are proven.
8. Run route/navigation, calling, profile, schedule, typecheck, and production builds before merge.

Each phase should be independently reviewable; do not perform a blind mass-delete of page files.

## Success criteria

The consolidation is successful when:

- common jobs have one obvious destination;
- Find Caller and Quick Add Caller no longer feel like separate pages;
- Calendar and Route browsing live under Schedule;
- Profiles is the central CRM discovery surface, including contacts;
- duplicate route aliases no longer appear in internal navigation;
- old bookmarks still work via redirects;
- useful functionality from retired pages is preserved;
- role-specific Office/Manager workflows remain intact;
- the app has tests that guard canonical navigation and redirect behavior;
- no source business data or CRM records are altered merely because navigation changed.

## Non-goals

This project does not:

- redesign every surviving page visually;
- merge distinct CRM database entities;
- remove specialized admin/recovery tools;
- change Office Coordinator or Manager permission boundaries;
- replace the existing calling, scheduling, or profile backend systems wholesale;
- delete compatibility routes before their canonical destination supports the needed behavior.
