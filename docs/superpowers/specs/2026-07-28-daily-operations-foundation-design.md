# Adventure Zone Daily Operations Foundation — Design

**Date:** 2026-07-28  
**Owner:** Desiree  
**Status:** Approved design awaiting written-spec review  
**Implementation scope:** Phase 1 daily CRM, calling, packages, resources, trips,
routes, and fuel estimates

## 1. Purpose

Expand Adventure Zone Command Center into the daily workspace used to answer
calls, follow up with organizations, build bookings, organize the nine travel
legs, assign attractions, and estimate route fuel costs.

The application keeps the depth of an everyday CRM underneath a simple
call-first workflow. A first-time caller should be able to record useful
information without understanding every field in Act!, while an experienced
user can open the full contact, organization, booking, trip, and activity
history.

Act! remains connected through explicit, reviewed synchronization. The shared
Act! account is never changed automatically.

## 2. Scope and Delivery Boundaries

This design deliberately separates the work into three phases.

### Phase 1 — this specification

- Nine editable, reorderable, archivable travel legs
- Trip and route planning with real-road distance and drive-time estimates
- Whole-trip and per-segment fuel estimates
- Contact and organization notes in an editable activity timeline
- Organization/event-level Last Resort status
- A Five9-inspired Call Workspace without telephone-provider integration
- Multiple packages on one booking
- Shared physical-attraction totals and package attribution
- Attraction, equipment, and paintball-trailer assignments
- Availability, overlap, and transfer-time warnings
- A focused Today dashboard for everyday work

### Phase 2 — separate specification and implementation plan

- Reviewed two-way Act! calendar synchronization
- Approved writeback of call notes and activities to Act!
- Analysis of email/history already recorded in Act!
- Source-linked suggestions for contact, booking, and follow-up updates
- Explicit approval before any suggestion changes local or Act! data

Phase 2 does not directly connect to Gmail or Outlook.

### Phase 3 — separate specification and implementation plan

- Google Calendar connection
- Telephone-provider connection for real incoming/outgoing calls and automatic
  caller screen pops

The Phase 1 Call Workspace and calendar models must expose stable boundaries so
these later connectors can reuse them rather than replace them.

## 3. Approaches Considered

### Copy all of Act! and Five9 at once

This would provide many features but would create a crowded interface, duplicate
specialized marketing and call-center administration, and delay the booking and
route tools that Adventure Zone actually needs.

### Add each feature directly to the existing pages

This would be faster initially but would tangle calling, contact history,
packages, equipment, and routing. Future Act!, Google Calendar, and telephone
connections would then require rewrites.

### Shared operational foundation with focused modules — selected

Command Center adds small domain modules for activities, calls, packages,
resources, trips, routing, and estimates. The daily screens combine those
modules, while each module keeps one clear responsibility and a stable
interface for later integrations.

## 4. Product Principles

1. **Simple on the surface.** Answering a call requires only the fields needed
   during that conversation.
2. **Full history underneath.** Contacts, organizations, bookings, calls,
   notes, emails, calendar items, and changes remain accessible from the full
   CRM record.
3. **Manual external effects.** No call, email, calendar write, or Act! change
   occurs without a deliberate user action and review.
4. **No after-hours automation.** The application does not call, email, or send
   work reminders outside the app. Waiting work appears when the app is opened.
5. **Real resources, not package labels.** Availability is calculated from the
   physical attractions and equipment assigned to a booking.
6. **Recommendations remain recommendations.** The app may suggest route order,
   package attribution, and follow-up actions, but the user makes the final
   choice.
7. **History is preserved.** Legs are archived, not deleted. Edited notes retain
   revisions. Important changes are audited.
8. **Private by default.** Contact, contract, route, resource-location, and
   internal note information is never public by default.

## 5. Information Architecture

The main navigation remains compact:

1. **Today**
2. **Bookings**
3. **Contacts**
4. **Calendar**
5. **Routes**
6. **Settings**
7. **Quick Add**, always available

Equipment, package, vehicle, fuel, and integration administration live under
Settings or contextually inside a booking/trip instead of adding more permanent
navigation items.

## 6. Today Dashboard

Today is the default screen and shows only work that needs attention:

