# Act Context-Clue Review Design

**Date:** 2026-08-10

**Status:** Approved design

**Scope:** Reduce manual review in the one-time Act archive import without weakening import safety.

## Problem

The saved Act archive organizes successfully, but the current review manifest contains 14,044 records requiring review and only about 1,500 safe operations. Reviewing every record individually is not practical.

The archive contains enough repeated information to resolve many records deterministically. Companies, contacts, notes, history, opportunities, and relationship streams often repeat names, locations, email addresses, phone numbers, websites, event details, and explicit Act relationships. The importer should use those clues together while leaving genuinely ambiguous records untouched.

## Goals

- Reduce the number of records requiring manual review.
- Infer identity and parent relationships from deterministic context clues.
- Require two independent clues before creating a new inferred match.
- Reuse stable Act-to-local links and explicit archive relationships as authoritative evidence.
- Import supported core data even when unsupported custom fields are present.
- Make bulk decisions practical and explain why each recommendation is safe.
- Rebuild from the saved archive; do not require another Act fetch.
- Preserve all unsupported source data in the archive.
- Never overwrite a non-empty local value automatically.

## Non-goals

- No probabilistic or generative AI matching in this phase.
- No single-clue fuzzy-name matching.
- No automatic resolution when two candidates remain tied.
- No automatic deletion or replacement of local CRM records.
- No removal of archived source fields.
- No attempt to support every Act custom field before importing the supported part of a record.

## Considered Approaches

### 1. Deterministic multi-clue resolver — selected

Resolve a record only when a stable link exists or at least two independent clue families agree on one target. This is explainable, reproducible, testable, and safe enough to feed the existing automatic-review pipeline.

### 2. Aggressive single-clue matching

Resolve on one strong clue such as phone, email, or normalized name. This would clear more review work but creates unacceptable risks around shared phone numbers, shared mailboxes, renamed organizations, and common event names.

### 3. Generative AI interpretation

Send notes and history through a language model to infer relationships. This could understand loose prose, but it is less deterministic, slower, harder to audit, and unnecessary for the structured clues already in the archive.

## Safety Model

### Authoritative evidence

The following may resolve a target without the two-clue rule because they are existing durable identity evidence:

- A valid previously confirmed Act-to-local external link.
- An explicit source relationship whose parent has already been resolved to exactly one local or newly imported entity.
- A prior active review decision that still matches the same source version and local-value fingerprints.

### Independent clue families

New inferred matches require agreement from at least two different families:

1. **Identity:** normalized person or organization name.
2. **Direct contact:** normalized non-shared email or normalized phone.
3. **Web identity:** normalized website host.
4. **Location:** city + region, postal code, or normalized street address.
5. **Archive relationship:** company-contact, opportunity-company, opportunity-contact, or group-contact edge.
6. **Event context:** event/opportunity name plus date, city/region, or organization reference.
7. **Narrative context:** an exact normalized name/email/phone/event reference extracted from note or history text.

Two values from the same family do not count as independent. For example, first name and last name are one identity clue; city and state together are one location clue.

### Blocking conditions

An inferred match remains in review when any of these apply:

- More than one target satisfies the same strongest evidence.
- Two clue families point to different targets.
- A shared mailbox or shared business phone is the only direct-contact evidence.
- The match crosses incompatible entity types.
- A narrative clue is fuzzy rather than an exact normalized reference.
- The source contains a non-empty value that would overwrite a different non-empty local value.
- A dependency is unresolved.

## Resolution Pipeline

The organizer runs deterministic passes until no additional records resolve.

### Pass 1: canonical entities

- Resolve organizations and contacts using stable links.
- Match existing organizations using combinations such as name + city/region, name + website, or name + phone.
- Match existing contacts using combinations such as compatible name + non-shared email, compatible name + phone, or compatible name + resolved organization relationship.
- Mark records with no viable existing candidate as new only after duplicate checks across both the local CRM and the entire saved Act archive.

### Pass 2: explicit relationships

- Resolve company-contact and opportunity relationships when both endpoints are resolved.
- Use the resolved organization relationship as an additional clue for contacts with incomplete identity fields.
- Carry parent resolution forward to notes, history, activities, opportunities, and group memberships.

### Pass 3: event and narrative context

- Extract exact normalized names, email addresses, phone numbers, event names, dates, and locations from supported narrative fields.
- Resolve a note/history/activity parent only when at least two independent clues agree on the same target.
- Prefer a resolved explicit relationship over narrative inference.

### Pass 4: dependency replay

- Revisit records blocked only because their parent was unresolved in an earlier pass.
- Convert newly resolved operations into safe additions or empty-field fills.
- Leave remaining ties and contradictions in review.

