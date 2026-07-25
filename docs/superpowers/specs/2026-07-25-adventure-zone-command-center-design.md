# Adventure Zone Command Center — Product Design

**Date:** July 25, 2026  
**Owner:** Desiree  
**Status:** Approved design awaiting written-spec review

## 1. Purpose

Build a private, installable web application that helps one booking agent manage
follow-ups, leads, events, travel routes, equipment, and social-content planning
for The Adventure Zone.

The application's primary measure of success is that an active lead never
quietly disappears because a follow-up call was forgotten.

Act! remains the company's official customer relationship management system.
The Command Center supplements Act! with purpose-built booking, route, equipment,
scenario-planning, and content-management features.

## 2. Users and Access

- The initial application has one user: Desiree.
- It works on both phone and computer through a responsive, installable web app.
- The application requires private authentication.
- There are no team accounts, roles, or permission levels in the initial scope.
- Route, contact, contract, and equipment-location information is private.

## 3. Primary Navigation

The application has five main areas and one universal action:

1. **Today** — the default home screen.
2. **Bookings** — contacts, leads, events, statuses, quotes, and contracts.
3. **Routes** — event map, travel legs, route scenarios, and recommendations.
4. **Equipment** — attractions, trailers, shared resources, and package templates.
5. **Content** — private social-media planning tied to confirmed public events.
6. **Quick Add** — add a lead, event, call note, task, or content idea from any screen.

## 4. Today Dashboard

The approved dashboard direction is the **Command Center** layout.

It presents:

- Follow-ups due and overdue
- The next recommended call
- New inquiries
- Quotes or contracts awaiting action
- Route or equipment warnings
- Upcoming events
- Items without a valid next action
- Quick Add

Priority order:

1. Overdue follow-ups
2. Follow-ups due today
3. Time-sensitive booking deadlines
4. High-value or high-probability opportunities
5. Leads that have been inactive for too long

The app sends no phone or email reminders. Work remains inside the app and
appears when the user opens it.

## 5. Booking and Follow-Up Workflow

### 5.1 Lead and Event Record

Each lead or event can store:

- Event and organization name
- Contact people and contact details
- Event location and venue
- Event dates and public operating hours
- Estimated and previous attendance
- Audience age range
- Requested package, attractions, or equipment
- Space, surface, access, power, water, and drainage details
- Booking status
- Probability classification
- Quote, deposit, contract, and payment information
- Insurance and permit requirements
- Decision deadline and board-meeting date
- Communication and note history
- Assigned travel leg
- Next action, owner, and due date
- Social announcement approval
- Renewal date and prior-year relationship

### 5.2 Statuses

Initial statuses are:

- New Lead
- Researching
- Contact Due
- Contacted
- Interested
- Possible
- Unlikely
- Quote Sent
- Pending Decision
- Pending Contract
- Contract Received
- Confirmed
- Declined
- Cancelled
- Completed
- Renewal Due

Statuses are configurable without a code change.

### 5.3 Follow-Up Rule

Every active lead must have a dated next action. An active lead without one
appears in **Needs Follow-up Plan**.

After completing a call, the app prompts for a result:

- Call again
- Send information
- Prepare quote
- Wait for board meeting
- Check on contract
- Mark confirmed
- Mark unlikely or declined
- Close with no further action

Completing a call never silently removes the lead. The user must select the next
outcome.

## 6. Route Planning

### 6.1 Route Model

- The business is modeled with four independent, configurable travel legs.
- Each travel leg has its own color.
- A leg can have a crew, vehicle, trailers, equipment, and operating constraints.
- The exact meaning and normal composition of each leg will be configured after
  Dave explains the current operation.
- The three advertised packages are not treated as fixed physical routes.

### 6.2 Map

Events appear as colored dots. The user can filter by:

- Booking status
- Travel leg
- Date range
- State
- Equipment or package
- Confirmed versus unconfirmed
- Paintball trailer requirement

Confirmed routes are visually distinct from provisional scenarios. Filtering to
one status or leg hides unrelated markers without deleting information.

### 6.3 Recommendations

For a new event, the application ranks suitable travel legs based on:

- Event dates and operating hours
- Previous and following event locations
- Real road mileage and estimated driving time
- Required equipment and its availability
- Crew availability
- Setup and teardown time
- Paintball-trailer transfer requirements
- Schedule and equipment conflicts

Each recommendation explains its reasoning, added mileage, drive time, and any
warnings. The application never assigns or rearranges a route automatically.
The user makes the final decision.

### 6.4 Scenario Mode

Scenario Mode lets the user test one or more unconfirmed events without changing
the confirmed schedule. Scenarios can:

- Add or remove tentative events
- Compare alternative travel-leg assignments
- Compare total mileage and driving time
- Reveal new schedule or equipment conflicts
- Be saved, duplicated, or discarded

## 7. Equipment and Packages

### 7.1 Equipment Records

Major equipment records can include:

- Name, category, and description
- Normal trailer or travel leg
- Dimensions and required footprint
- Power, water, and drainage requirements
- Setup and teardown time
- Inspection, permit, or insurance documentation
- Condition and maintenance notes
- Photos and files
- Event commitments
- Whether the item is movable between legs

### 7.2 Package Templates

Reusable templates represent common sales configurations, including:

- Adventure Zone
- Pirate's Rebellion
- Warrior's Playground
- Smaller or mixed packages identified by Dave

An event can start from a template and then be adjusted. Availability checks run
against the actual promised equipment, not only the template name.

