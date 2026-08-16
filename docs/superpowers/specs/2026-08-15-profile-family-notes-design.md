# Profile and Event Family Notes Design

Date: 2026-08-15
Status: Approved product design, pending written-spec review

## Goal

Add first-class notes to Adventure Zone place/organization profiles, saved organization locations, and event families so important calling and operational context can be recorded where it belongs and found while working.

The design should reuse the existing CRM activity/note patterns where practical instead of creating a parallel note system with different behavior.

## Product decisions

### Organization / place profile notes

Each organization/place/event profile gets a dedicated **Notes** section.

Users can:
- add a note;
- edit a note;
- delete a note;
- see when it was created;
- see when it was last updated when applicable.

Notes are shown newest first.

These notes belong to that specific organization/profile and remain with it through normal editing and duplicate cleanup according to the surviving-profile merge rules.

### Location-specific notes

Saved organization locations get their own **Location notes** section inside the existing location-management UI/drawer.

Use location notes for details that belong to one physical place rather than the overall organization, such as:
- entrance/loading instructions;
- fairgrounds access notes;
- parking/setup details;
- venue-specific organizer context.

Location notes must not be copied into the organization-level note list. The UI should make their scope obvious.

### Event family notes

Each event family gets a dedicated **Family notes** section.

Users can:
- add a family note;
- edit a family note;
- delete a family note;
- see created/updated timestamps.

Family notes are stored once against the family and are not copied into every member profile.

### Family-note visibility on member profiles

When an organization/profile belongs to an event family, that member profile should show a clearly labeled read-only **Family notes — <family name>** section.

This gives callers the shared context while they are working from the individual profile without creating duplicate note records.

The member-profile family-note section should include a link back to the event family page for editing and full family context.

Normal family-note creation/edit/delete remains on the event family page so there is one authoritative copy.

## UX placement

### Profile workspace

Add a **Notes** card near the existing activity/history workspace rather than burying it inside edit-profile forms.

The card should include:
- an obvious Add note action or composer;
- the note list;
- compact Edit and Delete actions on each manually editable note;
- created/updated metadata.

If the profile belongs to a family, place the read-only **Family notes** card close to the profile notes so shared context is easy to notice.

### Organization locations

Inside the existing Possible Locations/location-management drawer, each saved location should expose its own notes area without forcing users to leave the profile page.

Location-note actions should stay visually inside the selected location so users do not accidentally add a venue-specific note to the parent organization.

### Event family page

Add **Family notes** as a normal family-page section near the family identity/member information.

The note composer and edit/delete controls should work the same way as profile notes so the app does not teach two note interaction models.

## Data model

Prefer one note abstraction with explicit scope rather than three unrelated tables or systems.

The persisted note must identify exactly one owner scope:
- organization/profile;
- organization location;
- event family.

A note record should contain at minimum:
- id;
- note body;
- owner scope/type;
- owner id;
- created at;
- updated at;
- provenance/source when needed to distinguish imported ACT history from manually editable local notes.

If the existing activities table can safely represent organization-level notes without breaking imported activity history, keep organization notes integrated with that system. Event-family and location scopes may use a focused note table if extending activities would make ownership semantics confusing. The implementation plan should choose the least disruptive schema after inspecting current activity ownership constraints.

## Edit/delete rules

The user requirement is that manually added notes can be corrected later.

Therefore:
- locally created profile notes are editable and deletable;
- locally created location notes are editable and deletable;
- locally created family notes are editable and deletable;
- edits update the existing note rather than creating a misleading duplicate history item;
- deleting a note removes that manual note from normal UI and related read views.

Imported ACT records should keep their existing provenance/history safety rules. This feature must not accidentally make immutable imported source history destructive unless that behavior is already explicitly supported elsewhere.

## Merge and grouping behavior

### Duplicate organization merge

When duplicate organizations are merged:
- organization-level manual notes from the duplicate must be preserved on the surviving organization;
- location-specific notes remain attached to their location as locations are moved/consolidated;
- no note should be silently discarded because its original organization row is deleted.

### Event-family membership

Adding or removing a profile from an event family does not copy or delete family notes.

When a profile leaves a family, that profile simply stops displaying that family's shared notes.

Deleting an event-family member profile must not delete family-level notes belonging to the family.

## API behavior

Expose focused CRUD operations for notes rather than overloading broad profile-update endpoints.

The API should support:
- list notes for a profile/location/family;
- create note for a valid owner;
- update a note body;
- delete a note;
- fetch family notes as part of member-profile context or through a small family-note endpoint usable by the profile workspace.

Validation should reject:
- empty notes;
- nonexistent owner ids;
- attempts to edit/delete a note through the wrong owner scope;
- unsupported edits to protected imported history.

## Error handling

UI operations should preserve the current note list if a save/delete request fails and show a clear inline error.

Do not optimistically make a note disappear permanently before a failed delete is known to have succeeded unless rollback is implemented.

A family-note loading failure should not prevent the individual profile from loading; show profile content normally and a small family-notes error/retry state.

## Testing

Add regression coverage for at least:

- add organization/profile note;
- edit organization/profile note;
- delete organization/profile note;
- add/edit/delete location note;
- add/edit/delete family note;
- member profile displays family notes read-only with family attribution;
- member profile does not duplicate family notes into its own profile-note list;
- removing family membership removes shared-family-note visibility but preserves the family notes;
- duplicate organization merge preserves organization notes;
- duplicate merge preserves location notes when locations are re-parented;
- invalid owner/note combinations are rejected;
- protected imported activity/history remains protected;
- family-note fetch failure does not break the member profile page.

## Out of scope

- Rich text, attachments, or images inside notes.
- Per-note reminders or follow-up scheduling; existing follow-up features remain separate.
- Copying one family note into every member profile.
- Automatic AI rewriting/summarizing of notes in this release.
- A separate global notes search unless the existing profile/activity search naturally surfaces note text already.

## Success criteria

The feature is complete when a user can add, edit, and delete manual notes on organization/place profiles, specific saved locations, and event families; family notes are visible from member profiles without duplication; and notes survive organization merge/location-consolidation workflows without data loss.
