# Profiles & Event Families UX Design

## Goal

Make Profiles the clean top-level directory for places/events/organizations, make family/group membership understandable and editable, remove duplicated creation flows, and reduce profile-page clutter without deleting underlying ACT/import/history data.

## Problems being solved

1. Profile filters are inconsistent with backend values, so some visible filter choices do not reliably filter records.
2. Event Family member selection currently loads only the first Profiles page and then filters locally, so “Choose an ungrouped profile…” is incomplete and feels random.
3. Event-family member profiles are repeated in the broad Profiles list, creating clutter after grouping.
4. Event Family Suggestions is too visually prominent for an occasional maintenance action.
5. There is no clear, convenient way to add an existing profile or create a new event/profile directly inside an Event Family or organization/location group.
6. “New Event” and “Add Lead” overlap and should be one creation flow.
7. Source provenance is implementation/import metadata and does not need to occupy normal profile UI.
8. Possible Locations can become a very large block beneath a profile and should be moved into a compact drawer.
9. The current New Event flow asks for too much at once and does not guide matching/grouping early enough.

## Core model and terminology

### Profiles

A Profile is the editable underlying record containing contacts, history, notes, calls, follow-ups, bookings, and other operational data.

Profiles can be:
- standalone top-level profiles;
- members of an Event Family;
- members/locations of an organization group such as Water Lantern Festival.

Membership does not destroy or merge the underlying profile record.

### Event Families

An Event Family is a browsing/organization layer for related event profiles, such as Fourth of July events or Oktoberfest-type events. The family is the normal top-level representation in Profiles once members have been grouped.

### Organization/location groups

Organization groups such as Water Lantern Festival use a parent profile/group with child locations/branches. The parent is the normal top-level directory entry; child locations remain individually editable but are not repeated in the broad list by default.

## Profiles directory behavior

### Default visibility

The broad Profiles directory shows:
- standalone profiles;
- Event Family cards;
- organization/group parent profiles.

It hides individual profiles already represented as members of an Event Family or organization/location group.

A filter named **Show family/group members** can reveal those individual members when needed.

### Search behavior

Search must still be able to find hidden member profiles.

When a hidden member matches search, render it with its parent context rather than pretending it is standalone. Example:

> Denver Water Lantern Festival — part of Water Lantern Festival

Selecting that search result should open the underlying editable profile, while clearly retaining a link/back-reference to its family/group.

### Filters

The Profiles filter contract must use one shared set of normalized values between URL parsing, frontend controls, API query parsing, and database filtering.

Supported filters:
- text search: profile name, city, contact name, phone, email;
- profile type;
- state/region;
- travel leg;
- has phone;
- has email;
- has follow-up;
- has booking;
- has possible locations;
- Last Resort status;
- Show family/group members.

Profile-type options must use actual stored/API values. UI labels may be friendly, but submitted values must match backend values exactly.

Changing filters performs a real query against the backend; the frontend must not silently drop supported parameters.

Reset clears all filters and returns to the default top-level-only directory.

## Event Family page

### Member picker

Replace the current page-1-only select with a searchable server-backed picker.

The picker searches the entire profile dataset.

Results must:
- exclude the profile if it is already a member of the current family;
- clearly show if a profile belongs to another family/group;
- prevent accidental silent reassignment;
- allow a deliberate move/reassignment only through an explicit confirmation path if supported by the backend.

The picker should search by name, city, state/region, and contact data where available.

### Add existing profile

Primary family action:

**Add existing profile**

Selecting a profile adds that existing underlying profile as a family member without duplicating its contacts/history.

### Create new event/profile in family

Secondary family action:

**Create new event in this family**

This launches the unified Add Event / Lead flow with the family preselected. The created profile is added to the family as part of the same successful operation.

### Remove member

Removing a member only removes family membership. It must not delete the underlying profile, contacts, bookings, notes, or history.

### Family Suggestions placement

Event Family Suggestions becomes a compact secondary control at the bottom of the Profiles page, e.g.:

**Review family suggestions**

It should not occupy the top of the page or interrupt normal profile browsing.

The suggestion UI may show a small count badge when suggestions are waiting.

## Organization/location group editing

Parent/group profiles should provide equivalent member-management actions:
- Add existing profile/location;
- Create new event/location in this group;
- remove/unlink a child without deleting its underlying data.

Water Lantern Festival is the representative behavior: the organization appears once at the top level while its locations remain available from the parent profile/group and through search.

## Unified Add Event / Lead flow

### Naming and entry points

“New Event” and “Add Lead” become one action named **Add Event / Lead**.

All existing entry points that currently create the same underlying kind of prospect/event should route to this one flow.

