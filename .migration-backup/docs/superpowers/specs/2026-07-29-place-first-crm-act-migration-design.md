# Place-First CRM and Act! Migration Design

**Status:** Approved design

**Date:** 2026-07-29

**Scope:** Place-centered CRM, Act! company/contact/opportunity migration, and a manual-first calling workspace

## 1. Summary

Adventure Zone Command Center will present a simple, place-first CRM:

```text
Place -> People -> Call -> Follow-up or Booking
```

A Place is a fair, city, festival, venue, school, tribe, association, company, or similar account. A Person is a real human who can be called. A Booking is a specific sales attempt, event year, or contracted engagement.

The user experience centers on one Place page. It shows the people available to call, the next action, open and past bookings, and recent history. The records remain separate underneath so relationships, deduplication, history, and future integrations remain correct.

The existing Packages/Resources work remains intact. This design is a new CRM migration phase and does not reinterpret package or resource data.

## 2. Evidence and problem statement

The supplied Act! exports contain:

- 1,814 company rows in `Companies.xls`.
- 1,444 contact rows in `Contacts (1).xls`.
- 27 opportunity rows in `Opportunities.xls`.
- 32 group rows in `Groups.xls`.

The exports show that:

- Act! Companies are mostly fairs, festivals, powwows, rodeos, venues, cities, schools, tribes, associations, and other event-facing accounts.
- A company can exist without a named contact.
- Most contacts are associated with a company.
- Some people or email addresses appear under several companies, so duplicating a Person for every Place would fragment call history.
- Act! Opportunities are distinct sales records and map naturally to local Bookings.
- Act! Groups are calling segments or saved selections, not customer records.
- The legacy `.xls` files contain footer/count contamination. Values such as `1019`, `761`, `27`, and `13` appear in fields where a missing value is expected.
- The supplied exports omit stable Act! record IDs.

The current application already separates organizations, contacts, and bookings, but it has three important gaps:

1. Act! live sync and CSV import are contact-centered rather than company-first.
2. The CSV path can create duplicate organizations for contacts that share a company.
3. `contacts.organizationId` represents only one organization, even though the source data contains people associated with several places.

## 3. Goals

1. Make Places the simple user-facing home for sales work.
2. Show every callable Person for a Place on one screen.
3. Store one Person once and associate that Person with one or more Places.
4. Treat each concrete sales attempt or event year as a Booking.
5. Import Act! Companies, Contacts, Opportunities, and useful Groups without duplicate or fake records.
6. Preserve stable Act! identities and make imports repeatable and auditable.
7. Support a manual call workflow now while keeping a clean seam for a future phone provider.
8. Preserve all existing booking, package, resource, route, activity, follow-up, call, and Last Resort behavior.

## 4. Non-goals

This phase does not:

- Place calls through Five9 or another phone provider.
- Add company or opportunity writeback to Act!.
- Delete local records when a source record disappears.
- Import Act! calendar, email, documents, or full history.
- Automatically merge ambiguous Places or People.
- Turn Companies, Opportunities, or Groups into fake People.
- Replace the existing Packages/Resources implementation.
- Rename the physical `organizations` database table solely for cosmetic reasons.

## 5. Product language

The interface uses plain language:

| Internal concept | User-facing label | Meaning |
| --- | --- | --- |
| Organization | Place | Fair, city, festival, venue, school, tribe, association, company, or other account |
| Contact | Person / People | A real human with callable or emailable contact information |
| Booking | Booking | A sales attempt, event year, proposal, or contracted engagement |
| Follow-up | Next action | A dated action required to continue active work |
| Group/filter | Calling list | A reusable selection of Places or People |

Search may use the combined label **Places & People**, but Place and Person records remain distinct.

## 6. Domain model

### 6.1 Place

A Place is a durable account. An event-named Act! Company such as a county fair remains one Place even when the fair repeats annually.

A Place stores:

- Name.
- Type: Fair, City/Government, Festival/Event, Venue, School, Tribe, Association, Company, or Other.
- Exact Act! industry/category text when available.
- Main phone.
- Address.
- Website.
- Act! identity and source metadata.
- Last Resort and call-suppression state.
- People, Bookings, activities, calls, follow-ups, and history.

