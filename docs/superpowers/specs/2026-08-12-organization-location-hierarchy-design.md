# Organization and Location Hierarchy Design

## Goal

Represent a multi-location or multi-event organization as one parent profile with full child location/event profiles, while preserving the ACT history that currently lives on separate city or event records.

This is a general CRM capability. It applies to Water Lantern Festival and any other festival company, fair association, venue chain, convention organizer, school district, or organization that operates through multiple locations or recurring city events.

## Chosen approach

Use a self-referencing organization hierarchy:

- A parent organization is the shared organization-level profile.
- Existing organization records may have an optional parent organization.
- Child records remain full profiles for specific locations or locally managed events.
- A parent may have many child locations.
- This hierarchy is one level deep for this feature: a location cannot itself own child locations.

This approach preserves the existing records, relationships, and ACT provenance and avoids moving location history into a separate subsystem.

## Information ownership

### Parent organization

The parent may hold:

- organization name;
- main website;
- headquarters or general phone and email;
- general contacts;
- organization-wide notes and activity history;
- organization-wide follow-ups;
- summary information and rollups across locations.

### Child location or event

A child may hold:

- location/event name;
- street address, city, region, and postal code;
- direct location or event webpage;
- local phone and email;
- local contacts;
- local notes and activity history;
- bookings;
- local follow-ups;
- travel leg;
- map location;
- local booking/prospect status;
- ACT source provenance.

Contacts and notes are supported at both levels. Records do not inherit ownership silently: a parent contact remains organization-wide and a child contact remains local unless the user explicitly changes it.

Bookings, local follow-ups, addresses, map pins, and travel legs remain attached to the child location. Organization-wide follow-ups may be attached to the parent.

## Profile experience

### Parent profile

The parent profile shows:

- shared organization details;
- a clickable **Visit website** action;
- general contacts and notes;
- a **Locations & Events** section;
- location count and useful rollups.

Each child card shows the city and region, local status, next follow-up or booking, travel leg, primary local contact, and a direct webpage action when available.

### Child profile

The child keeps the existing event profile and call workspace behavior. Its header includes **Part of [parent organization]**, linking back to the parent. Local website, address, contacts, notes, follow-ups, and bookings remain visible and actionable.

### Website behavior

Website fields exist at both levels. Values are normalized before display so ACT values without a protocol, such as `waterlanternfestival.com`, open as valid HTTPS links. Website actions open in a new browser tab with safe external-link attributes. The stored source value remains available for editing and provenance.

## Search and navigation

- Searching an organization name returns the parent first and shows its location count.
- Searching a city, local contact, phone number, email address, or child name may return the matching child directly.
- Parent results include enough location context to avoid looking like empty shell profiles.
- Child results visibly identify their parent.
- The hierarchy is navigable in both directions.
- Existing profile URLs continue to resolve after grouping because child records are retained.

## Existing ACT data grouping

Grouping is available after import and during data organization.

Strong candidate families may be suggested when records share evidence such as:

- the same normalized organization name;
- the same website domain;
- clearly different cities or event locations;
- compatible ACT relationship/source data.

Name similarity alone is not sufficient for automatic grouping. Ambiguous candidates require review.

The review action set includes:

- **Merge duplicates** for records that truly represent the same profile;
- **Same organization—make locations** for legitimate location/event variants;
- **Not related** for coincidental similarities.

For a location-family decision, the user selects or creates the parent and confirms the children. Existing notes, contacts, bookings, follow-ups, activities, call sessions, external links, and ACT provenance remain attached to their original child unless explicitly promoted to the parent.

Information promotion is additive until the hierarchy operation commits. A failed operation must not leave partially copied or re-parented records.

## Duplicate protection

Confirmed parent/child families are excluded from duplicate merge suggestions against one another.

The duplicate scan and bulk duplicate merge must distinguish among:

- confirmed duplicates;
- proposed location-family matches;
- confirmed location families;
- unrelated records.

