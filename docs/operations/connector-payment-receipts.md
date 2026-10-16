# Connector payment receipts

The connector can record an owner-authorized receipt of money against an existing invoice. This is bookkeeping, not a charge, transfer, deposit to a bank, or clearance confirmation. It never sends mail or completes reminders.

1. Find the invoice with `list_app_records` (`section=invoices`, verified profile ID).
2. Read `read_invoice_payment_context` and compare the invoice number, profile, and every existing payment with the owner's evidence.
3. Call `record_invoice_payment` with its exact revision, amount in cents, received date, method, check/reference, factual notes and a stable request key. Identical retries recover the committed receipt. Stale revisions or duplicate candidates require rereading; do not bypass them by changing dates or keys.
4. Read the invoice again and verify the payment and resulting balance. A recorded check is not confirmed bank clearance.
5. Call `upload_payment_image` with the resulting payment ID and the original PNG/JPEG bytes as canonical base64, up to four MiB. The caller must actually have the file; never reconstruct it from a description. Filename, MIME type and file signature must match. No arbitrary URL download is supported.
6. Verify the returned document ID in the profile's private document library and in `read_invoice_payment_context.images`.

The connector client must refresh its tool catalog after server deployment. Clients without attachment-byte access cannot use the upload tool directly: provide the original file to a client that can transfer it, or upload through the app. A payment entry and an image upload have separate receipts; report partial success accurately.

Payment writes and private images require the existing `crm:append` grant. Read-only grants remain read-only. The consent description includes these capabilities. Existing records, rules and reminders are retained. Ledger entries, audit and operation receipt commit atomically. Invoice locks serialize payment writes; image storage occurs before a short database transaction so cloud latency cannot hold database locks. Blob storage is private and content-addressed; failed database commits may leave a reusable unreferenced blob, which this workflow never deletes.

Images use existing business document tables and immutable versions, with owner visibility and a profile link. Source metadata records invoice ID, payment ID and SHA-256; the read tool returns document IDs without storage keys or public URLs. No schema migration or background job is required. The same image for the same payment deduplicates across retry keys. Distinct images remain separate evidence.

Rollback: revert the connector code. Retain all recorded payments, audit entries and private documents; they remain readable in the app's existing ledger/library.