An unknown type is stored as `Other` until reviewed. Industry text is preserved rather than forced into an unreliable type.

### 6.2 Person

A Person is a real human and stores:

- Name.
- Email.
- Primary usable phone number.
- Title.
- Address when it is genuinely person-specific.
- Act! identity and source metadata.
- Activity and call history.

A Person is not duplicated merely because the Person works with several Places.

Several Act! Contact IDs may map to one reviewed local Person. Exactly one source link is the primary Act! Contact identity for existing two-way Contact sync. Additional Act! Contact IDs are pull-only aliases used to preserve source relationships; they do not independently overwrite the Person's core fields.

### 6.3 Place-Person relationship

A Place-Person association records:

- Place.
- Person.
- Role, such as Event Director, Organizer, Vendor Coordinator, City Clerk, Decision Maker, or General Contact.
- Primary-contact flag for that Place.
- Active/inactive state.
- Source and audit metadata.

The association is unique per Place and Person.

The existing `contacts.organizationId` remains the primary Place pointer during this phase for compatibility. Every non-null primary pointer must also have a Place-Person association. Place pages and import matching use the association table as the complete source of relationships.

Services update the primary pointer and its association in the same transaction. The pointer cannot reference a Place that lacks the matching association.

Database constraints enforce:

- One row per Place-Person pair.
- At most one active primary Person per Place.
- A primary Place-Person association cannot be inactive.

### 6.4 Booking

A Booking is one sales cycle or engagement. A new event year creates a new Booking, not a new Place.

A Booking has:

- One Place.
- One primary Person when known.
- Optional additional involved People with roles.
- Existing booking dates, status, probability, travel, package, resource, contract, and note fields.
- Act! opportunity identity and source stage/status metadata.

The Booking's primary Person must be associated with the Booking's Place unless the Booking is explicitly queued for relationship review.

An applied local Booking never keeps an invalid Place-Person combination. If a user changes the Place, the service keeps the primary Person only when that Person has an active association with the new Place; otherwise it clears the primary Person and asks the user to choose another. Imported source records remain in staging review until this invariant can be satisfied.

Booking-Person associations are unique per Booking and Person. At most one is primary, and that row mirrors `bookings.primaryContactId` for compatibility.

### 6.5 Call, activity, and next action

A call records:

- Place.
- Person called when known, or a Place-level general number with no fake Person.
- Optional Booking.
- Outcome.
- Notes.
- Timestamp and user.
- Next action when work remains open.

Existing activities and follow-ups continue to support Place, Person, and Booking context.

### 6.6 Calling list

A calling list is a saved query or source group. It references Places or People without copying them.

Examples:

- Colorado fairs.
- Places needing a contact.
- Callbacks due today.
- Not called in 90 days.
- Open bookings with no next action.

Act! Groups may seed source-backed calling lists only under the explicit policy in Section 10.5. A Group never becomes a Place, Person, or Booking.

## 7. User experience

### 7.1 Navigation and search

Primary navigation exposes:

- Places.
- People.
- Bookings.
- Calling Lists.

Global search returns Places and People together with a clear type label. Searching a Person also shows associated Places.

### 7.2 Place list

The Place list supports:

- Search by name, city, state, type, industry, Person, phone, or email.
- Filters for type, state, open Booking, next action, Last Resort, and `Needs contact`.
- Counts for People and active Bookings.
- A visible next-action summary.

### 7.3 Place detail: call-first layout

The approved layout is the call-first workspace.

The header shows:

- Place name, type, location, and main phone.
- `Call main`.
- `New booking`.
- Last Resort and phone-status warnings when applicable.

The main content prioritizes:

1. **People to call**
   - Name.
   - Role.
   - Phone.
   - Primary indicator.
   - Last outcome.
   - Next follow-up.
   - `Call` action.
2. **Next step**
   - The dated action selected by the deterministic priority rule below.
   - A direct start/open action.