Bulk merge must skip proposed and confirmed location-family groups. It may never delete a child merely because its normalized name or website matches its parent or siblings.

If records in a duplicate group also contain evidence of distinct cities, the system should prefer a location-family review over preselecting a destructive merge.

## Manual organization

Users may:

- create a new parent organization;
- select an existing organization-wide profile as the parent;
- attach one or more existing profiles as child locations;
- move a child to another parent;
- ungroup a child.

An existing city/location profile should not become the parent merely because it is the best-known record. If every candidate is location-specific, the system creates a new organization-wide parent so each location keeps its own address and history.

Ungrouping only clears the parent relationship. It does not delete or move the child's contacts, notes, bookings, follow-ups, activities, or ACT provenance.

A parent with children cannot be assigned as a child, preventing cycles and deeper nesting. A parent cannot be deleted while it has children without first resolving those children.

## Data model and service boundaries

Add an optional parent reference to organizations, plus website support if it is not already represented as a first-class field. Database constraints and service validation enforce:

- a record cannot parent itself;
- a child cannot be used as a parent while it has its own parent;
- a parent with children cannot be assigned beneath another parent;
- grouping changes are transactional;
- deleting or merging a parent cannot orphan children;
- existing foreign keys to child organizations remain unchanged.

The organization repository owns hierarchy reads and writes. ACT grouping analysis produces candidates but does not mutate live profiles. Duplicate analysis consumes hierarchy state and candidate decisions so destructive merge paths can exclude location families.

The profile API returns parent summary data and paginated/searchable child summaries without requiring every child's complete history in one response.

## Status and rollups

Local status remains authoritative on child locations. The parent may have its own organization-wide status, but it does not overwrite child statuses.

Parent summaries may calculate non-destructive rollups such as:

- number of locations;
- upcoming bookings;
- overdue follow-ups;
- travel legs represented;
- most recent contact date.

Rollups are derived from child data and are not copied back into children.

## Errors and recovery

- Grouping, moving, and ungrouping use transactions.
- Validation errors identify the conflicting profile and explain the corrective action.
- A failed hierarchy update leaves the prior hierarchy intact.
- If grouping candidates become stale because records changed, the review refreshes them before applying.
- Website normalization failures show the value as editable text rather than generating an unsafe or broken link.
- Parent and child profile pages remain usable if optional shared or local information is absent.

## Testing

Automated coverage includes:

- parent and child contacts and notes remain separate and readable;
- parent and child website links are normalized, clickable, and safe;
- search finds a parent by organization name;
- search finds a child by city, contact, phone, and email;
- the parent location count and rollups are correct;
- child pages link back to their parent;
- existing child profile URLs remain stable;
- ACT candidate grouping uses multiple evidence signals;
- ambiguous candidates require review;
- grouping preserves all child history and provenance;
- grouping and ungrouping are transactional;
- cycle and nesting prevention;
- duplicate detection excludes confirmed family members;
- bulk duplicate merge skips proposed and confirmed location families;
- bookings, travel legs, and map locations remain with the correct child;
- frontend and API production builds pass.

## Migration and rollout

1. Add the optional parent relationship and website fields with non-destructive database migrations.
2. Ship hierarchy-aware repository and API reads before enabling grouping writes.
3. Add parent and child profile UI and website actions.
4. Add reviewed grouping operations and manual grouping controls.
5. Update duplicate detection and bulk merge protection before enabling ACT family suggestions.
6. Generate suggestions for existing ACT records; do not auto-group ambiguous records.
7. Verify representative families, including Water Lantern Festival, before processing larger suggestion batches.

## Out of scope

- Unlimited multi-level corporate hierarchies.
- Automatically moving all child contacts or notes to the parent.
- Automatically grouping records based only on similar names.
- Replacing location-specific bookings with parent-level bookings.
- Deleting child profiles after grouping.
