# Manual Organization Membership UI Design

## Goal

Make it easy to manually add event/location profiles to organization profiles at any time, in either direction, using the existing organization hierarchy model.

A representative example is Water Lantern Festival: the parent organization should be able to add an existing city/event profile or create a new one, and any standalone event/profile should be able to attach itself to Water Lantern Festival or another organization.

The feature should feel like a small extension of the existing Profiles experience, not a separate hierarchy-management tool.

## Chosen approach

Use one shared organization-membership flow exposed from both sides of the relationship:

- Parent organization profile: **+ Add location/event**.
- Event/location profile: **Add to organization…**.

Both entry points use the same underlying parent-child relationship that already powers organization/location hierarchy. No parallel grouping model is introduced.

## Parent organization flow

The organization profile's **Locations & Events** section includes a clear **+ Add location/event** action.

Opening it shows two simple choices:

1. **Find existing profile**
2. **Create new**

### Find existing profile

The user searches across eligible event/location profiles.

Search results show enough context to avoid attaching the wrong record, including when available:

- profile/event name;
- city and region;
- current organization, if any;
- booking/prospect status.

Selecting a profile attaches it to the current organization after validation.

If the selected profile already belongs to another organization, the UI must not silently move it. It shows the current organization and asks the user to confirm the move.

### Create new

Creating a new child uses the same simple **Add Event/Lead** form used elsewhere in Profiles:

- name is required;
- all other fields remain optional;
- blank optional values are allowed;
- the current organization is preselected automatically.

The user should not have to fill in organization information a second time.

After creation, the new profile appears immediately in the parent organization's **Locations & Events** section and behaves like any other event/location profile.

## Event/location profile flow

Any eligible event/location profile includes an **Add to organization…** action near its organization/context area.

Opening it presents a searchable list of parent organizations. The user selects an organization and confirms the relationship.

After assignment, the profile header/context area displays:

**Part of [Organization Name]**

The organization name links back to the parent profile.

If the profile is already assigned, the action becomes **Change organization…**. The UI clearly shows the current parent before a move is confirmed.

A separate **Remove from organization** action clears only the parent relationship.

## Data preservation

Attaching, moving, or removing organization membership is non-destructive.

The operation must never delete, merge, or relocate the child profile's:

- contacts;
- notes;
- call outcomes;
- activities;
- follow-ups;
- bookings;
- route/leg assignments;
- map/location data;
- ACT provenance/history;
- attachments or other profile-specific records.

Changing membership changes only the parent-organization reference.

## Relationship rules

The existing hierarchy rules remain authoritative:

- a profile cannot parent itself;
- a child cannot create a hierarchy cycle;
- a parent with children cannot itself be nested beneath another parent if that would violate the one-level hierarchy;
- an organization-wide parent should remain distinct from city/event children;
- confirmed parent/child records are not treated as duplicate merge candidates merely because names or websites overlap.

If the user tries an invalid relationship, the UI identifies the conflicting profile and explains why it cannot be attached.

## Simplicity guardrails

This feature should remain visually lightweight.

- Do not add a separate Organization Management page just for membership.
- Do not expose hierarchy terminology such as "parent ID" or "child record" in normal UI copy.
- Use familiar wording: **Add location/event**, **Add to organization**, **Change organization**, **Remove from organization**.
- Use a small drawer/dialog rather than a dense management screen.
- Keep **Locations & Events** as one section rather than splitting locations and events into separate tabs for this feature.
- Reuse the existing Add Event/Lead form instead of introducing a second creation form.

The feature should be understandable to someone who only knows: "This event belongs to Water Lantern Festival."

## API and service behavior

The existing organization hierarchy repository/service remains the source of truth for relationship mutations.

The UI needs service/API support to:

- search eligible parent organizations;
- search eligible child event/location profiles;
- attach an existing child to a parent;
- move a child from one parent to another after explicit confirmation;
- remove a child from its parent;
- create a new event/location profile with a parent organization already selected.

Relationship mutations should be transactional. A failed operation leaves the previous relationship intact.

The server revalidates hierarchy constraints at write time so stale UI state cannot create cycles or invalid nesting.

## Search behavior

The pickers should support normal human searches rather than requiring exact names.

Organization search may match:

- organization name;
- website/domain;
- known location/event family context when useful.

Event/location search may match:

- profile name;
- city;
- region;
- local contact information where supported by the existing Profiles search service.

Already-related children may be hidden from the "add existing" list for the current organization unless a user is explicitly changing membership.

## Success feedback

After a successful attach/create/move:

- the drawer closes or returns to a clear success state;
- the parent **Locations & Events** list refreshes;
- the child immediately shows **Part of [Organization]**;
- no manual page reload is required.

Removing membership refreshes both sides and leaves the standalone profile fully usable.

## Error handling

- Stale profile relationships are re-read before committing a move.
- Duplicate submit/retry behavior must not create duplicate child relationships.
- If a profile has become ineligible while the picker is open, the server rejects the operation with a clear explanation.
- A failed create-and-attach operation must not leave a half-created relationship state.
- Optional blank Add Event/Lead fields remain valid.

## Testing

Automated coverage should prove:

- parent organization can search and attach an existing event/location profile;
- parent organization can create a new event/location with the parent preselected;
- new child creation requires only the existing minimum Add Event/Lead fields;
- standalone profile can search and attach to an organization;
- already-attached profile shows **Change organization…** rather than silently reassigning;
- moving between organizations requires explicit confirmation and preserves all child history;
- removing membership only clears the parent relationship;
- parent and child UI refresh immediately after changes;
- hierarchy/cycle rules are enforced server-side;
- duplicate-merge protections still recognize organization families;
- existing profile URLs remain stable;
- frontend typecheck and API/web production builds pass.

## Rollout

1. Reuse and verify the existing organization hierarchy mutation APIs/repository behavior.
2. Add any missing searchable picker endpoints needed by both directions.
3. Add **+ Add location/event** to organization profiles.
4. Add **Add to organization… / Change organization… / Remove from organization** to event/location profiles.
5. Reuse the existing Add Event/Lead form with organization preselection.
6. Add focused relationship-preservation and UI tests.
7. Verify representative workflows with Water Lantern Festival and at least one other organization family.

## Out of scope

- Multi-level corporate trees beyond the existing hierarchy rules.
- Automatically assigning profiles to organizations without user approval.
- Automatically merging organization children.
- Bulk drag-and-drop organization management.
- Replacing Event Families; organization membership and event-family membership remain separate concepts.