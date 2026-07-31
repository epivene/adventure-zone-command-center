# Event Profiles and Calling Workspace Design

## Product goal

Make each fair, city, venue, company, or event a single working profile. A caller should be able to find the event, see every associated contact and Act! detail, call the next person, record the result, schedule a follow-up, and create or update a booking without moving between unrelated pages.

## Event profile model

An event profile is the primary user-facing record. It contains:

- Event/place identity, location, dates, and source provenance
- All associated Contacts, including phone numbers and email addresses
- Notes, history, groups/calling lists, opportunities, bookings, and follow-ups
- Duplicate-source references retained for auditability

The database may retain normalized place and contact tables underneath, but the UI treats them as one profile. A Contact can still be associated with multiple event profiles when Act! data supports that relationship.

## Automatic consolidation

- Exact normalized event name + normalized location matches consolidate automatically.
- All unique contacts, numbers, notes, source IDs, groups, and booking references are retained.
- Conflicting non-empty values are preserved in profile history/notes; no source information is discarded.
- Near-matches and conflicting locations remain queued as possible duplicates.
- Safe exact matches and low-risk unchanged records are bulk-approved automatically; only ambiguous cases require individual review.

## Five9-style calling workspace

The event profile replaces the current split workflow. The workspace shows:

- Current event profile and all contacts
- Primary contact and alternate contacts
- Next call, call status, notes, and outcome
- Follow-up scheduling
- Booking status and a create/update booking action
- Calling-list context and next profile in the queue

The workspace is the replacement for the current page behind New booking and Quick add.

## Today page integration

Today remains the command dashboard and queue; it does not become a second record system. Every actionable Today item deep-links into the unified event profile workspace with the relevant Contact, booking, or follow-up selected:

- **Next call** opens the event profile at the call workspace.
- **Follow-ups due** opens the profile with the matching Contact and follow-up action.
- **New leads** opens the profile in calling/prospect mode.
- **Upcoming events** opens the profile with booking context.
- **New event profile** is the single creation action available from the dashboard.

The event profile workspace owns the call, note, follow-up, and booking actions; Today only prioritizes and links to them. This prevents duplicate workflows and keeps the caller in one context.

## Unified creation flow

Replace the separate New booking and Quick add entry points with one **New event profile** action:

1. Find or create the event/place profile.
2. Add or select one or more Contacts.
3. Review the combined profile.
4. Optionally create the booking immediately, or leave it as an active prospect.
5. Continue calling and follow-up from the same workspace.

Existing URLs remain compatible and redirect into the unified flow where practical.

## Migration and apply behavior

- Preview staging performs automatic exact consolidation before proposals are shown.
- Safe exact groups are approved in bulk; unresolved duplicates remain queued.
- Apply approved changes writes event profiles and relationships to Command Center only; Act! is read-only.
- Save-decision and apply actions must persist durable state and be visible after refresh.
- Re-running apply is idempotent and must not duplicate profiles, contacts, or relationships.

## Success criteria

- The three duplicate “10 Mile Pride (Breckenridge) CO” records produce one event profile with all unique contacts and source details.
- A caller can complete a call and create/schedule a booking from one profile workspace.
- No manual review is required for exact duplicate groups or safe unchanged records.
- Only genuinely ambiguous records remain in the review queue.