### Progressive form

The flow should be shorter and progressive rather than presenting every field at once.

#### Step 1 — identity

Required first:
- event/profile name.

As soon as the user enters a name, show likely existing matches so duplicates/group members can be reused rather than recreated.

#### Step 2 — relationship/grouping

Optional:
- Event Family;
- organization/group parent.

When the flow was launched from a family/group, this relationship is preselected.

#### Step 3 — core location/contact

Optional fields:
- city;
- state/region;
- venue/address if known;
- contact name;
- phone;
- email;
- website if relevant.

Blank optional fields are valid.

#### Step 4 — operational details

Optional advanced section:
- source;
- status/probability;
- travel leg;
- event dates;
- follow-up date/note;
- booking details when appropriate.

The user can create the lead/profile without completing this section.

### Post-create behavior

After creation:
- open the new profile;
- show its family/group context when one was selected;
- do not create a duplicate top-level list entry if the profile is now represented by a family/group.

## Profile detail cleanup

### Source provenance

Remove Source provenance from the normal profile interface.

The underlying provenance/import/audit data remains stored and may remain available in admin/debug/import tooling. This is a presentation change, not data deletion.

### Possible Locations drawer

Replace the full always-expanded Possible Locations list with a compact trigger such as:

**Possible locations (14)**

Selecting it opens a drawer/sheet containing the full locations interface.

The drawer supports the location actions that already belong to this feature, including viewing and any existing add/edit/selection controls.

On mobile, the drawer should use a near-full-screen sheet; on desktop, use a right-side drawer where practical.

Closing the drawer returns to the same profile position/state.

## Family/group context on member profiles

A member profile should display a compact context banner/link, for example:

- “Part of Fourth of July”
- “Location of Water Lantern Festival”

The context should link to the family/group parent.

This replaces relying on directory duplication to communicate relationships.

## API/data behavior

### Directory visibility

The profile-list API gains an explicit include-members query option, defaulting to false.

Default list behavior excludes profiles represented by a family/group membership while still returning top-level family/group summaries needed by the page.

Search is an exception: matching hidden member profiles may be returned as contextual search results even when include-members is false, provided the response marks their family/group relationship so the UI can render them appropriately.

### Family member search

Provide a dedicated server-backed profile search suitable for family/group assignment rather than fetching page 1 and filtering in the browser.

The endpoint must support pagination/search and return membership context.

### Creation

The unified creation endpoint/flow should allow optional family/group association in the same logical operation. If association fails, the UI must not claim the item was grouped successfully.

## Error handling

- Invalid filters fall back to safe normalized defaults rather than causing the Profiles page to fail.
- Family/group member search shows an inline retry state if it cannot load.
- Trying to add a profile already in the same family is idempotent or returns a clear non-destructive message.
- Trying to add a profile owned by another family/group requires explicit handling; do not silently move it.
- Unified creation preserves entered values when a request fails.
- Drawer load failures stay inside the drawer and do not blank the profile page.

## Testing requirements

### Profiles filters

Tests must prove:
- each visible filter produces the expected URL/API value;
- profile type labels map to actual backend values;
- combined filters are preserved together;
- reset clears them;
- default directory hides family/group members;
- Show family/group members reveals them;
- search can surface a hidden member with parent context.

### Event Families

Tests must prove:
- member search is not limited to profile page 1;
- existing family members are excluded/marked appropriately;
- an existing profile can be added;
- removing a member preserves the underlying profile;
- creating from a family preselects/creates membership;
- suggestion control is rendered at the bottom/secondary position rather than as the page’s primary content.

### Unified Add Event / Lead

Tests must prove:
- old New Event and Add Lead entry points lead to the same flow;
- only name is required for a minimal lead;
- optional fields can remain blank;
- duplicate/match suggestions appear before creating;
- preselected family/group association is honored;
- advanced operational details remain optional.

### Profile detail

Tests must prove:
- Source provenance is absent from normal profile UI;
- possible locations are collapsed behind the drawer trigger;
- drawer opens/closes without losing the profile page;
- family/group context is visible on member profiles.

## Out of scope

- deleting historical ACT provenance/audit data;
- automatically merging profiles solely because names look similar;
- automatically moving a member from one family/group to another without confirmation;
- replacing the underlying profile/history model;
- redesigning unrelated Calendar, Route Map, Leg Manager, finance, crew, or calling workflows.

## Success criteria

The Profiles page behaves like a directory rather than a raw database dump: one obvious top-level entry for grouped entities, reliable filters, searchable hidden members with context, simple family/group maintenance, one creation flow for events/leads, and a substantially less cluttered profile detail page.