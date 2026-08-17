# ACT History Purge and Profile Archive Design

**Date:** 2026-08-16

## Goal

Clean the CRM of useless ACT bookkeeping history and add a safe, recoverable way to remove event profiles from normal use without deleting their useful relationships, contacts, bookings, notes, or history.

## Scope

This design covers two independent behaviors:

1. Permanently purge ACT-only administrative history that has no meaningful human content.
2. Archive and restore event profiles while leaving linked contacts and bookings active.

It does not add permanent profile deletion, contact archiving, booking archiving, or broad AI-based history classification.

## ACT History Purge

### What should be purged

A history record is eligible for permanent deletion only when its complete normalized user-visible subject/body is clearly system bookkeeping and contains no meaningful human note, email, call, follow-up, or status narrative.

Initial eligible patterns include relationship bookkeeping such as:

- `Linked to company ...`
- `Contact ... linked`
- `Linked to contact ...`
- `Unlinked from company/contact/...`

And administrative noise such as:

- `Record created`
- `Record updated`
- field-change-only history such as `Field changed`, `Field updated`, or equivalent machine-generated wording

The classifier must be deliberately narrow. Matching a keyword inside otherwise meaningful content is not enough. For example, an email saying `I updated the contract and linked the invoice below` must survive because the full record is a human message rather than a bookkeeping event.

### Permanent deletion behavior

Once a record is confidently classified as purgeable bookkeeping, remove every local representation of that ACT history record:

- imported timeline/activity row, when present
- recovery/review item and associated recovery decisions for that source/version
- archived ACT source/version rows representing the purged history
- relationship-only archive rows whose sole purpose is to connect that purged history record

The purge is intentionally permanent. No hidden/archive copy of these bookkeeping records is retained after successful purge.

Deletion must be referentially safe and transactional. A batch either removes all local representations of a source record or leaves that record intact for retry. Process in bounded batches so production memory usage remains stable.

### Future recovery behavior

The same classifier must run before future ACT history recovery/import. Records that match the purge policy are discarded before timeline creation or Review insertion, preventing them from returning on later recovery passes.

The purge policy must have an explicit version string so future rule changes are auditable and testable.

### Observability

Record aggregate purge counts by source type/reason in server logs and recovery/admin status. Do not log full email/note bodies. The admin result should distinguish at minimum:

- relationship bookkeeping purged
- record lifecycle bookkeeping purged
- field-change bookkeeping purged
- ambiguous/meaningful records retained

## Profile Archive and Restore

### Archive semantics

Add a nullable lifecycle state to event profiles/organizations, represented by `archived_at`.

Archiving a profile:

- sets only that profile's archive state
- does not archive or delete linked contacts
- does not archive or delete linked bookings
- does not delete notes, ACT history, activities, event-family membership, organization relationships, or other linked data
- records an audit entry

Archived profiles are excluded from normal active workflows, including:

- Profiles lists and search
- caller/profile matching
- Today/profile-driven results
- profile selection for new bookings
- event-family/group assignment selectors
- other normal event/profile pickers

Existing linked contacts and bookings remain active and usable even while the parent profile is archived. Where those active records need to display the archived parent relationship, they may show the profile name with an `Archived` indicator rather than silently breaking the relationship.

### Restore semantics

Restoring a profile clears `archived_at` on the same organization row. It must not create a new organization, duplicate contacts, duplicate bookings, duplicate activities, or rebuild relationships.

After restore, the profile returns to normal active lists, search, matching, and selectors.

### UI

On the event profile detail page, place an **Archive profile** action beside the existing Edit action.

Confirmation copy:

> Archive this profile? It will disappear from Profiles, search, caller matching, Today, and normal event selection. Its contacts, bookings, notes, history, and relationships will stay intact.

On success, redirect to the **Archived records** workspace so the user can immediately see where the profile went and restore it if needed.

Add an **Archived records** screen reachable from Settings/navigation. At minimum it lists archived profiles with:

