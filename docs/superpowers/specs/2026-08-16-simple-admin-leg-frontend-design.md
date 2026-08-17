# Simple Admin + Leg Frontend Design

Date: 2026-08-16
Status: Approved design, pending written-spec review

## Goal

Redesign the Adventure Zone Command Center frontend so both Admin and Leg Manager feel dramatically simpler, especially on mobile, without removing or weakening any existing tools, permissions, workflows, records, imported ACT data, editing capabilities, schedule data, route data, or Leg Manager functionality.

The design should feel closer to a focused Five9-style work console than a traditional crowded CRM dashboard: one current task in focus, the next tasks easy to scan, and lower-frequency actions available through dropdowns and menus instead of permanently occupying screen space.

## Core product rule

**Hide complexity, not capability.**

This is primarily an information architecture and interaction redesign. Existing backend behavior and canonical records remain the source of truth. Features may move behind menus, dropdowns, sheets, or detail panels, but they must remain reachable.

The redesign must preserve:

- profiles and organizations
- notes and ACT-imported history
- call outcomes
- follow-ups, including edit/delete where permitted
- booking and event data
- event families and duplicate/merge workflows
- calendar and multi-day event behavior
- route map, route history, potential/confirmed route views, and leg filters
- Leg Manager operations
- money, receipts, mileage, cash/settlement, crew, reviews, incidents, and route issue workflows as they are implemented
- admin-only controls and manager permission boundaries
- dynamic legs and archived legs
- existing APIs and shared canonical records unless a frontend need exposes a genuine defect

No separate app or database is introduced.

## Visual direction

Use the second approved mockup as the general reference direction, not as a pixel-perfect specification.

Desired feel:

- clean light interface
- restrained use of cards
- strong spacing and hierarchy
- compact navigation
- rounded but not oversized controls
- simple status chips
- dropdown-heavy actions
- minimal permanent button clutter
- responsive layouts designed mobile-first
- the same visual language across Admin and Leg Manager

The interface should become visually quieter as features are added rather than progressively more crowded.

## Responsive navigation

### Admin primary navigation

Admin uses four primary destinations:

- Today
- Profiles
- Schedule
- Menu

On mobile, these appear as a bottom navigation bar optimized for thumb use.

On larger screens, the same destinations may appear in a compact top navigation/header rather than a persistent large sidebar.

### Leg Manager primary navigation

Leg Manager uses five primary destinations:

- Home
- Schedule
- Money
- Crew
- Menu

Mobile uses bottom navigation. Larger screens may use a compact top navigation while retaining the same mental model.

### Menu behavior

Menu is not a giant flat list.

On mobile, Menu opens as a bottom sheet. On larger screens, it may open as a dropdown/popover.

The menu immediately shows grouped section headings. Each group is collapsible using a familiar chevron/accordion interaction.

Suggested Admin groups:

- Bookings & Follow-ups
- Legs & Operations
- Imports & Data
- Reports & History
- Settings

Suggested Leg Manager groups:

- Receipts & Mileage
- Incidents & Reviews
- Route Issues
- History
- Settings

The menu may remember the last-expanded section for the current session, but this is convenience behavior only and must not create hidden state that changes permissions.

## Admin Today = Home

There is no separate Admin Home page. Today is the Admin landing screen.

Today is a work queue, not a KPI-heavy dashboard.

### Header

Keep the header compact:

- current date
- admin identity/context
- only important status indicators, such as overdue follow-ups or unresolved route issues

Do not show empty zero-value warning cards merely because a feature exists.

### Up Next

The first major section presents the next likely task.

It may include:

- contact/profile name
- organization/event context
- phone number or best contact method
- follow-up reason
- most useful recent note
- quick actions such as Call, Text/Email, and Open

Opening the record uses the shared detail-panel pattern instead of navigating away from Today.

### Follow-ups

A simple stacked work list ordered by usefulness:

1. overdue
2. due today
3. upcoming

Each row should expose enough information to act without opening the full profile, while keeping row actions compact.

### Today / Upcoming Events

