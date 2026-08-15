# Leg Manager Portal Design

Date: 2026-08-15
Status: Proposed for user review

## Goal

Add a mobile-first Leg Manager Portal inside Adventure Zone Command Center. Each travel leg has one manager and one leg-scoped password. The manager can see and manage only the operational information for that leg, while Adventure Zone admin users keep a master view across every leg.

The portal must use the existing bookings, calendar, routes, events, organizations, and travel-leg records as the shared source of truth. It is not a second disconnected app or database.

## Core product model

The system has two views over the same underlying data:

- **Admin Command Center:** full access to all legs, bookings, routes, crews, finances, reviews, incidents, and archived history.
- **Leg Manager Portal:** restricted to one leg for operational work, with shared read access to the crew directory and historical crew feedback.

A leg manager does not need a Clerk account or individual employee account. Each leg has one password-based manager access session. Employees who help the manager can be mentioned in notes or selected on records, but they do not require their own login.

## Travel legs

Travel legs must be dynamic records, not a fixed Leg 1-9 model.

- Admin can create as many legs as needed.
- Existing references must use actual leg IDs rather than hard-coded leg numbers or nine-leg arrays.
- Legs can be Active or Archived.
- Archived legs disappear from normal current-operation views but retain all historical data.
- Admin gets a clear **View Archived** control, plus **Restore Leg**.
- Archiving a leg immediately disables that leg's manager access.
- Restoring a leg does not silently restore an old manager session; admin can set or reactivate credentials deliberately.

## Leg manager authentication and security

Each leg has one manager password.

- Passwords are stored as secure hashes, never plaintext.
- Successful login creates a secure, leg-scoped session.
- Every manager API request is authorized against the session's leg ID on the server. UI hiding alone is never treated as security.
- A manager can never fetch or mutate another leg's private operational or financial data by changing a URL or request payload.
- Admin can change/reset a leg password and **Sign Out All Devices**.
- Changing the password invalidates old manager sessions.
- First login on a device requires internet access.
- Existing admin authentication remains separate and keeps master access.

## Calendar, routes, seasons, and trips

The existing schedule is the source of truth.

- When an event is scheduled and assigned to a leg, it automatically appears in that leg's portal.
- Changes to the event date, location, route, or assigned leg propagate to the portal rather than creating a second copy.
- The portal automatically groups operational history into practical seasons/trips based on scheduled event and route dates.
- Admin can override trip/season grouping when an unusual route does not fit the automatic grouping.
- Historical seasons remain viewable.
- Route segments are derived between scheduled stops so expenses and mileage can be reviewed as `Event A -> Event B`.

Leg managers can view the official schedule but cannot directly edit bookings, official event dates, organizations, or route assignments.

### Report Schedule/Route Issue

Managers get a dedicated workflow for schedule problems instead of direct edit access.

A report can include:

- wrong date/time
- wrong address/location
- wrong leg assignment
- route problem
- event details changed
- other
- written notes
- optional photo/document

The report appears for admin review and correction. Once admin corrects the source record, the manager portal receives the synchronized result.

## Mobile-first and offline behavior

The manager portal is designed primarily for phones and unreliable fairground/travel connectivity.

Managers can create operational entries while offline, including receipts, expenses, mileage, notes, event reviews, incidents, and route issues.

The device keeps a local working cache for the manager's current leg and route. New or edited records have an explicit state:

- Saved offline
- Syncing
- Synced
- Needs attention

Photos may upload separately from their associated data entry so a slow image upload does not block the rest of the record.

If admin and the offline manager edit the same record, the system must surface a conflict instead of silently overwriting one side. Schedule records remain admin-owned, so manager-side schedule conflict handling is primarily handled through the route-issue workflow rather than direct schedule edits.

## Manager home screen

The portal home screen should answer "what do I need right now?" rather than mirror the admin CRM navigation.

The home view includes:

- leg name and manager identity/context
- next scheduled event and route/location
- offline/sync status
- event/place income total
- expenses/receipts summary
- mileage summary
- cash on hand
- manager/Adventure Zone settlement balance
- crew snapshot
- incidents needing follow-up
- event reviews still due
- quick actions for receipt, expense, mileage, incident, and schedule issue

Primary navigation stays compact. Recommended top-level areas are Home, Events/Route, Money, Receipts, Crew, and More, with lower-frequency trackers under More.

## Event/place income tracking

Each scheduled event/place can track how much the leg brought in.

Income can include:

- cash collected
- Square/card sales
- other income/payment methods as needed