1. Overdue and due-today follow-up calls
2. The next recommended call
3. Today's events and trips
4. Contracts or special requests awaiting approval
5. Important route, attraction, or trailer conflicts
6. Pending Act! review work
7. Active leads without a dated next action

The dashboard does not become a general analytics page. It links directly into
the Call Workspace, booking, trip, or review item needed to complete the task.

## 7. CRM Records and Activity Timeline

### 7.1 Organization and contact records

The organization represents the customer/event account. Contacts are people
associated with that organization. A contact record includes normal identity,
role, phone, email, address, Act! link state, bookings, and activity history.

The organization record includes:

- Name and location
- Associated contacts
- Events and bookings
- Notes and activity history
- Last Resort status, reason, and date
- Suitable or previously used travel legs
- Package history
- Next action

### 7.2 Activity timeline

Notes become dated activities rather than one long text field. Timeline activity
types include:

- Call
- General note
- Follow-up
- Status change
- Booking update
- Contract/proposal update
- Calendar item
- Act! email/history item
- Approved suggestion

Activities show the newest useful information first. Editing an activity creates
a revision; the main timeline shows the current text and a collapsed **View edit
history** action. Large edit histories do not expand automatically.

### 7.3 Last Resort

Last Resort replaces separate “do not call” and “last resort” lists.

- It applies to the organization/event account, not only one contact person.
- Every associated contact and booking displays the inherited warning.
- Moving an organization to Last Resort requires a reason or note.
- The action is available from the Call Workspace and full organization record.
- Last Resort organizations remain searchable and can be filtered by leg.
- The app never calls them automatically.
- Removing the status is audited and requires a deliberate action.

## 8. Quick Add and Call Workspace

### 8.1 Quick Add

Quick Add supports:

- New caller/contact
- New organization/event
- Call note
- Follow-up
- Booking
- Trip or route stop

The initial New Caller flow asks only for:

- Name
- Organization/event
- Phone or email
- Reason for calling
- Optional event date/location

The record can be completed later.

### 8.2 Opening the Call Workspace

In Phase 1, the Call Workspace opens from:

- A Today follow-up
- A contact or organization
- A booking
- Search by phone number
- Quick Add

There is no live telephone connection in Phase 1. The later telephone connector
will open this same workspace with caller-number context.

Phone matching behavior:

- One exact normalized match opens the matching record.
- Multiple possible matches show a chooser.
- No match opens New Caller without discarding the phone number.

### 8.3 Single-screen call layout

The workspace shows:

- Contact and organization identity
- Phone number and location
- Last Resort warning
- Current booking status and follow-up
- Compact recent activity history
- Editable call note
- Event date, location, leg, and package information
- Attraction or special requests needing approval
- Route/fuel and resource warnings relevant to the booking
- A link to the full CRM record

The workspace does not expose all CRM fields at once.

### 8.4 Call result

Ending a call saves the note, result, next action, and approved record updates
together. Available results are:

- No answer
- Left voicemail
- Follow-up needed
- Interested
- Proposal/contract sent
- Booked
- Declined
- Move to Last Resort

Active opportunities must still have a dated next action. Selecting Move to Last
Resort asks for confirmation and a reason before applying the organization-level
status.

Phase 1 does not include predictive dialing, call recording, transcription,
agent monitoring, or telephone controls.

## 9. Bookings, Packages, and Requests

### 9.1 Package templates

Initial package templates are:

- **Adventure Zone:** base of 10 attractions
- **Weekend Warriors:** base of 5 adrenaline attractions
- **Pirates Rebellion:** base of 3 attractions

Templates provide defaults and sales labels. They are not independent physical
inventories.

### 9.2 Multiple packages and shared total

A booking may select more than one package.

- Package counts are not summed automatically.
- The booking has one separate, manually adjustable physical-attraction total.
- A multi-package booking normally uses 10–12 total attractions.
- The UI displays both values, for example **2 packages · 11 attractions**.
- Each physical attraction counts once even if it contributes to more than one
  selected package.
- The app infers package attribution from attraction tags.
- The user can override the inferred attribution for the booking.

For a single-package booking, the template base count is the initial suggestion.
For a multi-package booking, the app suggests 10 total attractions and the user
can adjust it within the normal 10–12 range. Counts outside the normal range
remain possible with an approval reason.