Show only operationally relevant upcoming events rather than embedding a full calendar into Today.

Useful row information includes:

- date/date range
- city/location
- leg
- status
- route context where useful

### Needs Attention

This section is conditional and appears only when actionable items exist.

Examples:

- route issue
- missing/unsigned contract
- missing deposit
- overdue booking follow-up
- imported record requiring review
- post-event follow-up or other unresolved workflow item

### Recent Activity

Recent Activity remains available but visually secondary, preferably collapsed or compact near the bottom.

It may include recent:

- notes
- calls/outcomes
- edits
- imports
- follow-up changes

### Add menu

Use one compact **+ Add** dropdown/menu rather than many permanent add buttons.

It can expose actions such as:

- Add Profile
- Add Follow-up
- Add Event
- Add Note
- Add Organization

Only show actions the current user is permitted to perform.

## Shared slide-in detail panel

Profiles, events, route stops, and similar records should generally open in a detail panel so the user does not lose their place in Today, Profiles, or Schedule.

### Desktop/tablet

Use a right-side slide-in panel approximately 42-45% of the viewport width.

The underlying list/workspace remains visible enough to preserve context.

### Mobile

The same panel becomes near full-screen because a split view would be too cramped.

It must include a clear Back/Close control at the top so users can return to exactly where they were.

### Full-page escape hatch

Records still provide an **Open Full Profile** / equivalent option for deeper work.

The panel is a fast workspace, not a replacement for every detailed screen.

## Profile detail panel

The profile panel prioritizes everyday CRM work.

### Header summary

Show:

- name
- organization
- booking/contact status
- leg/status chips where relevant
- phone/email
- next follow-up

### Primary tabs

Use three simple top-level tabs:

- Overview
- History
- Events

Avoid adding more top-level tabs unless an existing feature cannot be represented cleanly inside these sections.

### Overview

Contains the most useful current profile information and editable contact fields/actions.

### History

Shows one chronological timeline containing relevant:

- notes
- call outcomes
- emails where available
- follow-ups
- edits/activity
- imported ACT history

Editing and deleting use the permissions and safety rules already defined for each record type.

Imported history must not disappear merely because the new UI combines it into one timeline.

### Events

Shows related booking/event history, event families, and relevant organization/event relationships.

### Actions dropdown

Replace button clutter with one **Actions** dropdown, grouped logically.

Suggested groups:

**Add**
- Note
- Follow-up
- Event

**Edit**
- Profile
- Contact Info
- Status

**Organize**
- Add to Organization
- Add to Event Family
- Handle Duplicate / Merge

**More**
- Open Full Profile
- Archive/Delete where permitted

The exact menu item is hidden only when genuinely unavailable by permission or record state, not merely to make the interface look cleaner.

## Profiles workspace

Profiles remains a primary Admin destination.

The default screen should favor search, filters, and a simple results list rather than dense profile cards.

Selecting a profile opens the shared slide-in panel.

The Profiles workspace must continue to provide access to:

- people/contacts
- organizations
- event families
- duplicates/merge workflows
- last-resort status/filtering where applicable
- editing profile/contact data
- notes/history/follow-ups

A dedicated back interaction remains available wherever full-page profile navigation occurs.

## Schedule workspace: Calendar + Map combined

Calendar and Routes become two views of one Admin **Schedule** workspace rather than two unrelated top-level destinations.

Do not display a large calendar and large map simultaneously by default.

### View switch

At the top of Schedule, provide a simple switch:

- Calendar
- Map

Both views share the same filter state where appropriate.

### Shared filters

Keep controls compact, primarily dropdowns:

- Season/Year
- Leg
- Status

View-specific controls appear only when needed.

### Calendar view

Calendar supports:

- Month
- Week
- Agenda where existing calendar capabilities support it
- multi-day events spanning every day of the event, not only the start date
- tap/click event to open its detail panel

Avoid dense secondary controls. Lower-frequency filters belong in dropdowns.

### Map view

The map is the main visual area.

Support the approved route modes:

- Confirmed
- Potential
- Full Route