Each event gets its own total and the totals roll into route segment, trip/season, leg, and admin summaries.

### Square integration

For the first version, Square is manual/frontend-supported only.

The UI and data model should expose the fields that a future Square API integration will populate, but no fake or incomplete live Square connection should be presented as working.

Later, the real Square API can populate the same sales fields without redesigning the portal.

## Expense and purchase tracking

Managers can record leg expenses with categories such as:

- fuel
- food/eating out
- RV parks
- vehicle maintenance
- trailer maintenance
- supplies
- employee-related expense
- other

Each expense records how it was paid:

- Adventure Zone cash
- Adventure Zone debit card
- manager's personal money

The payment method drives the settlement math automatically.

Optional fields can identify an employee involved in a purchase or activity, but the manager remains the person entering and responsible for the record.

## Receipts and route-segment receipts

Receipts are first-class records, not just generic attachments.

Managers can:

- take a receipt photo with the phone camera
- upload an existing image
- attach it to an expense
- associate it with an event, route segment, or trip/season
- save it offline and sync later

Route segments show their own receipt/expense breakdown, for example `Event A -> Event B`, with totals for fuel, food, RV park, maintenance, supplies, and other expenses.

Admin and manager views should surface missing-receipt warnings for expenses that should have proof attached.

### Receipt scanning

Receipt scanning is a supported later capability.

When available, scanning should suggest:

- merchant
- date
- total
- tax
- likely category

The manager must confirm or correct extracted values before saving. The original receipt image remains attached even after extraction. Offline capture must not depend on OCR being available; scanning can occur after reconnecting.

## Cash tracking

The portal tracks both cash income and what happened to that cash afterward.

Cash flow includes:

- cash collected at events
- cash used for approved expenses
- cash turned in to Adventure Zone/owner
- cash still on hand
- cash advances received from Adventure Zone
- cash returned

The manager and admin should be able to reconcile the expected cash balance against the recorded cash on hand.

## Owner/manager settlement tracker

The portal maintains a running exchange balance between the leg manager and Adventure Zone owner.

Core outcomes are:

- Adventure Zone owes manager
- Manager owes Adventure Zone
- Settled / $0 net balance

Examples:

- An approved expense marked **Paid personally** increases the amount Adventure Zone owes the manager.
- A company debit-card expense is recorded as a company expense but does not create a personal reimbursement.
- A cash advance to the manager increases the amount the manager must account for until it is spent on valid company expenses, returned, or otherwise reconciled.
- Cash turned in reduces cash on hand without being treated as an expense.

The detail ledger must remain visible so the final number can always be explained rather than being an unexplained calculated total.

## Mileage tracker

Managers can log mileage by route segment and/or trip.

Mileage entries can include:

- start and end locations
- odometer start/end or entered miles
- date
- vehicle/trailer context where relevant
- notes

Mileage totals roll up by route segment and trip/season.

No payroll or wage calculation is included.

## RV parks, food, and maintenance

RV parks, food/eating out, and vehicle/trailer maintenance are tracked as useful operational categories with optional specialized details rather than separate disconnected accounting systems.

For example:

- RV parks can store park name, dates, cost, location, and notes.
- Food can be associated with the route segment/event and receipt.
- Maintenance can identify the vehicle/trailer, issue, service provider, cost, notes, and receipt.

All of these still flow through the common expense, receipt, cash, and settlement logic.

## Crew directory

The portal includes a shared Adventure Zone seasonal-worker directory. This is intentionally lightweight and does not include payroll.

A worker profile can include:

- name
- phone/contact information
- home city/area/location
- roles/jobs performed
- Rehirable / Undecided / Do Not Rehire status
- manager notes
- event and leg work history
- manager/event feedback history

Managers can add a local worker hired for a single event. That worker then remains searchable for future routes and years.

All leg managers can search and view the shared worker directory and previous work feedback. Managers can add/edit the work history and notes created by their own leg; admin can edit everything.

A **Do Not Rehire** status is a warning, not a technical lockout. A future manager may still choose to hire the person after reviewing the previous notes.

There is no separate hidden "sensitive notes" permission model. If a manager needs to flag sensitive content, they may label it as sensitive in the note itself.

### Location-based crew reuse

The crew directory should make it easy to find people near upcoming route locations.

A manager preparing for an event can search workers near that area and see whether they previously worked an Adventure Zone event, which leg used them, the manager's notes, and their rehire status.

## Event aftermath and rating system

After a scheduled event ends, it becomes a post-event review task for the leg manager.

The review supports:

