# Assistant document workflows

Status: implementation specification for the document stage already authorized in the unified-assistant roadmap. Continues draft PR #947; remains disabled until the workspace release gates pass.

## Intended behavior

The owner can ask the assistant to compare supplied documents, inspect contracts/invoices/payments for a selected event year, start a proposal or invoice from an active Design Studio template, prepare a contract in the existing contract builder, and propose explicit payment or signed-file confirmations. Results link to existing workspaces and preserve canonical records.

1. Read commercial records by selected profile and explicit event year. Unknown-year records appear separately and never contribute to current-year deposit totals. Draft/cancelled invoices and superseded/replaced contracts do not count as outstanding commitments. Payments are read from actual, non-voided payment rows.
2. Compare two to four documents with per-source/version/page evidence and completeness. Different customer/year documents are comparison references, not transferable terms. Image-only sources remain partial unless visually reviewed. Printed signer names, invoice amounts and certificate signatures do not establish contract execution/payment/current insurance.
3. Prepare editable proposal/invoice projects through active Design Studio templates and the current offer catalog, with frozen customer/booking/year. Create contract drafts through the existing active reviewed contract template and builder. Link users directly to the resulting draft editor. Never activate templates or silently replace terms from another event.
4. Explicit approved action cards may save contract field edits, generate the draft contract PDF, record a specifically reviewed payment, or confirm an already-uploaded signed file. Show exact target, old/new amount/status, source reference, and revision. No signature sending, countersigning, or payment initiation is exposed to the model. Replayed requests return recorded outcomes.
5. Reuse existing contract, invoice, Design Studio, and action-ledger services. Database mutations and their result mapping share one transaction; provider/file-producing operations use existing recovery semantics and never claim completion without saved readback.

## Validation examples

Use synthetic fixtures that exercise: prepaid schedule versus pay-per-play; an invoice showing two equal installments without payment evidence; blank signature lines and a printed name; a scanned sample COI; same-date events without a confirmed allocation; document revision changes; mismatched customer/year; historical invoices; voided payments; duplicate approval/restart; and stale record revisions. Supplied customer PDFs are read-only inspection sources and must not enter git.

## Boundaries

Comparisons provide factual differences, not legal advice or an automatic determination that a contract is executed. Human confirmation of signatures and receipts remains explicit. Existing staff/office role models are not broadened; owner access is required. User-approved roadmap includes later campaign and operations work, which remains separate.
