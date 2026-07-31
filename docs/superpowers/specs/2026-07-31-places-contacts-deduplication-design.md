# Places and Contacts Deduplication Design

## Goal

Present the CRM as a simple place-and-contact workflow while safely consolidating duplicate Act! place records before they reach the Command Center.

## User-facing model

- **Places** are fairs, cities, venues, companies, and other organizations that may produce bookings.
- **Contacts** are the people associated with a place and the people users call.
- A place detail view shows its contacts, booking opportunities, calling-list membership, and follow-ups together.
- A standalone Contacts search remains available as a secondary utility, but the primary navigation is Places and the place detail view.

The database may retain separate place and contact records because one place can have many contacts and a contact can belong to more than one place. The UI should present the relationship as one working unit.

## Duplicate detection and consolidation

### Automatic merge rule

During Act! preview staging, normalize the source place name and location by trimming whitespace, normalizing case, and removing harmless punctuation/formatting differences. Automatically group records only when both the normalized place name and normalized location match exactly.

For each exact group, select one canonical local place and attach all unique contacts, bookings, groups, and source identifiers to it. Preserve every Act! source identifier in the migration provenance so the merge is reversible/auditable and future previews can match the same records.

### Review rule

Near-matches (for example, spelling differences, missing locations, or conflicting cities) must not be merged automatically. Stage them as possible duplicates with the compared fields and source records visible. A reviewer may merge or keep them separate. No Act! source record is deleted or changed by preview or review.

### Relationship safety

When a merge is approved, relationship inserts must be idempotent and deduplicated. A contact that appears in multiple source rows should be linked once to the canonical place, while its source provenance remains complete. Existing bookings and calling-list memberships must be re-pointed or retained without creating duplicate relationships.

## Navigation and routing

- Use **Places** and **Contacts** as the labels; do not use “People” or “Organizations” in primary navigation.
- The Places list is the primary entry point for calling and booking work.
- Returning from a place detail page must preserve the Places list context rather than opening the standalone Contacts page.
- Existing direct URLs for contacts and organizations remain compatible during the transition.

## Migration flow

1. Stage Act! records in preview mode.
2. Normalize place identity fields and form exact duplicate groups.
3. Show automatic groups as merge proposals and near-matches as review proposals.
4. Apply only approved proposals to Command Center, leaving unresolved proposals queued.
5. Re-run reconciliation and verify canonical place/contact counts before enabling production apply.

## Apply workflow

The migration must provide a complete path from preview to Command Center without requiring a hidden environment switch for normal users:

1. After a preview is finalized, show an **Apply approved changes** action alongside the reconciliation summary.
2. The action opens one confirmation step that summarizes the approved places, contacts, relationships, and calling lists to be written.
3. Applying writes only approved proposals to Command Center. Act! remains read-only and is never modified by this workflow.
4. Unresolved duplicates, ambiguous matches, missing relationships, and explicitly ignored proposals remain queued for later review.
5. The apply operation is idempotent and reports successes, skips, and failures so a small first batch can be verified before applying the remainder.

The default deployment may still protect this action behind an operational rollout control, but the product must expose a clear enabled path when the rollout is authorized; preview-only state must not be the only available end state.

## Validation

- Unit tests cover normalization, exact-match grouping, near-match separation, and stable canonical selection.
- Integration tests cover idempotent relationship migration and provenance retention.
- UI tests cover Places/Contacts labels and back-navigation behavior.
- A preview-only run must demonstrate that duplicate source rows consolidate without changing Act! records.
- An apply test must demonstrate that approved records reach Command Center, unresolved records remain queued, and repeating the apply does not duplicate data.