### 9.3 Specific attraction requests

There are no automatic à-la-carte bounce-house additions. A requested specific
attraction is recorded with one manually selected treatment:

- **Add to count**
- **Replace an included attraction**
- **Note only**

The request remains marked **Needs approval** until approved or declined.
Paintball can count as the Weekend Warriors part of a combined booking while
still counting only once in the shared physical total.

### 9.4 Booking editor

The booking editor supports:

- Organization/event and primary contact
- Dates, location, and venue
- Status and probability
- One travel leg and one trip
- Multiple selected packages
- Shared attraction total
- Assigned physical attractions/equipment
- Special requests and approval state
- Contract/proposal state
- Notes, activities, and next action

## 10. Resources and Paintball Trailer

Physical resources include attractions, trailers, vehicles, generators, and
other movable equipment. Each resource can store:

- Name and category
- Package tags
- Normal leg/location
- Movable status
- Setup and teardown time
- Transfer constraints
- Availability/maintenance state
- Booking and trip assignments

The paintball trailer is an independently movable shared resource.

Warnings appear when:

- A resource is assigned to overlapping bookings
- The paintball trailer is needed on two legs with insufficient travel time
- A transfer trip has not been planned
- The current or expected resource location is unknown
- Assigned physical attractions do not match the booking total

Warnings do not silently move equipment. An authorized manual override requires
a reason and is audited.

## 11. Travel Legs, Trips, Routes, and Fuel

### 11.1 Configurable legs

The system starts with nine active legs named **Leg 1** through **Leg 9**.

Each leg has:

- Name
- Color
- Sort order
- Active or archived state
- Base address
- Default vehicle
- Default MPG
- Assigned attractions/equipment

Users can add, rename, recolor, reorder, and archive legs. There is no fixed
maximum and no hard deletion through the normal UI. Archived legs remain on
historical bookings and trips but are excluded from new-booking choices by
default.

### 11.2 Trip model

A trip is a dated route instance for one travel leg. It includes:

- Leg and date range
- Start/end base
- Ordered booking stops
- Vehicle and MPG snapshot
- Fuel-price snapshot
- Assigned resources
- Per-segment and total route estimates
- Manual overrides and notes

Trips begin and end at the leg's base unless the user deliberately changes the
start or end for that trip.

### 11.3 Route suggestion and confirmation

The app requests real-road distance and estimated drive time from a routing
provider. It suggests an efficient stop order using:

- Event dates and operating windows
- Base location
- Road distance and drive time
- Setup/teardown assumptions
- Assigned resources and trailer transfers

The user can drag stops into a different order. The application never changes a
confirmed route automatically.

Previously calculated segments are cached. They are recalculated when relevant
addresses, stop order, provider assumptions, or an explicit refresh changes the
route.

If the routing provider is unavailable, the app uses a labeled cached estimate
when available or allows manual miles/time. It never substitutes straight-line
distance without labeling it.

### 11.4 Fuel estimates

Fuel cost is calculated from:

`route miles ÷ MPG × fuel price per gallon`

The app shows:

- Mileage, gallons, and cost for each route segment
- Mileage, gallons, and cost for the whole round trip
- The active vehicle MPG and fuel price
- Whether an estimate is live, cached, or manually overridden

Fuel price and MPG can be changed for each trip without rewriting historical
estimates or the leg defaults. Per-segment miles/time can also be manually
overridden when operational knowledge is more accurate.

## 12. Architecture and Module Boundaries

The existing Next.js App Router, TypeScript, PostgreSQL, Drizzle ORM, Clerk
authentication, audit, and repository/service patterns remain.

New work is divided into focused modules:

- **Activities:** timeline entries, edits, revisions, and display queries
- **Calls:** call-session draft, disposition, follow-up, and atomic completion
- **Organizations:** Last Resort and organization-level CRM summary
- **Packages:** templates, booking selections, shared totals, attribution, and
  requests
- **Resources:** inventory, assignments, availability, and conflict detection
- **Trips:** trip dates, ordered stops, leg association, and snapshots
- **Routing:** provider interface, route cache, suggestions, and manual overrides
- **Fuel:** deterministic estimate calculations and presentation
- **Integrations:** Act!, later Google Calendar, and later telephone adapters