- profile name
- city/state when available
- archived date
- Restore action

Restore confirmation should explain that the same profile will return to normal lists/search. Restore failures remain visible inline and do not remove the archived card.

## Architecture

### ACT purge service

Create a focused ACT-history bookkeeping classifier with a pure interface such as:

```ts
classifyActHistoryForPurge(input):
  | { purge: true; reason: "relationship_bookkeeping" | "record_lifecycle_bookkeeping" | "field_change_bookkeeping" }
  | { purge: false };
```

Keep text normalization separate from classification. The classifier receives already-normalized user-visible text so HTML cleanup and purge policy can evolve independently.

A purge repository/service owns transactional deletion order across activities, recovery state, ACT source versions, source records, and relationship-source rows. Recovery calls the same classifier before persisting history.

### Profile lifecycle service

Use a record-lifecycle repository/service for profile archive and restore. Active query boundaries must explicitly filter archived organizations rather than physically deleting them.

Archive and restore routes are authenticated, validated, transactional, and audited. UI calls the lifecycle API through the existing authenticated client helpers.

## Error Handling

### ACT purge

- Do not partially purge one ACT source record.
- If referential cleanup fails, roll back that record/batch and report a retryable failure.
- Ambiguous text defaults to keep, not delete.
- Never broaden deletion because a record merely contains words such as `linked`, `updated`, or `changed` inside meaningful content.

### Profile archive

- Missing profile returns a stable not-found error.
- Already archived archive requests are idempotent.
- Already active restore requests are idempotent.
- Archive/restore failures leave the previous lifecycle state unchanged.
- Active selectors must not accept an archived profile ID even if a stale client submits one directly.

## Testing

### ACT purge tests

Write tests proving:

- `Linked to company Crafts - 16th Street Fair` is purgeable.
- `Contact Downtown Denver linked` is purgeable.
- `Record created` and `Record updated` are purgeable.
- field-change-only machine history is purgeable.
- a real email/note containing `linked`, `updated`, or `changed` survives.
- a record with system-looking subject plus meaningful human body survives.
- purge deletes the imported activity, Review/recovery state, ACT source/version, and relationship-only rows for that history.
- purge does not delete the linked organization/contact/booking or unrelated activities.
- rerunning purge is idempotent.
- future recovery does not recreate purged bookkeeping history.

### Profile archive tests

Write real-database/API/UI tests proving:

- archiving a profile sets only the organization archive state.
- linked contacts and bookings remain active.
- notes/history/relationships remain stored.
- archived profile disappears from profiles/search/caller matching/Today and relevant selectors.
- archived profile cannot be submitted through a stale booking/family selector request.
- Archived records lists the profile.
- restoring clears the same row's archive state and restores visibility.
- restore creates no duplicate contacts, bookings, activities, or relationships.
- archive/restore is audited and idempotent.

## Rollout

1. Add classifier and regression fixtures first.
2. Add purge service and run it in bounded batches over already-imported/review/archive ACT history.
3. Integrate classifier into future ACT recovery so junk cannot return.
4. Add profile archive schema/service/query filters.
5. Add Archive profile and Archived records UI.
6. Verify existing profiles, contacts, bookings, Today, caller matching, event-family grouping, and ACT recovery flows.

Because ACT history deletion is permanent, rollout must not use a broad one-off SQL `LIKE` deletion. All production purging must go through the tested classifier/service so the same safety rules apply to existing and future records.

## Success Criteria

The feature is complete when:

- pure ACT linking/admin bookkeeping no longer appears in profiles or Recovery Review and is permanently removed from ACT archive storage
- meaningful calls, emails, notes, and other human history remain intact
- subsequent ACT recovery cannot recreate purged bookkeeping records
- a user can archive an unwanted profile from its detail page
- that profile disappears from normal workflows while its contacts, bookings, notes, history, and relationships remain intact
- the archived profile can be restored later as the exact same record without duplicates
