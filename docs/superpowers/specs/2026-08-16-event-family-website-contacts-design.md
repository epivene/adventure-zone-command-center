# Event Family Website & Contacts — Design

## Goal

Let Event Families behave more like normal profiles for shared corporate-level website and contact information, while keeping member-event local information separate.

A family such as **Water Lantern Festival** should be able to store its main website and one or more CRM contacts. Member profiles such as Denver or Boise should show that family-level information for reference without copying it into the member profile.

## Product principles

- Family-level data belongs to the Event Family, not to every member event.
- Member profiles keep their own local websites and contacts independently.
- Existing CRM contacts are linked rather than duplicated.
- Removing a contact from a family removes only the relationship; it never deletes the CRM contact or its history.
- Event Family relationships remain separate from organization/location hierarchy relationships.
- Keep the UI as simple as the normal profile contact experience.

## Event Family website

Add one nullable `website` value to an Event Family.

On the Event Family page:
- show the current website as a clickable external link when present;
- show a plain empty-state when no website is recorded;
- provide **Edit website**;
- allow clearing the website;
- normalize/open the URL with the same safe external-link behavior used by normal event profiles.

The website belongs only to the Event Family. It is not copied into member organization/profile records.

## Event Family contacts

An Event Family can have multiple linked CRM contacts.

Each family-contact relationship stores family-specific metadata:
- contact ID;
- optional role/title for that family;
- whether the contact is the Primary family contact;
- created/updated timestamps.

The underlying person remains a normal CRM contact. Phone, email, name, addresses, and contact history continue to live on the existing contact record.

### Add contact

The Event Family page gets **+ Add contact** with two paths:

1. **Find existing contact**
   - searchable using the existing contact search behavior;
   - shows enough context to distinguish similar names;
   - attaching creates only the family-contact relationship.

2. **Create new contact**
   - reuse the normal lightweight contact fields/pattern;
   - name is required;
   - phone, email, role, and other normal optional contact information remain optional;
   - the new person becomes a normal CRM contact and is then linked to the Event Family.

Creating the contact and linking it to the family must be atomic so a failed family link does not leave an unintended orphan contact.

### Contact controls

For each linked family contact:
- open the CRM contact;
- edit the normal CRM contact using the existing contact editor;
- edit the family-specific role if needed;
- **Make primary**;
- **Remove from family**.

Only one family contact may be Primary at a time. Removing the Primary contact leaves the family with no Primary until another is selected; it does not silently pick one.

Deleting an Event Family deletes/unlinks its family-contact relationships only. It must never delete linked CRM contacts or their history.

## Event Family page UI

Near the top of the Event Family detail page, add a compact **Website & Contacts** section.

Suggested presentation:

- **Website**
  - link or “Not recorded”
  - Edit website
- **Contacts**
  - compact cards/rows with name, role, phone, email, and Primary badge
  - + Add contact

Do not make this a separate admin page or navigation item.

## Member profile read-only family contact section

When a member event/profile belongs to an Event Family, its profile detail response should include a compact family-contact summary:
- family ID/name;
- family website;
- Primary family contact when one exists;
- optionally the remaining linked family contacts if the UI needs them for a small expandable list.

On the member event profile, show a read-only section such as:

**Family contact — Water Lantern Festival**
- Jane Smith · Corporate Events
- phone / email
- Family website
- Open family

Rules:
- editing happens from the Event Family or the normal Contact profile, not from this read-only member box;
- local member-event contacts stay in the normal Contacts section and are not blended into the family list;
- local member website stays independent;
- if the family has no website or contacts, do not show an empty Family contact box.

## Data model

Extend `event_families` with a nullable website field.

Add an Event Family ↔ Contact relationship table with:
- `id` or composite identity suitable for repository conventions;
- `family_id` FK;
- `contact_id` FK;
- optional family-specific role;
- `is_primary` boolean;
- timestamps;
- unique `(family_id, contact_id)` constraint;
- indexes for family and contact lookup.

Enforce one Primary contact per family either with a partial unique index or transactionally in the repository/service, following what Postgres/schema conventions in the repo support best.

No contact data is copied into `event_families` beyond relationship metadata.

## API behavior

Extend Event Family detail APIs to return:
- website;
- family contacts;
- Primary state and family role.

Add owner-only mutations for:
- update/clear family website;
- search existing contacts for attachment;
- attach existing contact;
- create-and-attach new contact atomically;
- update family-specific role / Primary state;
- remove contact from family.

Use normal validation and return conflicts for duplicate relationships rather than creating duplicate links.

Extend member Event Profile detail data with a read-only family contact/website summary when the profile has Event Family membership.

## Error handling and safety

- Invalid family/contact IDs → 400.
- Missing family/contact → 404.
- Already-linked contact → 409 with a useful message.
- Failed create-and-attach → rollback both operations.
- Website validation should be permissive enough to accept common user-entered domains while using the existing URL normalizer for opening links.
- Removing a family relationship must never update/delete notes, calls, bookings, contact history, organization membership, or Event Family membership of member profiles.
- Contact deletion behavior should respect existing CRM safeguards; this feature does not introduce a new contact-deletion path.

## Testing

Backend coverage:
- website save, clear, and retrieval;
- attach existing contact;
- duplicate attach rejected;
- create + attach is atomic;
- Make Primary clears prior Primary for that family only;
- remove relationship keeps contact/history intact;
- family deletion does not delete contacts;
- member-profile family summary returns website and Primary contact;
- Event Family and organization membership remain independent.

Frontend coverage:
- Event Family shows/edit website;
- Add contact supports existing and new contacts;
- contact rows show role/phone/email/Primary;
- Make Primary and Remove from family flows;
- server errors remain visible;
- member profile shows read-only Family contact section when data exists;
- member profile does not blend family contacts into local Contacts;
- no empty family-contact box when no shared information exists.

Final verification:
- focused Event Family/contact API tests;
- existing Event Family member/profile regressions;
- contact regressions;
- frontend Event Family/profile tests;
- API build;
- frontend build/typecheck, distinguishing any pre-existing `main` failures from feature-introduced failures.

## Out of scope

- Automatically copying family contacts/websites into member profiles.
- Automatically promoting a member profile contact to family contact.
- Organization-level contact inheritance.
- Family-wide bulk email/calling features.
- Multiple websites/social links; this first pass adds one main website, matching the current normal-profile need.
