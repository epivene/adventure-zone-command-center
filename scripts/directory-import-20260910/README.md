# Public fair-directory import — September 10, 2026

The convention workspace had small lists and many unlinked cards. The user requested complete convention research lists plus general lead profiles discovered along the way. This one-time transactional migration matches existing organizations, creates new organization/contact profiles where identity is clear, records source facts in profile history, and links association members to the five existing 2026 convention editions.

## Prepared sources

| Directory | Source records |
| --- | ---: |
| RMAF fairs | 120 |
| RMAF service members | 152 |
| Heartland fairs | 60 |
| Colorado directory | 71 |
| AFA fair members | 20 |
| AFA associate members | 113 |
| Wyoming fairs | 24 |
| Wyoming service members, excluding our own business | 9 |
| ShoWorks parent listings | 666 |
| Total | 1,235 |

These are source records, not new-profile counts. The 857 ShoWorks registration rows are retained under 666 parent name/state groups, with one test site held aside. Parent grouping removes parenthetical registration-section labels and does not create or combine booking opportunities. The seed contains 479 usable named-contact records and 444 syntactically valid, non-blocked email records; emails are published facts, not delivery-verified addresses. The preparation report retains 52 historical Wyoming attendance rows whose affiliations need verification and the test site.

## Evidence and matching

- Association-directory membership is explicitly `association_only`, never confirmed convention attendance. No ShoWorks record is attached to an association based on its hostname, state, or registration portal.
- Existing AFA profile IDs were read from the rendered convention cards. Missing or consolidated IDs are held for review.
- Other organizations match by normalized name plus region, or by the combination of phone and full website URL with compatible regions. Multiple matches and same-name records with insufficient location evidence are held without creating duplicates.
- Existing profile fields, contact details, primary contacts, outreach status, restrictions, and convention responses are preserved. Source conflicts, including known retired/bounced addresses, stay in source facts rather than replacing active addresses.
- Existing linked convention cards receive appended research evidence. Unlinked cards require a unique name plus matching email or full contact name. Other same-name unlinked cards are left for identity review instead of receiving duplicate cards.
- New cards use the `confirm` group and ask for role/attendance review. No bookings, event dates, follow-ups, email drafts, or messages are created.
- Every source row is auditable in `directory_import_records`; statuses are `created`, `matched`, `review`, or `excluded`. Existing-profile source details appear as notes in profile history. Repeating the completed migration is a no-op.

## Remaining source limitations

Western Fairs' full member directory requires member access; these other directories do not establish WFA membership. No additional Western Fairs cards are invented. Colorado's 71 extracted detail pages exclude two failed association pages. Heartland's public extraction obscured emails. Some source names/addresses have publisher errors and must be verified before outreach. Historical Wyoming annual-meeting roll calls are not complete convention-registration rosters.

## Rebuild and verification

`seed.json` is the canonical reviewed input. Run `node scripts/directory-import-20260910/build.mjs` to regenerate the migration. The source template and generated migration must stay synchronized.

`test.mjs` uses `@electric-sql/pglite` 0.5.8. Install it in a temporary test directory and pass its module path through `PGLITE_MODULE`, or provide it through the usual module resolution. Run `node scripts/directory-import-20260910/test.mjs`.

Tests exercise the production convention-table DDL with a constrained organization/contact/activity fixture: different-state names, ambiguous and missing-location matches, missing known IDs, self-exclusion, preservation of current email and do-not-contact handling, unique unlinked-card reconciliation, and repeat-import idempotency. A second isolated run exercises all 1,235 seed rows and checks that general ShoWorks leads do not become convention members. Isolated fixture counts are not production import results.

The startup migration marker is created in the same transaction as the import completion record. A failed import rolls back all changes. This migration adds profiles and notes; it does not delete or merge existing records.

## Inspect live results

```sql
SELECT status, count(*) FROM directory_import_records
WHERE batch = 'public-directories-20260910-v1' GROUP BY status;

SELECT payload->>'name' AS name, payload->>'group' AS directory, reason
FROM directory_import_records
WHERE batch = 'public-directories-20260910-v1'
  AND (status='review' OR reason<>'');
```