The pipeline must be idempotent: rebuilding the same archive against unchanged local data produces the same manifest and explanations.

## Unsupported Data Handling

Unsupported fields and unsupported records are different:

- **Unsupported fields:** preserve every source path/value in the archive, show the count diagnostically, and continue importing the supported core record. Unsupported fields alone must not force the whole record into review.
- **Unsupported record types:** keep the complete record in the archive. Permit a bulk “leave archived” decision when the app has no compatible local entity type.

An unsupported field may still block an automatic operation if it is the only evidence available for identity or if applying the supported portion would otherwise create an ambiguous duplicate.

## Recommendations and Bulk Review

Each context resolution stores a compact evidence explanation, for example:

- `Matched organization using name + city/state`
- `Matched contact using name + email`
- `Attached history using explicit company relationship`
- `Attached note using event name + event location`

The review screen groups recommendations by action and evidence signature. It provides:

- **Accept all safe context matches** for recommendations already meeting the safety model.
- **Import clear unmatched records as new** after duplicate checks.
- **Attach resolved history/notes** after their parent resolution.
- **Leave unsupported record types archived** in bulk.
- Existing per-record controls for exceptions.

Bulk commands use the existing manifest digest, source version, review token, request key, and decision ledger. They operate in bounded batches and are retry-safe. The UI shows the exact count before confirmation and refreshes the manifest summary after completion.

The existing “Import safe records” operation remains a separate final step. Context processing and bulk review only prepare or approve manifest operations; they do not modify CRM profiles by themselves.

## Data and API Changes

- Extend organized outcomes with structured context evidence:
  - clue family
  - normalized matched value or non-sensitive fingerprint
  - target entity type/id
  - resolution reason
  - confidence class (`authoritative` or `two_clue`)
- Persist evidence with the manifest so review remains durable across restarts.
- Add a context-resolution summary to the run/review response:
  - automatically resolved count
  - recommended bulk count
  - remaining ambiguous count
  - counts by reason
- Extend the existing bulk-decision endpoint rather than introducing a parallel review system.
- Keep request sizes bounded and process large groups in server-side chunks.

## UI Behavior

- Display a “Context clues resolved” summary above the remaining review count.
- Show an expandable explanation on each resolved/recommended card.
- Provide a single primary bulk action for safe context recommendations.
- Require confirmation containing the record count and a reminder that filled local fields will not be overwritten.
- Keep ambiguous candidates visible with their conflicting clues.
- On mobile, bulk actions remain reachable without opening every card.
- Avoid repeatedly loading assignment targets for every card; load candidates only for visible unresolved cards or after a search begins.

## Failure and Recovery

- Organizer failure leaves the prior completed manifest available.
- Context processing is performed before publishing the replacement manifest.
- A partial bulk request can be retried with the same request key without duplicate decisions.
- Stale source versions, fingerprints, or manifest digests reject the action and require a refresh.
- Errors identify the failing phase and record count without logging sensitive full note bodies.

## Testing Strategy

### Unit tests

- Two independent clues resolving one target succeeds.
- Two clues from the same family do not satisfy the threshold.
- Conflicting clues remain ambiguous.
- Shared emails and shared phones never resolve identity by themselves.
- Exact stable links remain authoritative.
- Unsupported fields do not block supported core data.
- Narrative extraction only counts exact normalized references.
- Resolver output is deterministic regardless of input order.

### Organizer tests

- Resolution cascades from organization to contact to history/note.
- Dependency replay resolves children after parents.
- Duplicate checks include local and in-archive candidates.
- Rebuilding produces an identical manifest for unchanged inputs.
- Existing decisions remain active only for unchanged source/local fingerprints.

### API and UI tests

- Context summaries and evidence are returned correctly.
- Bulk commands are bounded, idempotent, and stale-manifest safe.
- Confirmation displays the exact count.
- Mobile review exposes bulk actions.
- Assignment targets are not fetched once per card on initial render.

### Production validation

- Rebuild the current saved archive without refetching Act.
- Compare the before/after counts for safe, context-resolved, and remaining review records.
- Sample resolved records from every evidence signature before importing.
- Import safe operations in batches and monitor blocked/failed counts.

## Success Criteria

- The organizer completes without an out-of-memory failure.
- Every automatic inferred match has authoritative evidence or two independent clue families.
- No automatic operation overwrites a non-empty local field.
- Unsupported fields remain preserved and no longer block otherwise safe core records.
- The remaining manual-review count decreases materially from 14,044.
- The user can resolve whole groups through bounded bulk actions rather than opening records individually.
- The full import remains auditable and restart-safe.