When focusing one route state, non-selected route data should remain understandable but visually dimmed rather than disappearing when that is useful for planning.

Support:

- season/year selection
- all legs or a specific leg
- other legs dimmed when focusing one leg
- route history
- route segments between events/stops
- equipment swap/crossover planning context
- event locations/cities appearing once a leg/location is assigned

Selecting a stop opens the shared detail panel.

### Mobile Schedule

On phones, Calendar uses a full-width practical schedule view.

Map uses most of the screen, with filters in compact controls and stop/details in a draggable bottom sheet or near-full-screen detail panel.

Do not use a permanent large sidebar on mobile.

## Leg Manager Home

Leg Manager Home is operational, not CRM-like.

It answers: **What do I need for this route right now?**

### Top context

Show:

- current leg
- next event/stop
- sync/offline status when relevant

### Main stack

Use a short vertical stack of useful sections:

- Next Stop
- Today's Money
- Receipts/Mileage to Finish
- Crew
- Needs Attention

Empty sections should collapse, shrink, or disappear so the screen stays calm.

### Quick actions

Use a compact **+ Add** menu for lower-frequency creation actions rather than many large buttons.

Examples:

- Add Receipt
- Add Expense
- Add Mileage
- Report Schedule/Route Issue
- Add Incident

### Event/stop details

Selecting the next event/stop opens the shared detail pattern.

Show relevant operational information such as:

- address/location
- route details
- event notes
- crew
- income/expense summary
- review status

The manager must not gain direct editing rights to official schedule/booking data if the existing permission model restricts those edits.

## Leg Manager Schedule

Uses the same Schedule concept as Admin but is scoped to the manager's leg and permissions.

It may default to the route/next-stop oriented view rather than the Admin calendar-first view.

The manager can inspect schedule and route data, but official schedule corrections continue through the existing Report Schedule/Route Issue workflow.

## Leg Manager Money

Money remains a primary destination because it is high-frequency operational work.

The redesign should organize, not remove, the existing/planned shared financial tools:

- income
- expenses
- receipts
- cash tracking
- settlement balance
- mileage where appropriate
- route-segment financial context

Use summary-first presentation with deeper ledgers/details accessible through dropdowns or drill-in panels.

Never replace auditable ledger details with unexplained editable totals.

## Leg Manager Crew

Crew remains a primary destination.

Favor:

- search
- nearby/relevant workers
- rehire status
- prior Adventure Zone work
- concise feedback/history summaries

Selecting a worker opens a detail panel rather than requiring a separate navigation hierarchy.

Existing shared-directory visibility and leg-scoped editing rules remain unchanged.

## Dropdown and disclosure design rules

Dropdowns are a deliberate core interaction pattern for this redesign.

Use them for:

- actions
- filters
- secondary creation choices
- grouped navigation
- low-frequency tools

Do not use dropdowns for content that users must constantly compare side-by-side.

Menus should:

- use plain language
- group related actions
- place destructive actions at the bottom or in a More section
- require confirmation for destructive operations
- avoid nesting deeper than necessary
- remain usable with one hand on mobile

## Information hierarchy rules

1. Current task first.
2. Next likely tasks second.
3. Context and history available on demand.
4. Low-frequency administration behind Menu.
5. Empty status cards do not occupy premium space.
6. Do not show the same action in multiple permanent button rows unless there is a strong workflow reason.
7. Preserve the user's location in the interface when opening and closing details.
8. Prefer progressive disclosure over permanently visible controls.

## Permissions and backend safety

This redesign must not weaken server-side authorization.

- Admin retains master access according to existing authentication/authorization.
- Leg Manager remains scoped to one leg.
- Manager restrictions are enforced by the server, not only by hidden UI elements.
- Manager schedule/route corrections use issue reporting rather than silently enabling direct schedule edits.
- Archived-leg and manager-session behavior from the existing Leg Manager design remains authoritative.
- Destructive actions require deliberate confirmation.

## Data and architecture constraints

