# Assistant workspace: Stage 1 review and rollout

The upgrade adds a persistent owner workspace at `/assistant/workspace`, backed by the OpenAI Responses API and the app's existing Gmail, CRM, document, reminder, and operational-calendar services. It is disabled by default. This branch is a review candidate, not a production activation.

## Implemented

- Saved conversations, selectable configured models, durable runs, progress replay, cancellation, and verified action receipts.
- Owner authentication and allowlist; no provider keys in browser responses. Uses the existing password/HMAC owner session, not Clerk.
- Profile and full-thread reads, sent history, attachment/document extraction, visual transcription explicitly marked as requiring review.
- Active reviewed templates, editable local drafts, Gmail draft save/readback, preserved recipients/thread/attachments, exact revision review and explicit send.
- Durable send recovery by stable message ID and Gmail Sent readback. Confirmed delivery remains final when tracking fails; Repair tracking never resends.
- Send review binds current email history, profile, linked documents, approved rules and template versions. Changed sources require renewed review. Event year and booking are stored in draft context.
- Proposed record/reminder/calendar actions, existing reminder preservation, exact-target approval, timed events without attendee invitations.
- Versioned sourced business rules with explicit approval; current customer/year scopes refresh after selection changes. Seed does not overwrite reviewed rules.

## Configuration

Set these server-side for an owner-only pilot after validation:

```
ASSISTANT_WORKSPACE_ENABLED=true
ASSISTANT_WORKSPACE_ACTOR_IDS=owner
ASSISTANT_OPENAI_MODEL=<Responses-capable model available to your API project>
ASSISTANT_OPENAI_MODELS=<comma-separated approved model IDs, including default>
OPENAI_API_KEY=<server secret>
```

Optional limits: `ASSISTANT_MAX_STEPS` (12), `ASSISTANT_MAX_OUTPUT_TOKENS` (8192), `ASSISTANT_MAX_RUN_TOKENS` (100000), `ASSISTANT_MODEL_TIMEOUT_MS` (120000). Run usage includes visual tool usage; the limit is checked between calls, so an in-flight call can exceed the remaining budget. Visual assistance is separately bounded to 5 MB and ten requested pages. Gmail and calendar require the corresponding existing Google connections/scopes. Sending also requires the existing outreach-dispatch/allocation system to be enabled and a valid reviewed template.

The embedded additive migration mirrors `lib/db/migrations/20260924_assistant_workspace.sql`; startup only applies it and seeds approved rules when the feature flag is true. Confirm database backup and real PostgreSQL migration behavior before enabling. Keep `pdfjs-dist` installed at runtime: its worker is external to the API bundle.

This uses an OpenAI API project and its model access. It does not embed this ChatGPT session, automatically import ChatGPT memory, or transfer ChatGPT connectors/subscription into the app. Business context comes from the app's saved records and approved rules.

## Recovery and rollback

Set the feature flag false and restart to disable new workspace access/worker processing; the original assistant remains available and stored records are retained. Do not drop workspace tables as a rollback. Do not automatically retry a send whose provider result is uncertain. Use Check result for readback; require an operator to resolve cases where no unique Sent match exists. A confirmed send with incomplete CRM/archive work offers Repair tracking. Changing the connected Google identity blocks actions bound to the old identity.

Approvals apply to exact saved revisions and targets. A changed draft, contact, source snapshot, account, or capacity approval requires renewed review. Sending may complete despite a later browser/network failure; inspect the stored receipt rather than sending another copy.

## Validation and release gates

Automated coverage includes PGlite-backed ownership, atomic submission, worker fencing, deduplication, draft revisions, send/reconcile paths, source-change rejection, real PostgreSQL DATE parsing, rule scope, document completeness, API authentication and React interactions. Provider tests use controlled doubles; no customer emails were sent during development. Both API and browser production builds were exercised. Full repository typechecks also expose pre-existing unrelated errors; do not describe the entire repository as type-clean.

Before production activation:

1. Apply migration on disposable real PostgreSQL and run concurrent multi-process claim/lease/submit tests.
2. Exercise built-server owner authentication, feature-off behavior, and restart recovery.
3. Browser-check desktop/mobile conversation switching, Gmail review, approval changes, reconnect and uncertain-result screens.
4. Using an explicitly authorized test mailbox, verify Gmail MIME/thread/attachment draft readback and controlled delivery, then tracking repair. Validate calendar timezone and no-invitation behavior on a test calendar.
5. Review source freshness/performance with actual customer record sizes; histories beyond the bounded readback limit must block rather than truncate silently.

## Remaining scope

This branch is Stage 1. Document creation/comparison, contract and invoice workflows, researched campaigns/batches, and staff operations/handoffs (Stages 2–4) are not delivered here.

Further Stage 1 work remains explicit: automatic bounded conversation summaries and reusable document-extraction cache; complete browser/live-provider acceptance; polished source provenance display and direct natural-language grants. Record writes currently require explicit action-card approval. Very large conversations stop with a clear context-limit message; create a new conversation and reload the same profile to continue. Saved drafts remain editable in their original conversation. Original messages and evidence checkpoints remain stored. Scanned/signature content remains unverified even after visual transcription.
