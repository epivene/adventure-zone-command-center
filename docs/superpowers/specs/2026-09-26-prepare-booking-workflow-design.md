# Prepare this booking: sourced context and guided workflow

Status: proposed design for owner review. This document does not implement or deploy a workflow.

## Goal

Desiree approved improving the assistant through context and guided app workflows before custom model training. The first workflow is **Prepare this booking**: gather the relevant records for one event, make missing or conflicting information visible, and prepare the requested next draft or action for review. The owner should not have to repeatedly explain which app sections to check.

This workflow must respect daily/monthly spending controls and retain useful progress when a paid run pauses. It must work in the existing phone-first assistant workspace, including folded and unfolded layouts.

## Existing foundation

The current source already provides selected-profile scope, source evidence, commercial records, approved-template retrieval, email/document tools, calendar reads, revision-checked actions and owner approvals. Saved information and conversation lifecycle controls are in PR #958; spending controls and saved research reuse are in PR #959. Their presence in source does not establish deployment.

Relevant existing modules include `model-tools.ts`, `orchestrator.ts`, `production-reads.ts`, `commercial-evidence.ts`, `commercial-tools.ts` and the AssistantWorkspacePage. Extend these foundations instead of creating a second CRM or a separate set of payment/signature rules.

## Owner experience

1. Open an event profile or select it in the assistant, then choose **Prepare this booking** or ask for it in chat.
2. Show the chosen customer, event year and exact booking/opportunity when known. Ask one focused scope question only when the target is ambiguous. Never silently choose the current calendar year or the first booking for a customer.
3. Show a compact checklist with stages: profile and contacts; correspondence and agreed terms; dates and logistics; documents and payments; next action.
4. Each stage shows **Not checked**, **Checking**, **Verified**, **Needs your input**, **Unavailable**, or **Changed since checked**. Include source links and retrieval dates. A successful tool call alone does not make a stage Verified.
5. End with a concise preparation summary: verified facts, missing/conflicting facts, existing contract/deposit status, and the recommended next action. Offer the appropriate draft/review action through existing app controls.

The final label is **Ready for owner review** only when all checks required for the requested output have complete, relevant evidence. It is never a booking-confirmation label.

## Context and evidence

Use applicable owner-approved rules and notes scoped to the selected customer, event year and effective dates. Retrieve current source records when needed. Examples of approved writing can guide tone but cannot establish a current price, availability, recipient, payment or insurance fact.

Evidence must identify source type, record ID, version/revision, retrieval time, completeness and event/booking scope. Preserve those references with the workflow, not a duplicated unlimited copy of every source. Full thread and document reads may use existing stored results, but pagination, unreadable pages and unavailable attachments remain explicit gaps.

New owner corrections use the existing saved-info review flow. A correction about one customer/year must not become a global rule. Do not import remembered business terms from this development conversation as verified live application data.

## Stage requirements

| Stage | Read and compare | Block the affected output when |
| --- | --- | --- |
| Profile and contacts | Canonical profile, selected booking/opportunity, active contacts and relevant history | Event/year is ambiguous, target record is unavailable, or recipient is not established |
| Correspondence and terms | Complete relevant incoming/sent threads, latest offer and applicable approved rules | Latest agreement is missing, scope is partial, or payment model/package/price conflicts |
| Dates and logistics | Event dates, calendar notes, buffers, route/leg constraints and existing commitment evaluator where available | A requested date/availability commitment lacks complete checks or conflicts |
| Documents and payments | Linked proposal/contract versions, invoices and payment records for the exact booking and year | Signing/payment is unconfirmed, record year is unclassified, or required source cannot be read |
| Next action | Required facts, latest approved template and existing action state | Proposed output would invent a term or duplicate an existing draft/action |

Customer-year commercial totals can cover several bookings. The workflow must resolve the exact booking for booking-specific amounts; it must not assign an aggregate balance to one event. Historical contracts are evidence of prior arrangements, not automatic authority for this year's terms. Uploaded signatures and invoice amounts alone do not establish execution/payment. A sample COI does not establish event-specific coverage.

A missing fact blocks only the dependent action. For example, the assistant can prepare a neutral question requesting clarification while holding a final contract. It must explain the discrepancy and needed confirmation plainly.

## Workflow state and actions

Use a versioned server-side workflow record tied to the authenticated owner, conversation, canonical customer, event year and booking/opportunity scope. Store workflow definition version, stage results, source references, last checkpoint, blocker codes and resulting draft/action IDs. Record revision-checked progress after each stage.

Server code defines stage prerequisites and permissible transitions. Model text may summarize evidence or propose next steps but cannot self-certify completion, change scope silently, override blockers, authorize writes or raise a budget.

Reuse existing authorization, action-review, idempotency and record-revision mechanisms. Starting preparation authorizes the reads needed to prepare a review; it does not send email, issue an invoice, confirm payment/signature or mark dates booked. Show separate draft-prepared, action-approved, action-completed and synchronization-incomplete states based on actual receipts.

## Resume and freshness

Resume from the last durable checkpoint when a run ends or a budget pause occurs. Show completed and outstanding stages. Do not repeat paid extraction or research merely because a run restarted.

Before reusing a stage for an action, check source revisions and applicable rules through existing read paths. A changed or inaccessible source invalidates the affected stage and dependent outputs. Switching customer/year starts or selects a separately scoped workflow; it cannot carry Verified statuses from the prior selection.

Explicit cancellation stops further work through the existing cancellation path. Archived/trashed conversations remain read-only. Offline mode may display a dated snapshot but cannot mark checks current, create approvals or start paid work. Source text and attachments remain untrusted and cannot issue instructions to the workflow.

## Costs

Use narrow relevant reads and the current approved rules for the selected scope. No automatic public research when internal evidence is sufficient. Any needed paid work uses the shared spending provider and reservation ledger. A spending pause preserves the checklist and drafts and explains the next action; it must not retry with a different model to bypass the limit.

No fine-tuning or new model service is required for this workflow. Later evaluation may use approved examples and corrections, with a separate decision before exporting a training dataset.

## Verification and acceptance

Test against controlled fixtures, not live messages or paid model calls. Required cases:

- A complete single booking produces a sourced review summary and a draft without sending or confirming it.
- Multiple bookings in one year require exact scope and never reuse aggregate customer amounts as booking-specific balances.
- Conflicting prepaid/pay-per-play terms hold the affected output while allowing a clarification draft.
- Partial email history, unreadable attachments, unclassified years, missing payments and sample COIs remain explicit gaps.
- Source edits, scope switches and rule changes invalidate dependent stage results.
- Budget pause/restart and uncertain action responses preserve progress without duplicate charges or actions.
- Owner isolation, stale-version updates, cancellation, archived conversations and offline snapshots preserve existing protections.
- Fold-sized layouts keep checklist, source details, blockers and next actions usable with the on-screen keyboard.

Model evaluation should measure the resulting behavior: correct scope, required source coverage, accurate blockers, no unsupported claims and appropriate next action. A polished response without complete required checks fails acceptance.

## Deferred

Other workflow playbooks, a full app capability map, and a code-change request/preview/approval pipeline are later work. They are not implemented by this booking workflow. A model must never claim it changed application code based only on saving a feature request.