3. **Bookings**
   - Current and past Bookings with status, probability, date, and value when known.
4. **Recent history**
   - Calls, notes, emails recorded locally, follow-ups, and Booking changes.

A Place without a usable Person remains visible and shows `Find a contact`. Its verified main number remains callable.

The next-step card selects an incomplete action in this order: oldest overdue due date, then earliest upcoming due date, then creation time, then record ID as a deterministic tie-breaker. If an active Booking has no incomplete dated action, the card shows `Next action required`.

### 7.4 Person detail

The Person page shows:

- Contact information.
- Every associated Place and relationship role.
- Calls, notes, and follow-ups.
- Related Bookings.
- Act! identity and sync state.

### 7.5 Booking relationship controls

Booking create and edit forms allow the user to:

- Select a Place.
- Select a primary Person from that Place.
- Add another involved Person when needed.
- Create a new Person and associate that Person with the selected Place.

Changing a Place never silently moves or duplicates a Person.

## 8. Manual-first call workflow

### 8.1 Starting a call

Selecting `Call` opens the in-app call workspace with:

- Place context and Person context when known.
- Selected phone number.
- `Copy number`.
- `Call started`.
- Role and prior outcomes.
- Open Bookings.
- Existing notes.
- Required next action.

The user dials outside the application in this phase. The call-provider boundary accepts Place, optional Person, phone, and optional Booking identifiers so Five9 or another provider can replace the manual dial action later.

### 8.2 Outcomes

The primary outcome list remains short. Existing proposal and Last Resort actions remain available under `More outcomes` so current workflows and history are preserved.

| UI outcome | Persisted disposition | State | Required input | Booking effect |
| --- | --- | --- | --- | --- |
| No answer | `no_answer` | Open | Confirm a dated next action | None |
| Voicemail | `left_voicemail` | Open | Confirm a dated next action | None |
| Callback requested | Existing `follow_up_needed` | Open | Callback due date and time | None |
| Wrong person/number | New `wrong_contact` | Open | Reason and dated next action | Mark the selected phone invalid or the relationship inactive |
| Interested | `interested` | Open | Dated next action | Create a Booking or move the linked Booking to `interested` |
| Not interested | `declined` | Closed | Reason | Move the linked Booking to `declined` when present |
| Booked | `booked` | Closed sales step | Existing or new Booking | Move the Booking to `confirmed` |
| Proposal/contract sent | Existing `proposal_sent` | Open | Dated next action | Move the linked Booking to `pending_contract` |
| Move to Last Resort | Existing `last_resort` | Closed | Reason and explicit confirmation | Mark the Place Last Resort and move the linked Booking to `declined` |

No-answer and voicemail may prefill a suggested follow-up, but the user must confirm or change its date before completing the call. No automatic background follow-up is created.

Historical persisted values remain unchanged and continue to display through the existing public mappings. The only new persisted enum value is `wrong_contact`.

### 8.3 Call safeguards

- Place and Person phone fields gain a status of `callable`, `invalid`, or `do_not_call`, plus an optional reason and change timestamp.
- `invalid` and `do_not_call` disable that specific Call action. Changing either status is a separate audited edit; the call workspace cannot bypass it.
- Replacing an `invalid` phone resets the replacement to `callable` after confirmation. A `do_not_call` status persists across phone edits until a separate audited change removes it.
- Existing Place-level Last Resort remains a warning state. Starting a Last Resort call requires explicit owner confirmation and creates an audit entry.
- Draft notes remain recoverable after a failed save.
- Retrying a save is idempotent and cannot duplicate a call.
- Place-level general numbers do not create fake People.

### 8.4 Call persistence

`Call started` creates or reuses a server-side draft call session keyed by the existing request key. The call session adds:

- State: `in_progress`, `completed`, or `abandoned`.
- Exact dialed phone value.
- Authenticated actor ID.
- Draft note.
- Server-generated start and completion timestamps.

The disposition is nullable only while a call is `in_progress` or `abandoned`. Existing rows backfill to `completed`; their unavailable phone and actor values remain null.

