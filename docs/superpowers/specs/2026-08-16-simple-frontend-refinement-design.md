# Simple Frontend Refinement Design

Date: 2026-08-16
Status: Approved

## Goal

Make the already-redesigned Admin and Leg Manager frontend feel less intimidating at the surface level, especially on mobile, without removing any existing tools or raw history.

## Profile experience

- The profile slide-in must look like a profile first: show the actual profile/event/organization name prominently, followed by useful context such as location, status, primary contact, phone/email, next follow-up, and next event when available.
- `Open full` must reliably navigate to the full profile route and preserve selected-contact context.
- Main tabs become `Overview`, `Notes`, and `Events`.
- Notes is the human-facing activity surface. Raw/mundane system and imported ACT history moves into a collapsed `History` section at the bottom of Notes.
- History rows should be simplified into plain language where deterministic rules can do so safely. Examples: stage changes, probability changes, opportunity renames/creation, estimated close date changes.
- Repetitive same-day system changes may be grouped into a compact summary with expandable details.
- Expanded History gets lightweight filters such as All, Calls, Notes, Follow-ups, ACT, and System.
- Actions and all other popup menus must use an opaque solid background with readable foreground, border, and shadow.

## Profiles list/search

- Search should look like a normal site search: one prominent search field plus a compact `Filters` / `More filters` control.
- Advanced filters (type, region, phone/email, booking/follow-up, locations, leg, Last Resort, members) are hidden by default and shown only on request.
- Active filters surface as compact removable/status chips rather than large cards.
- Event Families becomes a collapsed/expandable section rather than a permanently expanded card wall.
- `Suggest Families` and `Find Duplicates` live together near the bottom as utility actions.

## Calendar / Schedule

- Mobile month view should be a compact month grid rather than a 42-row day list.
- Days with events show compact indicators/counts; selecting a day reveals that day's items below or in a compact panel.
- Desktop keeps multi-day spanning event bars.
- Month navigation uses one source of truth with Previous, Month/Year, Next, and Today controls.
- Month changes must trigger data refresh correctly and support repeated cycling through months.
- Agenda is simplified to an `Upcoming` style view showing nearest useful events first with progressive disclosure rather than dumping long month groups immediately.
- ACT activities and lower-priority calendar data remain available but should not dominate the default view.

## Progressive disclosure rule

At the surface, show human-readable information needed to decide what to do next. Raw imported/system history, advanced filters, large family lists, administrative utilities, and long schedules default closed and remain available one level deeper.

## Compatibility

- Preserve all current routes, APIs, mutation flows, ACT data, duplicate/event-family tools, and manager permissions.
- Do not introduce a second app/database or replace canonical backend records.
