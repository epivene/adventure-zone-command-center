# Business document library operations

The Business Documents library is the protected, canonical copy of Adventure Zone contracts, COIs, applications, templates, and other business files. Gmail and Drive remain source archives: importing never moves or deletes their originals. Access is owner-only by default, including document metadata, profile links, downloads, imports, and review actions.

## Rollout order

Run these gates in order. A successful test or preview does not authorize the next production step by itself.

1. Deploy the schema and API. Confirm required startup migrations complete.
2. Preview legacy app records with `pnpm preview:business-documents`. Save the aggregate output.
3. Apply the legacy migration with `pnpm migrate:business-documents` only after reviewing the preview.
4. Verify the Business Documents page, Profile Documents links, COI compatibility, file opening, and owner-only permissions.
5. Preview only explicitly approved Google Drive folders from **Business Documents → Import**.
6. Run a small Drive pilot (25 files or fewer). Do not select a broad Drive root.
7. Reconcile the pilot with `pnpm report:business-documents --run-id=<run-id>`. Continue only when `reconciled` is `true` and representative files open correctly.
8. Preview a bounded historical Gmail date window and run a small Gmail pilot.
9. Reconcile the Gmail pilot and resolve Document Review items.
10. Enable the hourly Gmail automation. It starts after server maintenance, never overlaps itself, and waits one hour after each settled pass.
11. Retain legacy views and source records until all pilot/full runs reconcile and users confirm the linked profile samples.

## What to verify

- `discovered = imported + deduplicated + review + skipped + retry + failed` for every applied run.
- Error output contains codes only—not private filenames, storage keys, signed URLs, message bodies, or attachment contents.
- Strong exact-profile matches appear on the intended profile; uncertain relationships appear in Document Review.
- COI files are visible through the COI area and the canonical library without an extra upload.
- Gmail/Drive originals are still present.
- An unauthenticated or office-level request receives `401` and no protected metadata.

## Retry and failure handling

Hourly intake tries a failing attachment at most three times in one pass. A repeated failure becomes a review outcome so the cursor can move forward without silently losing the exception. Stable Gmail message/attachment identities and content checksums make reruns idempotent.

## Rollback

Disable new ingestion by stopping the Google document worker/start call in deployment configuration or rolling back the application release. Do not delete canonical documents, blobs, links, import runs, or Gmail/Drive source data. Existing imported records remain available for reconciliation and recovery. Keep legacy screens enabled until the discrepancy is corrected, then rerun a preview/pilot before re-enabling automation.

## Private data rules

Never commit contract, COI, application, or template binaries to Git. Never paste signatures, legal identifiers, Gmail bodies, storage keys, or signed download URLs into tickets, logs, or reconciliation output. The report command accepts only `--run-id` and prints aggregate counts plus allow-listed error codes.
