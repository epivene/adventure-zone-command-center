# Act! CSV Import Procedure

This procedure is the fallback when the live, manually triggered Act! sync is
unavailable. The CSV workflow imports into the Command Center only and never
writes back to Act!. For normal operation, use
[the reviewed Act! sync](./act-sync.md).

## Before exporting

- Confirm you are signed in as the configured owner.
- Make an encrypted application database backup.
- In Act!, choose stable columns for record ID, contact name, organization,
  email, phone, city, and state where available.
- Keep Act! record IDs unchanged between test and full exports.
- Do not open or resave the CSV in software that rewrites identifiers,
  encodings, dates, or leading zeroes.

## Test-set procedure

1. **Export a small test set from Act!.** Use five to twenty representative
   contacts. Include at least one known new record, one existing record with a
   safe change, and—when available—a duplicate or ambiguous match. Save the
   export as a `.csv` file no larger than 5 MB.
2. **Upload the CSV to Preview.** Open Settings → Import fallback, choose the file, and
   select **Preview CSV**. Preview may store review-run metadata, but it must
   not change contact fields or send anything to Act!.
3. **Review every category.** Inspect **New**, **Changes**, **Duplicates**,
   **Conflicts**, and **Errors**, even when a category count is zero. Compare
   identifiers, names, organizations, email addresses, phone numbers, city,
   state, match reasons, and before/after values with the Act! export.
4. **Apply only approved rows.** Select only rows whose changes you have
   verified. Duplicates, conflicts, and errors are review-only and must not be
   force-applied. Record the preview run ID, selected row count, and operator,
   then select **Apply approved** once.
5. **Compare counts and inspect five sample records.** Compare the previewed,
   approved, and applied counts. Confirm the result reports exactly the
   approved row IDs. Inspect five applied records in this app against the CSV,
   including any changes to an existing record. Confirm unapproved rows and
   Act! itself did not change.
6. **Import the full file only after the test succeeds.** If counts differ, a
   sample is wrong, or any category is unexplained, stop. Resolve the export or
   matching issue and repeat with a new small test set before uploading the
   full export.

## Full-file procedure

Repeat the same Preview → review all five categories → approve exact rows →
Apply sequence. Do not use **Approve All Safe Changes** until every New and
Changes row has been reviewed. Save the source filename, export time, preview
summary, approved count, applied count, five-record sample, and operator in the
import operations log.

If the Apply request fails, do not upload the file again until you inspect the
existing run. Apply is transactional: the intended result is all approved rows
or none. A run that has already been applied must not be applied again. The
application locks matched contacts and claims each Act! record ID uniquely
during Apply. If another preview wins either race, the losing run remains
unapplied and reports deterministic conflict rows; review and preview fresh
data instead of forcing those rows.

## Stop and investigate when

- Act! record IDs are missing, duplicated unexpectedly, or reformatted.
- New/Changes counts are materially different from the export.
- A row appears in Conflicts or Errors without a understood reason.
- An expected existing contact appears as New.
- An expected change appears as a Duplicate.
- The applied count differs from the approved count.
- Any application record changes during Preview beyond review-run metadata.

Keep the source CSV in restricted storage according to the same privacy rules
as contacts and contracts. Delete local working copies through the approved
records-retention process after verification; never attach the full export to
email or chat.
