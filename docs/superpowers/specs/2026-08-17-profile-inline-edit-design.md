# Profile inline editing design

## Goal
Make profiles feel directly editable without leaving the profile page or opening Advanced tools. Keep the simplified profile surface while preserving the existing deeper CRM tools.

## Approved interaction
- Full profiles and the profile slide-in show a clear **Edit** action in the top-right near Actions/Open full.
- Tapping Edit switches the visible profile into **inline edit mode** on the same screen.
- Edit mode replaces editable display values with controls in place and shows **Save** and **Cancel**.
- Save persists changes through the existing profile/contact mutation paths, refreshes the profile data, and returns to view mode.
- Cancel restores the original values without saving.

## Editable fields
The normal profile surface must allow editing all ordinary profile information that is already editable in the app, including:
- profile/event/organization name
- profile type/status where supported
- city, state/region, address/location, and website
- primary contact selection/details
- contact name and other existing contact fields
- phone and email values
- other current profile-detail fields exposed by the existing Event Profile edit workflow

Notes, follow-ups, call outcomes, bookings/events, organization relationships, family membership, imports, merge/duplicate tools, and other record-specific objects keep their existing dedicated edit/add/delete controls rather than turning the entire timeline into one form.

## Contact row
In view mode the primary contact line should keep the useful contact methods together:

`(970) 547-3100 · info@breckcreate.org · breckcreate.org`

- phone, email, and website should be clickable when usable
- missing values simply do not render; do not show placeholder dashes between contact methods
- the same presentation should be used in the slide-in and full-profile surfaces

## Phone formatting
Add one shared presentation formatter for phone numbers.
- A normal 10-digit US number displays as `(xxx) xxx-xxxx` regardless of stored punctuation.
- An 11-digit number beginning with `1` is treated as a US number and displays the same 10-digit local form.
- Extensions and non-US/international values are preserved safely rather than being incorrectly reformatted.
- Formatting is primarily a display concern; do not destructively rewrite imported raw values just to change appearance.
- Edit inputs may format progressively for ordinary US numbers as long as saving remains compatible with the current API.

## Slide-in behavior
Inline editing must work from the profile slide-in as well as the full profile. Editing should not require Open full. If a field or relationship still requires a specialized existing workflow, the inline form may link to that workflow without removing it.

## Existing architecture
Reuse the current EventProfileEditPage/form logic and existing API mutations rather than creating a second profile data model or separate edit API. Extract/reuse field groups or mutation helpers where practical so full-page edit and inline edit stay consistent.

## Safety and errors
- Disable duplicate Save submissions while a save is in progress.
- Show a compact inline error if saving fails and keep the user's edits on screen.
- Do not silently discard unsaved values after a failed request.
- Existing permissions and validation remain authoritative.

## Testing
Add focused tests for:
- Edit -> Save/Cancel state transitions
- profile and contact values using existing mutation paths
- website displayed alongside phone/email
- `(xxx) xxx-xxxx` phone formatting and safe international/extension behavior
- slide-in and full-profile surfaces both exposing Edit
- failed save retains edit mode and entered values

## Non-goals
- No database schema change.
- No replacement of note/follow-up/event editing flows.
- No removal of Advanced profile tools.
- No new profile type or permission model.