- 0-5 star event rating
- written feedback
- organizer/site notes
- crew notes
- whether the manager recommends returning
- optional photos/documents
- incidents/issues associated with the event

The portal should surface a count such as **2 events still need reviews** so aftermath work is not forgotten.

Event reviews synchronize back into the admin event/profile history so future booking decisions can combine CRM history with firsthand operational experience.

Ratings are stored as individual manager review records rather than one mutable global score. When multiple reviews exist over time, the event/organization history can display an average while preserving each original review and note.

## Incidents

Incidents are separate records so serious issues are not buried inside a general event note.

An incident can include:

- incident type
- date/time
- event/location
- employee/people involved
- description
- action taken
- follow-up needed
- photos/documents

Incidents can be created offline and synchronized later. They appear in the relevant event and leg history and are visible to admin.

## Permissions summary

### Leg manager can

- view their own leg schedule and route
- view their own leg operational/financial history
- add/edit their leg's receipts, expenses, mileage, cash, maintenance, RV park, food, settlement, incidents, and event reviews
- report schedule/route issues
- view the shared crew directory and historical crew feedback
- add workers and add notes/work history associated with their own leg

### Leg manager cannot

- edit official booking/calendar/route data directly
- edit organizations or booking ownership/status outside the allowed operational workflow
- access another leg's private financial or operational records
- administer leg passwords or archive/restore legs

### Admin can

- view and edit all leg information
- see combined totals across all legs
- create unlimited legs
- archive/restore legs
- change manager passwords
- sign out manager devices
- resolve schedule/route reports
- override trip/season grouping when needed
- view and manage all crew records and feedback

## Data synchronization principles

There should be one canonical record for each booking/event/route entity. The manager portal references those IDs rather than duplicating them.

Operational records should be scoped by leg and, where relevant, also linked to:

- booking/event
- route segment
- trip/season
- worker
- vehicle/trailer

This allows totals to roll up cleanly without copying data.

Manager-created records should include timestamps, sync/version metadata, and enough attribution to support conflict detection and auditability.

## Error handling and safety

- Never silently discard offline entries.
- Never silently overwrite a conflicting edit.
- A failed photo upload must not lose the underlying receipt/expense record.
- Invalid or expired leg sessions return the manager to login without exposing cached data for another leg.
- Server authorization must always enforce leg boundaries.
- Destructive admin actions such as archive, password reset, or sign-out-all-devices should require deliberate confirmation.
- Financial totals should be derived from ledger entries rather than manually editable summary numbers wherever possible.

## Recommended implementation stages

### Stage 1 - Portal foundation

- dynamic/unlimited travel legs
- Active/Archived legs and View Archived
- leg-scoped password authentication
- admin password management/sign-out controls
- mobile portal shell
- route/calendar read-only synchronization
- route-issue reporting
- offline queue, sync states, and conflict foundation

### Stage 2 - Money, receipts, and operations

- event/place income
- manual Square/card fields
- expenses and payment methods
- cash ledger
- owner/manager settlement ledger
- receipts/photos and missing-receipt indicators
- route-segment totals
- mileage
- RV park, food, and maintenance details

### Stage 3 - Crew and event aftermath

- shared crew directory
- location-based worker search
- rehire status and work history
- post-event review tasks
- 0-5 star ratings and notes
- incidents and attachments
- admin history integration

### Stage 4 - Advanced integrations

- receipt OCR/scanning
- real Square API integration
- sync refinements based on real field usage
- richer reporting and cross-leg analytics

## Testing strategy

The implementation should include focused tests for:

- leg authorization boundaries
- password reset/session invalidation
- archive/restore behavior
- dynamic leg counts beyond nine
- schedule-to-portal synchronization
- offline queue replay and conflict handling
- finance ledger and settlement calculations
- cash reconciliation
- receipt/photo failure recovery
- route-segment rollups
- shared crew visibility versus leg-scoped editing
- post-event review/rating creation
- incident linking
- admin combined totals

Critical permission and financial calculations should be tested at the server/domain layer, not only through UI tests.

## Out of scope for the first implementation

- employee payroll
- individual employee logins
- live Square API connection
- mandatory online receipt OCR
- managers directly editing official booking/schedule records
- complex HR/private-note permission systems

## Success criteria

The design is successful when a leg manager can travel with only a phone, open their leg portal, see the correct route/events, record the day's money/receipts/mileage/crew/event information even with poor service, and have it synchronize into the same Adventure Zone system that admin uses—without exposing another leg's private records or requiring duplicate data entry.