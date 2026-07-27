# Act! Contact Sync and Contacts Workspace Design

**Date:** 2026-07-27  
**Status:** Approved for planning  
**Scope:** Two-way Act! contact synchronization, a searchable/editable Contacts workspace, and safer XLS/CSV imports

## Goal

Make Adventure Zone Command Center the practical daily workspace for booking and follow-up work without silently changing the shared Act! account. Contacts must be searchable and editable inside Command Center, while every exchange with Act! remains an explicit, previewed, owner-approved action.

The first integration phase provides complete two-way synchronization for contacts. The connector should be structured so Act! activities, history, opportunities, and calendar data can be added in later phases without replacing the contact sync foundation.

## Confirmed Act! Environment

- Product: Act! Premium Cloud, U.S. region
- Act! version: APC 26.14 Hotfix 1
- Web API version: 1.1.1272.1
- Database name: `V72122203125`
- API base URL: `https://apius.act.com/act.web.api`
- Authentication: Act! username/password exchanged server-side for a bearer token
- Account model: a shared Act! account

References:

- Act! Web API authentication and cloud endpoint documentation: <https://apimta.act.com/act.web.api/>
- Supported OData contact querying, filtering, selecting, expanding, and paging: <https://apimta.act.com/act.web.api/OData/Index>
- Act! webhook documentation, including the current cloud limitation: <https://apimta.act.com/act.web.api/ActHooks/Index>

## Product Principles

1. **Manual by default.** Opening Command Center, viewing contacts, or editing a local contact never calls Act!.
2. **Preview before effects.** Pressing **Sync with Act!** fetches and compares data, but does not change either system.
3. **Explicit approval.** A second action applies only the rows and directions the owner approved.
4. **Act! record IDs are authoritative identities.** Email and name/company are matching aids only.
5. **No automatic deletion.** Missing records are flagged for review, never deleted.
6. **Conflicts stay visible.** Ambiguous or concurrently changed records cannot be auto-applied.
7. **Credentials stay server-side.** Act! credentials never enter client JavaScript, GitHub, audit payloads, or application logs.
8. **The app remains useful when Act! is unavailable.** Local contact browsing and editing continue normally.

## Approaches Considered

### Live Act!-only screens

Every Contacts page would query Act! directly. This avoids a local mirror but makes the app dependent on Act! availability and rate limits, provides poor offline/failure behavior, and makes safe previewed changes difficult.

### XLS/CSV-only transfer

This is simple and remains a useful fallback, but it cannot reliably preserve Act! record identity when exports omit record IDs. It also requires repetitive manual exports and cannot safely push individual edits.

### Hybrid local workspace with manual two-way sync — selected

Command Center keeps a local, organized copy for fast daily work. A manual sync retrieves Act! contacts, creates a reviewable comparison, and applies approved changes in either direction. This provides the strongest safety and usability for a shared Act! account.

## Contacts Workspace

### Navigation and routes

- Add **Contacts** to desktop and mobile navigation.
- `/contacts` — searchable, paginated contact list.
- `/contacts/[contactId]` — contact details, editing, sync state, and related bookings.
- `/settings/act-sync` — connection status, sync preview, conflict review, and recent sync results.
- Keep `/settings/import` as the XLS/CSV fallback.

### Contact list

The list supports:

- Search by contact name, organization, email, phone, city, state, or ZIP.
- Filters for:
  - All contacts
  - Waiting to sync
  - Conflict
  - Synced
  - Not linked to Act!
- Pagination suitable for the current 1,400+ contact dataset.
- Visible organization, email, phone, location, and sync-state badges.
- A clear empty state and a direct **Add contact** action.

### Contact detail and editing

The detail page displays and edits:

- First and last name
- Organization/company
- Job title
- Email
- Phone
- Address line 1
- Address line 2
- City
- State/region
- Postal code
- Related Command Center bookings
- Act! link state
- Last local edit time
- Last successful sync time

Saving an edit updates Command Center only and marks the contact **Waiting to sync**. Creating a contact locally behaves the same way. The first phase does not expose contact deletion; a later archive workflow can be designed separately.

## Data Model

### Contact fields

Extend `contacts` to retain the useful fields currently present in Act! exports but discarded after preview:

- `job_title`
- `address_1`
- `address_2`
- `city`
- `region`
- `postal_code`

Existing contact identity, organization, email, phone, and timestamps remain.

### Act! mapping and synchronization state

Continue using `act_external_links` for the stable Act! record ID mapping. Add contact sync metadata that records:

- Contact ID
- Last synchronized canonical field snapshot
- Last Act! `edited` timestamp observed
- Last successful sync timestamp
- Whether the local contact has unsynchronized edits
- Current state: unlinked, synced, waiting, or conflict

The last synchronized snapshot is the three-way merge base. It allows the system to distinguish “changed locally,” “changed in Act!,” and “changed in both places” without guessing from timestamps alone.

### Sync runs and operations

Store each preview as a sync run containing:

- Start/completion timestamps and status
- Counts by category
- The compared local and Act! snapshots
- Proposed direction for each row
- Owner conflict choices
- Per-row apply result and error

Remote Act! writes and local database updates cannot share one transaction. Therefore, apply operations are idempotent and recorded per row. If a network failure interrupts a batch, completed rows remain recorded and the owner can safely retry only unfinished rows.

## Manual Sync Flow

### 1. Test connection

The settings page shows a masked connection state and offers **Test Act! connection**. The server:

1. Validates the configured API base URL against the fixed U.S. Act! host.
2. Requests a bearer token with server-only credentials and the configured database name.
3. Returns a sanitized success or failure message.

### 2. Build preview

Pressing **Sync with Act!**:

1. Authenticates server-side.
2. Fetches all accessible Act! contacts using OData paging and selected fields.
3. Compares them with local contacts.
4. Stores a preview run.
5. Shows counts and review tabs without making changes.

Preview categories:

- **New in Act!** — pull into Command Center.
- **New in app** — create in Act!.
- **Changed in Act!** — update the local contact.
- **Changed in app** — update Act!.
- **Changed in both** — owner must choose a direction.
- **Possible match** — ambiguous identity; owner must link or keep separate.
- **Already matched** — no work required.
- **Missing from Act!** — review only; never delete automatically.
- **Error** — review only.

### 3. Match identity

Matching priority:

1. Existing `act_external_links` record ID.
2. A unique Act! record ID already stored on a legacy contact.
3. Unique normalized email match.
4. Unique normalized company plus contact-name match.
5. Otherwise, possible match or new record.

An email shared by contacts with different Act! record IDs is legitimate and does not create a conflict after stable identities are known. If record IDs are unavailable, repeated email or repeated company/name combinations remain ambiguous and require review.

### 4. Review and approve

Safe one-direction changes can be bulk-approved. Conflict and possible-match rows require an explicit per-row choice:

- Keep Act! version
- Keep app version
- Link these records without changing fields
- Keep as separate contacts
- Skip

The preview records the decision, but still does not apply it.

### 5. Apply

Before applying an Act! write, the server re-fetches the affected record and verifies its `edited` value still matches the preview. A newly changed Act! record becomes a conflict rather than being overwritten.

Each approved operation:

1. Writes to the destination system.
2. Saves or confirms the stable Act! record ID.
3. Updates the synchronized base snapshot.
4. Clears the waiting/conflict flag when successful.
5. Writes an audit entry.
6. Records the row result.

Failures are sanitized, shown per row, and retryable. Successful rows are not repeated.

## XLS/CSV Import Safety Fix

Before matching uploaded rows against the local database, the importer performs a whole-file collision pass:

- Repeated non-empty Act! record IDs are conflicts.
- For rows without stable record IDs, repeated normalized emails are conflicts.
- For rows without record IDs or email, repeated normalized company/contact pairs are conflicts.
- Every involved row shows the conflicting CSV row numbers and reason.
- Collision rows are review-only and cannot be bulk-approved.
- Rows with different stable Act! IDs may share an email without being collapsed.

The existing imported test contacts are not silently merged or removed. The first API sync uses real Act! record IDs and surfaces uncertain matches for explicit review.

## Security

Render encrypted environment variables:

- `ACT_API_BASE_URL=https://apius.act.com/act.web.api`
- `ACT_DATABASE_NAME=V72122203125`
- `ACT_USERNAME`
- `ACT_PASSWORD`

Rules:

- Never expose these variables through `NEXT_PUBLIC_*`.
- Never store credentials in PostgreSQL, GitHub, browser storage, sync previews, or audit entries.
- Never include authorization headers, bearer tokens, passwords, or full Act! response bodies in logs.
- Restrict sync routes to the existing Clerk owner check.
- Use HTTPS, request timeouts, response-size limits, OData paging limits, and the fixed Act! hostname to reduce SSRF and runaway-request risk.
- Respect Act! rate-limit headers and stop cleanly when the limit is reached.
- Show only sanitized authentication/permission messages, including Act! API permission failures.

## Error and Recovery Behavior

- Act! unavailable: local Contacts remain available; sync reports a retryable connection error.
- Invalid shared password: connection status changes to disconnected; no local data is altered.
- API permission denied: show a specific owner-facing message with no credential details.
- Rate limit reached: preserve the preview/apply run and offer retry after the reset time.
- Preview becomes stale: reclassify affected rows rather than overwriting newer changes.
- Partial apply: preserve successful rows and retry only incomplete rows.
- Malformed Act! data: isolate the row as an error and continue previewing other rows.

## Testing

### Unit tests

- Field normalization and canonical snapshots
- Three-way comparison categories
- Conflict-direction decisions
- Act! payload mapping
- XLS/CSV within-file collision detection
- Credential and error sanitization

### Integration tests

- Paginated Act! contact retrieval using a mocked API server
- Bearer-token acquisition and renewal
- Local create pushed to Act!
- Act! create pulled locally
- One-sided updates in both directions
- Concurrent edits becoming conflicts
- Ambiguous first-sync matches
- Shared email with distinct Act! IDs
- Interrupted apply and safe retry
- Rate-limit and permission failures

### UI tests

- Contact search, filters, pagination, and detail display
- Local editing sets **Waiting to sync**
- Preview tabs and counts
- Bulk approval excludes conflicts
- Per-conflict direction selection
- No apply occurs during preview
- Mobile navigation includes Contacts

### Deployment verification

- Database migration succeeds on Render.
- Existing contacts and bookings remain accessible.
- Act! credentials are present only in Render.
- Connection test succeeds without logging secrets.
- A small, owner-reviewed sync can preview and apply in both directions.
- XLS/CSV collision rows cannot be applied.

## Out of Scope for This Phase

- Automatic background synchronization
- Cloud webhooks
- Automatic contact deletion
- Automated merge of ambiguous legacy contacts
- Act! activities, history, opportunities, or calendar synchronization
- Multi-user role design beyond the existing single-owner access check