The workspace autosaves the draft note. Reloading or navigating back can resume an unfinished call. Discarding marks it `abandoned` without creating an activity, follow-up, or Booking change. Completing the call and all resulting writes remain one idempotent transaction.

## 9. Act! source strategy

### 9.1 Production source

The production migration uses the Act! Web API in read-only mode, not the supplied `.xls` files.

The Act! Web API exposes stable IDs and read endpoints for:

- `GET /api/Companies`.
- `GET /api/Contacts`.
- `GET /api/Opportunities`.
- `GET /api/Groups`.
- Company-contact, opportunity-company, opportunity-contact, and group-contact relationships.

The API also supports paging and `$select`/`$expand`, including selecting `id` for Companies and Opportunities.

The supplied exports remain reconciliation evidence and test-fixture input. They are not applied directly because they omit stable IDs and contain count contamination.

References:

- [Act! Web API reference](https://plugindeveloper.actops.com/web-api)
- [Act! OData querying reference](https://actforweb.actops.com/act.web.api/OData/index)

### 9.2 Synchronization boundary

- Companies, Opportunities, Groups, and their relationships are pull-only in this phase.
- Existing reviewed Contact synchronization remains supported.
- Contact company resolution changes from name-only matching to stable Act! Company IDs and Place-Person associations.
- One reviewed Act! Contact link per Person is designated `primary` and remains the only two-way Contact sync target.
- Additional Act! Contact links for the same Person are pull-only aliases. They may add source relationships but cannot overwrite local Person fields or receive local writeback.
- Company and Opportunity writeback require a separate approved design.

### 9.3 Existing-table compatibility

Existing import and synchronization history remains readable:

- `act_import_runs` continues to represent legacy file imports and is not repurposed.
- `act_sync_runs` and `act_sync_operations` continue to represent reviewed Contact synchronization and are not repurposed.
- New `act_migration_runs` and `act_migration_records` tables stage the multi-entity read-only API migration.

`act_external_links` becomes the canonical stable source-identity table for Places, People, Bookings, and calling lists. It gains a primary flag and sync mode (`two_way` or `pull_only`). The existing direct `actRecordId` columns remain compatibility mirrors of the primary link during this phase; services update the direct column and primary external link together.

Database constraints keep one local owner for each Act! entity ID and at most one primary Act! link per local entity and source entity type.

`act_contact_sync_states` remains keyed by local Person and represents only the primary two-way Act! Contact link. Pull-only alias links have migration snapshots and audit history but no independent two-way base state.

When several Act! Contact IDs are proposed for one Person, the preview requires the user to approve the consolidation and choose the primary link. Existing primary links win by default. A later alias may never silently replace the primary link.

## 10. Migration pipeline

### 10.1 Staging

Every source record is first written to an import staging model containing:

- Import-run ID.
- Source entity type.
- Stable Act! record ID.
- Raw source snapshot.
- Normalized comparison fields.
- Proposed action.
- Review state.
- Error details.
- Applied local entity ID when successful.

Credentials remain server-side. Application logs avoid raw contact PII.

### 10.2 Normalization

Normalization:

- Trims whitespace.
- Normalizes case for matching without altering displayed values.
- Normalizes email and phone values.
- Preserves original name, address, industry, status, and stage values.
- Treats legacy footer/count sentinel values as missing only in legacy-file fixture tests; API data does not inherit those cleanup assumptions.

### 10.3 Match order

**Places**

1. Existing Act! Company ID link.
2. Unique normalized name plus city/state.
3. Unique normalized name plus verified phone or website.
4. Otherwise `Needs review`.

**People**

1. Existing Act! Contact ID link.
2. Unique normalized email with no conflicting source names.
3. Unique normalized phone plus compatible name.
4. Unique normalized Place plus compatible name.
5. Otherwise new Person or `Needs review`, depending on collision risk.

Shared mailboxes such as `info@...` never merge People solely by email. A source row without a real person's name may update the unambiguous Place's general contact details, but it never creates a Person.

**Place-Person relationships**

1. Stable Act! company-contact association.
2. Existing unique local Place-Person pair.
3. Otherwise create the relationship.

**Bookings**

1. Existing Act! Opportunity ID link.
2. No automatic fallback merge when the ID is absent.
3. New API Opportunities create new Bookings and preserve source status and stage.

Name-only matches never merge ambiguous records.

Only an existing stable Act! ID link is eligible for automatic apply. All first-time fallback matches are proposed in the preview and require approval. Approval stores the stable external link, so later pulls match by ID rather than repeating fuzzy review.

### 10.4 Preview states

The preview separates records into:

- New.
- Matched with no change.
- Change.
- New relationship.
- Possible duplicate.
- Needs review.
- Ignored.
- Error.

The preview includes both per-entity counts and relationship counts.

### 10.5 Apply order

The importer applies approved work in this order:

1. Places.
2. People.
3. Place-Person relationships.
4. Bookings.
5. Booking-Person relationships.
6. Eligible calling-list definitions and memberships.

The apply operation uses bounded, resumable batches. Each source identity is idempotent. Retrying a completed or partially completed run does not create duplicate records or relationships.

Act! Groups with explicit memberships may become source-backed calling lists. A dynamic Group is recreated only when the application has the fields needed for an equivalent live filter; otherwise it is explicitly ignored with a recorded reason rather than imported as a stale membership snapshot.

### 10.6 Deletion and source absence

- Source absence never deletes a local record.
- A later reviewed refresh may mark a source link inactive.
- Local calls, notes, follow-ups, Bookings, and history are never removed by a pull.

### 10.7 Reconciliation

Every import ends with a report containing:

- Source count per entity.
- New, matched, changed, reviewed, ignored, and failed counts.
- Relationship counts.
- Places without People.
- People associated with several Places.
- Opportunities without a reliable Place or Person.
- Duplicate-source-ID conflicts.
- Retry and batch status.

Production apply is complete only when all source records are either applied, explicitly ignored, or assigned to a visible review queue.

## 11. Error handling

- Authentication or source failures leave the import run retryable.
- Pagination failures record the failed page and do not mark the snapshot complete.
- Validation failures affect only their records, not unrelated batches.
- Relationship creation waits until both parent records exist.
- A Booking without a reliable Place remains unapplied in `Needs review`.
- A Booking with a reliable Place but no Person may import with `Needs person`; it is not blocked solely because the primary Person is unknown.
- An ambiguous Person relationship remains in `Needs review`.
- Database writes use transactions scoped to a bounded batch.
- Idempotency keys prevent duplicate calls and duplicate import application.
- User-facing errors explain whether the user can retry, review, or correct source data.

## 12. Rollout

Implementation proceeds in five ordered slices:

1. **Relationship foundation**
   - Add Place-Person and Booking-Person associations.
   - Backfill existing relationships.
   - Preserve existing primary Place and primary Person pointers.
   - Gate: all existing pointers have matching associations, uniqueness constraints pass, and existing CRM tests remain green.
2. **Act! API staging and preview**
   - Pull Companies, Contacts, Opportunities, Groups, and source relationships.
   - Add matching, review states, and reconciliation.
   - Gate: a complete snapshot has stable source IDs, paging can resume, all proposed actions are visible, and replaying the snapshot changes no proposal.
3. **Reviewed import**
   - Apply Places, People, relationships, and Bookings.
   - Gate: every source row and relationship is applied, explicitly ignored, or visible in review; rerunning creates no duplicates.
4. **Place-first interface**
   - Add Places & People search, Place list, call-first Place page, Booking relationship controls, and reproducible calling lists.
   - Gate: the enumerated call-first layout, deterministic next step, relationship controls, and list filters pass UI and end-to-end tests.
5. **Manual calling workflow**
   - Add call workspace, outcomes, next-action rules, drafts, and retry safety.
   - Gate: every outcome row in the matrix, suppression rule, draft lifecycle, idempotent retry, and Booking transition passes integration and end-to-end tests.

A phone-provider integration is a later independent phase that implements the prepared call-provider boundary.

## 13. Testing strategy

### 13.1 Unit tests

- Normalization of names, emails, phones, and source IDs.
- Match precedence and ambiguity handling.
- Primary versus pull-only Act! Contact link selection.
- Legacy footer/count fixture cleanup.
- Legacy and new outcome mapping, terminal/open state, and required input.
- Phone status and Last Resort call eligibility.
- Call draft state transitions.
- Place type and Act! industry preservation.
- Idempotency-key behavior.

### 13.2 Integration tests

- One Person associated with several Places.
- One Place containing several People.
- Place-Person uniqueness and one-primary constraint.
- A Place with no Person.
- Primary Place backfill from existing contacts.
- Booking with primary and additional People.
- Booking Place changes clearing an incompatible primary Person.
- Act! API paging and partial-page retry.
- Repeat import with no duplicate Places, People, Bookings, or relationships.
- Several Act! Contact IDs linked to one Person with only one two-way primary.
- Pull-only aliases unable to overwrite Person fields or receive writeback.
- Missing parent relationships moving to review.
- No deletion when an Act! record is absent.
- Batch failure and resume.
- Contact sync resolving a stable Act! Company ID.
- Historical call dispositions remaining readable without rewrite.
- Server-side call draft resume, abandon, and complete behavior.

### 13.3 UI and end-to-end tests

- Search finds a Place by Place or Person data.
- Place list filters and counts.
- Call-first Place page prioritizes People and the next action.
- `Call` opens the correct Place, Person, and Booking context.
- Every outcome follows its validation rules.
- Draft notes survive failed saves, reloads, and navigation.
- A retry creates one call.
- Invalid and do-not-call phone states disable dialing.
- Last Resort requires confirmation and creates an audit entry.
- Place and Booking relationship controls work with keyboard and smaller screens.

### 13.4 Regression tests

- Existing contact, organization, booking, call, activity, follow-up, Last Resort, package, resource, route, and import tests remain green.
- Existing Act! contact identities and local record IDs are preserved.

## 14. Acceptance criteria

The feature is complete when:

1. Places are the primary account experience in the UI.
2. A Place shows all associated People without duplicating shared People.
3. Every applied Booking has one Place; its primary and involved People, when present, have active associations with that Place.
4. The Act! API can stage and reconcile Companies, Contacts, Opportunities, Groups, and their supported relationships with stable IDs.
5. Ambiguous matches require review and are never merged automatically.
6. Re-running an import produces no duplicate local records or relationships.
7. No supplied legacy footer/count value becomes real CRM data.
8. Places without People enter a visible `Needs contact` queue.
9. The Place page renders the header actions, People-to-call list, deterministic next-step card, current/past Bookings, and recent history in the approved call-first order.
10. Exactly one Act! Contact link per Person can perform two-way sync; aliases remain pull-only.
11. Manual calls follow the outcome matrix and end with the required next action or terminal state.
12. In-progress call drafts can resume or be abandoned without duplicate activities.
13. Save retries do not duplicate calls.
14. Existing call dispositions and history remain readable.
15. Existing application behavior and tests remain intact.

## 15. Decision log

- Use a Place-first interface rather than flattening all records into Contacts.
- Keep Places, People, and Bookings as separate related entities.
- Allow one Person to associate with several Places.
- Treat annual or repeated sales attempts as new Bookings under the same Place.
- Use the call-first Place layout rather than an overview-first dashboard.
- Use manual dialing in this phase and keep a provider integration boundary.
- Use the Act! Web API as the production migration source because it supplies stable IDs and relationships.
- Permit reviewed Act! Contact aliases while keeping exactly one primary two-way sync link per Person.
- Keep legacy import/sync history tables and add separate multi-entity migration staging tables.
- Preserve existing call outcomes, add `wrong_contact`, and expose proposal/Last Resort as secondary outcomes.
- Persist call drafts server-side and add audited phone eligibility states.
- Keep Companies and Opportunities pull-only in this phase.
- Keep ambiguous merges and deletions out of automatic import behavior.
