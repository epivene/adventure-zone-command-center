# Automatic ACT Review Resolution Design

## Goal

Reduce the ACT replacement import review queue to cases that genuinely require human judgment. Apply the owner's approved rules as durable, auditable review decisions, then rebuild the import manifest without refetching ACT.

The automation must work for the current organized run and future one-time import runs.

## Approved Policy

Records can have more than one issue. The resolver applies this precedence so a broad ambiguous-match rule does not override stronger relationship context.

1. Re-evaluate records with `relationship_unresolved` or `unassigned` issues using all available context.
2. Resolve a source identity to an existing local record when there is one unique exact normalized full-name match.
3. Also consider company, email, phone, location, archived relationships, event context, and narrative context. Conflicting evidence or multiple exact-name results remain in review.
4. If no reliable existing identity exists, import the source identity as a new record.
5. Resolve each relationship to a reliable existing or imported parent when possible. If no parent can be resolved and the record can stand alone, import it without that relationship.
6. Import every remaining ambiguous identity as a new record.
7. Resolve every field conflict in favor of the ACT value, including capitalization-only conflicts.
8. Ignore unsupported whole records that contain no useful normalized record data. Keep their raw ACT archive and versions; do not permanently delete source data.
9. Leave only conflicting, non-unique, structurally unsafe, or non-standalone cases for manual review.

## Architecture

Add a server-owned automatic review resolver between organization and user review. It consumes the current durable manifest plus the underlying source/local context, produces ordinary review decisions through existing decision/rebuild boundaries, and returns the rebuilt workflow status.

The resolver does not mutate imported profiles directly. It only records decisions and rebuilds the manifest. The later safe-import phase remains the sole path that writes application records.

### Components

1. **Policy classifier**
   - Classifies each unresolved outcome by its complete issue set.
   - Enforces the precedence above.
   - Produces a proposed action or `manual_review` with a reason.

2. **Context identity resolver**
   - Searches candidates of the expected entity type.
   - Normalizes names consistently with existing matchers.
   - Accepts a unique exact full-name match.
   - Can accept existing authoritative evidence or two independent supporting clue families.
   - Rejects multiple exact-name matches and conflicting target evidence.

3. **Relationship resolver**
   - Resolves every stable relationship slot independently.
   - Prefers an already resolved source parent, then a reliable local target.
   - Uses `assign_parent` for reliable local targets.
   - Uses `keep_unlinked` only when the issue explicitly allows standalone import.
   - Never silently drops a required relationship.

4. **Durable decision writer**
   - Uses existing review-decision validation and immutable source-version fencing.
   - Records `keep_separate`, `link_existing`, `assign_parent`, `keep_unlinked`, `use_source`, and `ignore_source` decisions as appropriate.
   - Uses a deterministic request key so retries are idempotent.

5. **Manifest rebuild**
   - Rebuilds once after the automatic decision batch.
   - Preserves the existing manifest digest and stale-version safeguards.
   - Reports resolved counts by policy and remaining manual-review counts.

## Decision Details

### Ambiguous identities

- If the record also has a relationship or unassigned issue, run contextual resolution first.
- A unique exact normalized full-name match to the expected local type is sufficient to link.
- Otherwise save `duplicate_identity: keep_separate`, which creates a new local record during import.
- Duplicate profiles can be handled later by the application's duplicate checker.

### Relationship issues

- Re-use stable relationship slots from the manifest.
- Search only the issue's expected parent entity types.
- Link automatically when one exact full-name result exists or the existing proof policy identifies one target safely.
- If no target exists, keep the child as a new identity and use `keep_unlinked` when standalone import is allowed.
- If a relationship is required, evidence conflicts, or multiple candidates remain, keep it in manual review.

Example: an ACT contact named Natalie Andelin with a relationship issue searches local contacts. Exactly one local Natalie Andelin results in `link_existing` for that contact. Any separate unresolved parent slot is then resolved independently.

### Field conflicts

- Create `use_source` decisions for every current conflicted field.
- Capture the existing immutable local/source fingerprints required by reviewed overwrite operations.
- A later local edit that changes the fingerprint blocks the overwrite rather than erasing the concurrent edit.

### Unsupported records

- `normalization_failed` and `unknown_normalized_kind` whole-record outcomes receive `unsupported_record: ignore_source`.
- Their source records, raw payloads, observations, and versions remain in the archive.
- Unsupported fields on an otherwise useful normalized record do not cause the whole record to be ignored.

### Unassigned records

- Re-run identity and parent resolution using name, company, email, phone, location, archived relationship, event, and narrative clues.
- Import standalone only when the issue declares that safe.
- Preserve genuinely uncertain or structurally dependent records for review.

## API and UI

Expose one authenticated action for the owner to run automatic cleanup on an organized run. The action returns:

- decisions created or replayed;
- identities linked to existing records;
- identities marked to import as new;
- relationships assigned or safely omitted;
- ACT field conflicts selected;
- unsupported records excluded;
- records still requiring manual review;
- rebuilt manifest digest/status.

The Review screen should label these as automatically resolved and refresh to show only remaining issues. It must not claim an uncertain relationship was resolved.

## Safety and Recovery

- No ACT archive rows are deleted.
- No profile data is written during automatic review.
- Every decision is source-version fenced, actor-attributed, and idempotent.
- Existing conflict-proof checks protect local edits before ACT overwrites.
- Multiple or conflicting candidates always remain for manual review.
- The resolver can be rerun safely after interruption.

## Tests

Test the policy with real manifest behavior, including:

- relationship issue plus ambiguous identity uses a unique exact full-name match instead of importing a duplicate;
- duplicate exact full names remain unresolved;
- no identity match creates a new record and safely omits an optional relationship;
- remaining ambiguous identity imports as new;
- all field conflicts create proof-bound ACT-value decisions;
- unsupported whole records are ignored while their archive remains untouched;
- unsupported fields do not discard a useful record;
- unassigned records use each context clue family and reject conflicting evidence;
- required/non-standalone unresolved relationships remain in review;
- repeated cleanup requests are idempotent;
- stale source versions and concurrent local edits are rejected;
- rebuilt manifest and review counts match the saved decisions.

## Success Criteria

- Natalie Andelin-style unique name matches resolve automatically.
- Broad ambiguous cases become new records without blocking import.
- ACT wins approved field conflicts without bypassing concurrency protection.
- Unhelpful unsupported whole records disappear from import/review but remain recoverable in the archive.
- Context-rich unassigned records receive another safe resolution pass.
- Only cases where the server would have to guess remain for the user.
