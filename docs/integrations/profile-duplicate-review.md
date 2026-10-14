# Profile duplicate review and reversible merges

Owner app: **Profiles → Find duplicates**, `/profiles/duplicate-review`.
The existing React/Vite/Wouter app uses a new owner-authenticated Express router
and two additive PostgreSQL tables. Existing profile fields and permissions are
unchanged. No service, provider, scheduler or paid resource is added.

## Detection and prevention

The scan reads all non-retired organizations and persistent dismissed pairs. It
normalizes case, accents, whitespace, apostrophes, saved location suffixes and
generic fair/company wording. It keeps distinguishing county names. Token overlap,
distinctive subtitles and bigram similarity contribute up to 75 points; matching
city adds 15 and matching region adds 10. High is 88+, Medium is 68+, and Low is
48+. Conflicting locations, years or seasonal event wording cap confidence below
Medium. Scores are heuristics, not proof of identity.

The scan does not create proposals or change profiles. Not duplicates saves a
permanent unordered-ID pair dismissal. Skip is session-only. New-profile creation
debounces a read-only matching request; warnings provide an inline comparison and
an existing-profile link without blocking Save.

## Review and preservation

The comparison displays all organization columns, highlights differences, and
expands all discovered linked rows side by side. Choose the survivor and values for
name, city, region, address, phone, website, type and primary-contact preference.
All contacts remain; contact preference only controls the primary designation.
Other conflicting profile values remain in the audit journal, with both original
values and their provenance.

The new merge path never invokes the legacy hard-delete repository. It uses one
pinned transaction and the existing family advisory/ACT/organization lock order.
Catalog-discovered foreign keys and legacy named references cover bookings,
activities, emails, notes, document links, health data, deadlines and child profiles.
Connector JSON draft links are included and their revisions change. Remote Gmail
content and labels are not edited. Immutable historical operation/audit records
continue referencing the original, which still exists.

Contacts' composite membership FK and location triggers are respected. A shared
contact retains both membership rows: the source membership is made inactive,
its original role is explicitly recorded as a conflict, and its live survivor
membership remains. Sources use existing consolidated_into_id/consolidated_at
soft archival. The journal retains full before/after snapshots, selected fields,
preserved differences, IDs and timestamps.

Uniqueness/FK/check conflicts in other linked tables roll back the entire merge
and identify the blocking table. The tool does **not** discard equivalent links,
consolidate same-year booking rows, or guess between conflicting date facts. Such
pairs need their linked conflict resolved before merging. Parent/child profile
pairs and source profiles with in-app assistant drafts in a separate approval
lifecycle also stop safely. Comparison is capped at 8 MB; missing primary keys
block journaling. These limitations are visible errors, never partial success.

## Undo

Merge history provides Undo with no expiration (including beyond 30 days).
Undo reverses the journaled fields and reference moves, restores both profiles,
and records undone_at. It does not delete rows. Later edits to unrelated fields
and newly created records remain. If a moved field has since changed, a moved row
is missing, or a new dependent row uses a moved location, undo stops atomically
with an explanation instead of overwriting later work. Snapshots remain available
after that conflict. An already-undone request is idempotent.

## Validation and deployment

Apply `20261015_reversible_profile_duplicates.sql` through the existing migration
runner; it is also registered in startup migration readiness checks. Deploy API
and frontend together. Existing connector and legacy merge entry points are not
rewritten and do not gain retrospective undo.

Focused PGlite tests exercise real SQL catalog discovery, membership uniqueness,
composite FKs, location triggers, archival, complete snapshot restoration, linked
notes/documents/bookings/deadlines/health/JSON drafts, stale previews, transactional
rollback, dismissal and undo after 45 days. HTTP tests use the actual owner-token
middleware. UI tests cover read-only scanning, explicit merge confirmation, skip
and dismissal. A full monorepo build and deployed production-schema merge have
not been verified in the partial local checkout.

## Preliminary live read-only scan — 2026-10-14

Ran the new matcher locally on 665 unique live profile summaries retrieved via
the existing read connector (650 paginated records plus targeted searches). This
is a **partial database sample**, not an exhaustive production scan. It found
4 High, 9 Medium and 122 Low suggestions. Existing app dismissal state was not
available through that connector. No live records were merged or modified.

First High candidates:

| First profile | Second profile | Score |
| --- | --- | --- |
| County Fair - Sweetwater (Rock Springs) WY | Sweetwater County Fair | 100 |
| Blast on the Grass, A (Hagerman) ID | A Blast on the Grass | 100 |
| Wyoming State Fair | County Fair - Wyoming State Fair (Douglas) WY | 100 |
| County Fair - Central Wyoming Fair & Rodeo (Casper) WY | Central Wyoming Fair | 96 |

The installed app's Scan action reads the full active profile table and honors
saved dismissals. The sample also suggested Sweetwater County Fair - Wyoming's Big Show against
both shorter Sweetwater names at Medium (81), because its city is missing.