### 7.3 Shared Paintball Trailer

The paintball trailer is modeled as an independently movable shared resource. It
has its own location, schedule, requirements, and transfer route.

The app warns when:

- Two events require it during overlapping periods
- The transfer time between legs is inadequate
- Its delivery or pickup trip has not been planned
- Its location is unknown

The same model supports future shared generators, game trailers, or specialty
attractions.

## 8. Act! Integration

### 8.1 System of Record

Act! is authoritative for company contacts, organizations, and shared CRM
history. The Command Center is authoritative for private route scenarios,
equipment allocation, travel-leg planning, and private content planning.

### 8.2 Initial Import

The first release imports Act! records through a controlled export/import
process. Records are matched using the Act! record identifier when present, then
email address and organization.

Possible duplicates are shown for review and are never automatically merged
when the match is uncertain.

### 8.3 Reviewed Sync

If the company's Act! Cloud plan and access support the official Web API, the
later sync flow is:

1. User presses **Sync with Act!**
2. App fetches changes from both systems
3. App classifies new, modified, duplicate, conflicting, and unmatched records
4. App presents old and new values side by side
5. User approves individual changes or all changes classified as safe
6. Approved changes are applied
7. Failed changes remain pending with a readable explanation

There is no automatic background writeback to Act!.

If direct API access is not available, the supported fallback is reviewed CSV
import and export. The route and equipment functionality does not depend on the
Act! API.

## 9. Social-Content Organizer

Each confirmed event can have:

- Public-announcement approval
- Announcement post
- Reminder post
- Setup or behind-the-scenes content
- During-event photos and video
- Sponsor thank-you
- Post-event recap
- Testimonial request
- Renewal follow-up
- Platform, draft, approved, scheduled, and published statuses

The application clearly distinguishes:

- Private route information
- Publicly approved event information
- Draft content
- Published content

The first version does not publish directly to Facebook or Instagram. It
organizes content and suggested dates while keeping final publication under
the user's control.

## 10. Reliability, Privacy, and Recovery

- Private authentication protects all application data.
- Act! credentials are never stored directly as ordinary application fields.
- Important changes have an audit history.
- Accidental changes can be undone or restored.
- Automatic backups protect the database.
- The application remains usable if Act! is temporarily unavailable.
- Failed sync changes remain pending instead of disappearing.
- Recently loaded information remains viewable during a short connection loss.
- Unsynced local changes are visibly marked and uploaded when connectivity
  returns.
- No route, contract, contact, or equipment-location information is publicly
  shareable by default.

## 11. Mapping

The application uses a road-routing service for mileage and drive-time
estimates. It does not use straight-line distance as a travel estimate.

Previously calculated legs are cached and recalculated when relevant addresses,
dates, or route assumptions change. Cached results reduce cost and improve
speed.

Every estimate is labeled as an estimate. The user can override travel and
setup assumptions when Dave's operational knowledge is more accurate.

## 12. Delivery Stages

### Stage 1 — Daily Booking System

- Private login
- Responsive installable app
- Today Command Center
- Contacts, leads, events, statuses, and notes
- Follow-ups and next-action enforcement
- Calendar
- Four travel legs
- Filterable event map
- Controlled Act! import
- Backups

### Stage 2 — Intelligent Route Planning

- Road mileage and drive-time estimates
- Ranked travel-leg recommendations
- Scenario Mode
- Equipment records and package templates
- Paintball-trailer routing
- Schedule and equipment conflict warnings

### Stage 3 — Connections and Management

- Reviewed two-way Act! sync when supported
- Social-content organizer
- Documents, contracts, and photos
- Renewal reporting
- Route-cost estimates
- Additional workflow automation based on actual use

## 13. Testing and Acceptance

Before a stage is considered complete, test:

- Phone and computer layouts
- Adding, completing, rescheduling, and closing follow-ups
- Overdue follow-up prioritization
- Detection of active leads without a next action
- Booking-status transitions
- Map filters and colored travel legs
- Confirmed versus provisional route display
- Travel-leg ranking and explanation
- Saved and discarded scenarios
- Equipment double-booking
- Paintball-trailer transfer conflicts
- Act! import, matching, duplicate review, and recovery
- Reviewed sync conflict handling when sync is implemented
- Loss and restoration of network connectivity
- Backups and restoration of accidental changes
- Protection of private information in social-content workflows

## 14. Confirmed Assumptions

- The application is initially for Desiree only.
- It must work on both phone and computer.
- Today is the default screen.
- Follow-up calls are the highest-priority risk.
- Reminders remain inside the app.
- There are approximately four separate travel legs.
- Packages and equipment can be mixed and matched.
- The paintball trailer moves between legs.
- Unconfirmed opportunities belong on the map with filters and status labels.
- Route recommendations require manual approval.
- Act! synchronization is initiated and approved manually.
- The Command Center does not replace Act!.

## 15. Information to Collect During Onboarding

The app can be implemented without inventing these business details; they are
configuration data to collect from Dave:

- Exact Act! Cloud product and API availability
- Definition, crew, vehicles, trailers, and normal equipment for each travel leg
- Common package combinations
- Paintball-trailer operating and transfer requirements
- Setup and teardown times
- Driving and crew-rest rules used by the business
- Space, power, water, and drainage requirements
- Booking statuses currently used in Act!
- Contract, payment, cancellation, and weather workflows
- Existing client-data fields and duplicate-record conventions