UI pages call domain services rather than directly implementing business rules.
External providers are behind narrow interfaces so tests can use deterministic
fakes and a provider can be replaced without rewriting booking or trip logic.

## 13. Data Model Direction

The implementation plan will translate these concepts into migrations:

- Expand `travel_legs` to support unlimited active/archived legs, base
  information, vehicle, and MPG defaults.
- Add organization Last Resort fields and an auditable reason.
- Add activities and activity revisions.
- Add call sessions/dispositions linked to contacts, organizations, bookings,
  and follow-ups.
- Add package templates and a many-to-many booking/package selection.
- Add booking attraction totals, package attribution overrides, and special
  requests.
- Add physical resources and booking/trip assignments.
- Add trips, ordered stops, route segments, and estimate snapshots.
- Add cached routing results keyed by normalized origin, destination, and
  provider assumptions.

Existing booking, contact, Act! link, follow-up, and audit identities are
preserved. Migrations must backfill safely rather than recreate or discard
existing data.

## 14. Error Handling and Safety

- Every server action requires the existing owner authorization check.
- Inputs are parsed and validated server-side.
- Act! and future provider credentials remain server-only and out of logs,
  audit payloads, and client bundles.
- External-provider errors are sanitized for the UI while retaining actionable
  server diagnostics.
- Route, resource, and package warnings remain visible until resolved,
  approved, or explicitly dismissed with an audited reason.
- Completing a call is transactional for local data: note, disposition, and
  follow-up either save together or remain editable.
- Failed external synchronization never discards local work.
- Email/history text introduced in Phase 2 is rendered as text, not trusted
  HTML.
- New migrations include preflight checks and rollback/restore guidance before
  production deployment.
- No destructive bulk action is added without a preview and explicit
  confirmation.

## 15. Testing and Acceptance

### Unit tests

- Call disposition and next-action requirements
- Phone normalization and one/multiple/no-match behavior
- Last Resort inheritance and confirmation
- Package defaults, multi-package shared totals, and out-of-range approval
- Attraction package inference and manual override
- Add/replace/note-only request behavior
- Resource overlap and paintball transfer warnings
- Stop ordering and confirmed-route immutability
- Per-segment and total fuel calculations
- Active versus archived leg rules

### Integration tests

- Safe migrations from the current four-leg constraint to nine active legs
- Preservation of existing leg, booking, contact, and Act! data
- Activity revisions and audit entries
- Atomic call completion
- Booking/package/resource repository behavior
- Trip/segment persistence and routing-cache invalidation
- Authorization on every new mutation

### Component and end-to-end tests

- Quick Add to New Caller to saved follow-up
- Today follow-up to Call Workspace to completed result
- Unknown and duplicate phone-match flows
- Multi-package booking with 10–12 shared attractions
- Special-request approval
- Add, reorder, archive, and restore a leg
- Suggested route followed by manual reorder
- Whole-trip and per-segment fuel estimates
- Paintball-trailer conflict and acknowledged override
- Responsive phone and desktop layouts
- Keyboard navigation, labels, focus behavior, and readable warnings
- Cached/manual routing fallback

### Phase 1 acceptance

Phase 1 is accepted when the user can:

1. Open Today and immediately see the calls and warnings that need attention.
2. Complete a call without leaving one focused workspace.
3. Find the full editable contact/organization history when needed.
4. Create a booking with multiple package labels and one correct physical
   attraction total.
5. Assign real resources and see paintball/availability conflicts.
6. Create and edit any number of legs, beginning with nine.
7. Build a round trip, inspect each segment, reorder it manually, and understand
   the mileage, drive-time, gallons, and fuel-cost estimates.
8. Use the app normally when Act! or the routing provider is temporarily
   unavailable.

## 16. Explicit Non-Goals for Phase 1

- Predictive or automatic dialing
- Call recording or transcription
- Real incoming-call screen pops
- Call-center workforce monitoring
- Direct Gmail or Outlook access
- Automatic email analysis
- Act! calendar/history synchronization
- Google Calendar synchronization
- Automatic route rearrangement
- Automatic equipment movement
- Automatic external messages or after-hours reminders
- Rebuilding Act! marketing, accounting, or remote-administration features