- Keep one canonical profile, organization, booking, event, route, leg, and operational record.
- Do not duplicate data merely to support panels or alternate views.
- UI panels consume existing record IDs and APIs.
- Schedule Calendar and Map are alternate presentations over the same underlying schedule/route entities.
- Admin and Leg Manager should share reusable frontend primitives where behavior is genuinely common, while preserving distinct permissions and workflows.
- Avoid a giant all-purpose component. Detail panels, menus, work queues, schedule views, and navigation shells should be independently understandable/testable units.

## Error and loading behavior

The simplified UI must remain trustworthy under poor connectivity and slow requests.

- Keep the last useful screen visible while loading detail panels where safe.
- Show clear save/sync state for Leg Manager offline-capable records.
- Failed panel/detail loads should show a retry action without dumping the user back to the home screen.
- Failed mutation actions must not optimistically disappear unless rollback is reliable.
- Preserve underlying records when receipt/photo uploads fail.
- Conflicts in offline manager edits remain surfaced rather than silently overwritten.

## Accessibility and mobile usability

- Touch targets should be comfortably tappable on phones.
- Bottom navigation must account for device safe areas.
- Dropdowns/bottom sheets must be keyboard and screen-reader navigable on supported web platforms.
- Status must not rely on color alone.
- Panels and sheets must trap/focus appropriately while open and restore focus/context when closed.
- Avoid tiny icon-only controls for important actions unless the icon is universally clear and labeled accessibly.

## Testing strategy

Implementation must include focused tests for the redesign's behavior, not only snapshots.

Test areas include:

- Admin Today is the default landing destination
- mobile versus desktop navigation rendering
- Menu groups expand/collapse correctly
- permitted tools remain reachable after navigation simplification
- profile panel opens/closes without losing list/work-queue context
- mobile profile panel uses near-full-screen behavior
- desktop panel uses the intended split-context behavior
- profile History includes existing notes/call outcomes/follow-ups/ACT history
- profile Actions menu respects permissions and record state
- Calendar/Map switch preserves relevant shared filters
- multi-day calendar events span their full date range
- Map route-mode dimming/focus behavior
- leg/season filters continue to work
- manager views never expose another leg's private data
- manager schedule correction continues through route-issue reporting
- conditional Today/Home sections do not render useless empty cards
- destructive menu actions retain confirmations
- offline/sync states remain visible where required

Critical authorization behavior remains tested at server/domain level, not only through frontend visibility tests.

## Migration / rollout approach

Treat the redesign as an incremental frontend migration rather than a big-bang replacement.

Recommended sequence:

1. shared responsive app shell and navigation
2. Admin Today work queue
3. shared slide-in detail panel and Profile integration
4. Profiles workspace cleanup
5. combined Schedule workspace
6. Leg Manager shell/Home alignment
7. Leg Manager Schedule/Money/Crew cleanup
8. consolidate lower-frequency tools into grouped menus
9. regression pass proving no existing tool or permission path was lost

Where practical, preserve existing routes during migration so old deep links and bookmarks do not immediately break. Redirect or alias routes only after the destination behavior is verified.

## Explicit non-goals

This redesign does not, by itself:

- remove existing features
- create a second Leg Manager application
- change the canonical database model
- grant managers new admin permissions
- replace existing ledger/audit behavior with prettier totals
- remove ACT-imported history
- eliminate full profile pages
- require every feature to use a card
- implement new external integrations solely for visual completeness

## Success criteria

The redesign is successful when:

- Admin can open the app and immediately work from Today without navigating through a dashboard maze.
- A common follow-up can be completed from Today plus a detail panel without losing place.
- Profiles remain fully capable but visually calm.
- Calendar and Map feel like two simple views of the same Schedule workspace.
- Leg Manager can operate primarily from Home, Schedule, Money, Crew, and Menu on a phone.
- Lower-frequency tools are easy to find through grouped dropdowns rather than permanently crowding the screen.
- Empty or irrelevant cards no longer dominate the interface.
- Existing tools, records, permissions, and important workflows remain reachable and functional.
- The interface feels simpler after feature growth instead of progressively more crowded.
