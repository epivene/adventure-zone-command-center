# Assistant workspace: continuity and document reuse review

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

## Document workflow additions

- Read contracts, invoices and recorded payments for a selected customer and canonical booking-opportunity event year. Unknown-year records are explicitly excluded; invoice issue date never substitutes for event year. Outstanding balances exclude drafts/cancelled invoices; cash totals retain their nonvoided receipts.
- Compare two to four linked documents with full page evidence, version checks and explicit unreadable-page reporting. Source cards persist across refresh and open originals through authenticated routes. Text or visual extraction never establishes execution, receipt of money, or current event-specific insurance.
- Create document projects from active approved Design Studio templates, and start/save/finalize contract drafts through existing contract services. Contract PDFs use the existing versioned renderer and storage. Invoice registration creates a draft record from an existing linked invoice document; invoice layouts and exports stay in the existing approved Design Studio workflow.
- Record reviewed invoice payments through the existing invoice service. Confirm an exact signed-file checksum through the canonical lifecycle/capacity transaction. Both require a dedicated human verification control, exact target/revision/customer/booking/year, and a durable receipt in the same database transaction. Financial approval cards display trusted invoice identity and before/after paid totals, balances and status; signed-file cards show filename, file revision and checksum. Changed records disable the approval preview. Local record actions remain usable when Google is unavailable. They do not send mail or submit signature requests.
- Repeated action requests return saved receipts. Repeated assistant payment references on the same invoice are rejected; arbitrary manual receipts without that reference still need human reconciliation.

Contract actions require the existing `CONTRACT_BUILDER_ENABLED` configuration and current active template. PDF generation also requires configured document object storage. Missing approved layouts block creation instead of inventing contractual or invoice terms. Failed external PDF storage may leave an unreferenced object; uncertain actions require inspection and are not automatically repeated.

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

The embedded additive migration mirrors `lib/db/migrations/20260924_assistant_workspace.sql`; the API startup installer applies it and seeds approved rules when the feature flag is true. The generic Render migration runner applies pending SQL files independently of that flag. Confirm database backup and real PostgreSQL migration behavior before enabling. Keep `pdfjs-dist` installed at runtime: its worker is external to the API bundle.

This uses an OpenAI API project and its model access. It does not embed this ChatGPT session, automatically import ChatGPT memory, or transfer ChatGPT connectors/subscription into the app. Business context comes from the app's saved records and approved rules.

## Recovery and rollback

Set the feature flag false and restart to disable new workspace access/worker processing; the original assistant remains available and stored records are retained. Do not drop workspace tables as a rollback. Do not automatically retry a send whose provider result is uncertain. Use Check result for readback; require an operator to resolve cases where no unique Sent match exists. A confirmed send with incomplete CRM/archive work offers Repair tracking. Changing the connected Google identity blocks actions bound to the old identity.

Approvals apply to exact saved revisions and targets. A changed draft, contact, source snapshot, account, or capacity approval requires renewed review. Sending may complete despite a later browser/network failure; inspect the stored receipt rather than sending another copy.

## Validation and release gates

Automated coverage includes PGlite-backed ownership, atomic submission, worker fencing, deduplication, draft revisions, send/reconcile paths, source-change rejection, real PostgreSQL DATE parsing, rule scope, document completeness, API authentication and React interactions. Provider tests use controlled doubles; no customer emails were sent during development. Both API and browser production builds were exercised. Full repository typechecks also expose pre-existing unrelated errors; do not describe the entire repository as type-clean.

Latest document-stage verification: Node 22 passed 33 backend test files / 141 tests, including actual PGlite invoice/lifecycle services, action replay/rollback, scoped draft reads, payment previews, HTTP human verification and existing workspace regressions. React passed 3 files / 8 tests. API and UI production builds passed. Repository-wide typechecks retain the same 94 API and 135 UI baseline errors; none are reported in the changed workspace/lifecycle files. Final independent review findings were fixed and the focused re-review found no further critical or important issue.

Campaign/operations verification (2026-09-25): Node 22 passed 42 backend files / 189 tests, including the complete workspace, authenticated router, canonical invoice/contract services, office tasks and inspection service regressions. React passed 4 files / 10 tests. Final API and UI builds passed. Final typechecks remain exactly 94 API / 135 UI pre-existing errors, with none in the changed workspace files. The fresh independent review's booking selection, recipient normalization, URL root-dot and inspection-year findings were fixed and regression-tested. Additional integration coverage fixed UUID array binding and added batch/contact identity to draft revisions. Focused re-review found no further blocking issue. These checks used controlled provider fixtures and PGlite; no customer messages or production activation occurred.

Continuity/cache verification (2026-09-25): Node 22 passed 47 backend files / 208 tests, covering the complete assistant workspace plus authenticated router, invoice/contract services, office tasks and inspection service. React passed 5 files / 12 tests. Both production builds passed. Final repository typechecks report exactly the unchanged 94 API / 135 UI baseline errors, with no errors in changed assistant files. A fresh whole-branch review found one Important issue: mixed known/unknown linked-booking years. A failing PGlite regression reproduced it, the shared source/comparison year query was corrected, and the final suite passed. Long-history worker coverage verifies a conversation beyond the former 600,000-character limit, persisted context before the model call, no future-message leakage and unchanged originals. Controlled visual-provider fixtures verify complete-response timeout, selected-model use and preserved known/unknown usage. No production activation or customer messages occurred.

Additional local acceptance used the actual bundled authentication/router/stores with disk-backed PGlite and a controlled provider runtime: 31/31 checks covered sign-in, access denial, atomic duplicate submissions, process-restart recovery, expired lease reclamation, feature-off behavior and repeat migrations. This did not run the full built server, native PostgreSQL, or live providers. Real supplied-PDF reader checks read both text contracts completely and marked the image-only COI partial with its unreadable page. Private PDFs were not committed.

Browser navigation to the local app was explicitly blocked by environment URL policy. Native PostgreSQL binaries were unavailable, and package setup could not complete under the environment's UID/GID restrictions. These remain release gates, not passing checks.

Before production activation:

1. Apply migration on disposable real PostgreSQL and run concurrent multi-process claim/lease/submit tests.
2. Exercise built-server owner authentication, feature-off behavior, and restart recovery.
3. Browser-check desktop/mobile conversation switching, Gmail review, approval changes, reconnect and uncertain-result screens.
4. Using an explicitly authorized test mailbox, verify Gmail MIME/thread/attachment draft readback and controlled delivery, then tracking repair. Validate calendar timezone and no-invitation behavior on a test calendar.
5. Review source freshness/performance with actual customer record sizes; histories beyond the bounded readback limit must block rather than truncate silently.

## Campaign and operations delivery

Stages 3–4 now add saved campaign batches, current eligibility checks, sourced public research, bound member drafts, actual-send follow-ups, operations reads and reviewed office tasks. The new owner-only tools use the same action-card approvals and feature gate as the foundation. No production flag was changed.

Campaigns freeze up to 100 ordered members and a planning year; a user message advances at most one page of 1–10 members. Retries return the same page. Bound drafts retain the selected contact identity through Gmail review. Existing sent/uncertain delivery is included even when the corresponding office draft says failed. Unbooked leads use an explicit planning year; it does not establish dates or availability. New public discoveries still need reviewed CRM intake before joining a campaign.

Research uses the run's selected allowlisted model, store=false, no SDK retries, three built-in calls at most, output capped at 4,000 tokens and a whole-response deadline. The installed SDK needs a typed extension for the documented max_tool_calls request field. Citations and consulted sources are separate. Unknown provider usage stops the run, and a started call without a saved outcome is never automatically repeated. The per-run token limit is checked between calls; it is not a guaranteed dollar cap and does not include web-tool fees. Saved evidence cards show the latest 30 conversation runs, capped at 12 cards; full checkpoints remain stored.

Operations readbacks keep suggested routes, missing dates, historical inspection snapshots and current equipment state distinct. Photos are not read by these tools. Lists are bounded and report truncation. Staff accounts expose display names and revisions, never authentication fields. Task changes require an enabled coordinator and exact revision, recheck profile/contact membership, and commit the canonical write, audit and receipt together. Partial edits retain due dates and coordinator notes. Actual-send follow-ups keep existing reminders and use a stable message-based identity.

## Conversation continuity and document reuse

Long conversations retain six recent messages in full and up to 24 older exact excerpts, each bounded to 1,200 characters. Source IDs, roles, timestamps and requested/resulting scope accompany the retained context. This is an extractive overview, not a guarantee that every historical correction appears in the prompt. Omitted counts are explicit. The assistant can search or page original messages through its owned source-message cutoff; each result contains at most three full originals. The workspace links excerpts to the original messages. Current approved rules remain separate; quoted assistant claims do not establish receipts, grants or successful work.

Context is frozen in the lease-fenced run checkpoint before provider work, and recovery reuses it. The worker no longer loads the entire conversation on each turn. The browser still displays the complete saved conversation, so UI history pagination remains a performance follow-up. Active reasoning/function-call items remain intact; the existing single-run context and token limits still apply.

Document readings now have a durable owner/source/connection/bytes/extractor cache. Every hit still reloads the source, verifies selected-customer access when a customer is selected, fetches current bytes and hashes them. Gmail attachment reads additionally verify current connection, message/attachment membership, selected thread and customer association. Document year comes from linked booking-opportunity data only when every linked booking has a known, consistent year; otherwise it remains unconfirmed. The selected year never substitutes for source metadata. Cards distinguish extraction date from current retrieval and identify reused readings. Incomplete scans stay incomplete.

A durable claim precedes extraction. If a worker disappears or usage is unknown, another call/run/model cannot automatically repeat that extraction. Changed bytes create a new cache identity. There is deliberately no model-controlled force-refresh option; unresolved attempts require operational investigation before any recovery change. Successful cache reuse has no newly charged provider usage. Recovery of the original run/tool call returns its saved usage so a lost checkpoint cannot undercount the first reading.

Visual transcription uses the owned run's selected allowlisted model, retries disabled, and a complete-response deadline. Incomplete responses retain their known usage and partial text; unknown usage stops the run and document comparison before another provider request. Extraction does not verify signing, payment, policy coverage or universally applicable terms. Source downloads still occur on cache hits; this phase saves parsing/visual-provider work, not storage downloads.

## Remaining scope

Further work remains explicit: complete browser/live-provider acceptance; broader source provenance display beyond document/commercial/research cards; browser pagination for very large saved histories; and direct natural-language grants. Record writes currently require explicit action-card approval. The model now uses bounded prior conversation context, but a single run can still reach its source-material limit; continue with a narrower question. Original messages, drafts and evidence checkpoints remain stored. Scanned/signature content remains unverified even after visual transcription.

## Owner setup status and Render activation

The owner can open `/assistant/workspace` while disabled. Setup status reads configuration, current schema/rule metadata and saved Google connection views. It does not refresh Google tokens, read customer mail, send messages or call OpenAI. “Ready locally” is not proof of provider key validity, model availability, billing or live file access.

On the existing **API web service** in Render (not the static frontend), retain the server-side `OPENAI_API_KEY`; configure `ASSISTANT_OPENAI_MODEL` with an API model available to the project and `ASSISTANT_WORKSPACE_ACTOR_IDS=owner`. Optional `ASSISTANT_OPENAI_MODELS` is a comma-separated list of valid model IDs including the default. Do not put any key in a Vite variable or browser form. Set `ASSISTANT_WORKSPACE_ENABLED=true` only for the approved pilot, then redeploy the API. The blueprint remains disabled by default and does not choose a model on the owner's behalf.

Limits default to 12 steps, 8,192 output tokens, 100,000 run tokens and a 120-second model timeout. The corresponding settings are `ASSISTANT_MAX_STEPS` (1–30), `ASSISTANT_MAX_OUTPUT_TOKENS` (256–32,768), `ASSISTANT_MAX_RUN_TOKENS` (1,000–500,000) and `ASSISTANT_MODEL_TIMEOUT_MS` (1,000–180,000). Invalid limits and malformed model-list entries fail closed with setting names only.

Render's generic SQL migration runner applies pending files even when the workspace flag is off. It tracks filenames, not later additions to an existing file. Enabled API startup therefore also idempotently installs the current workspace schema and approved rules. The assistant route gate remains closed until that initialization and worker start succeed; other app startup behavior is unchanged. The status check verifies the actual current tables, recent columns, active-run index and approved rule heads. `/api/healthz` alone is not an assistant activation check. After an initialization error, correct setup and restart the API; status does not perform repairs.

Use **Google settings** (`/settings/google-workspace`) for company Gmail and the separate operational calendar connection. Stored connection/scopes do not prove live token access. Optional email sending also requires `OUTREACH_PLANNER_ENABLED=true`, Gmail write scopes, reviewed template/allocation checks and explicit send review. Contract creation requires `CONTRACT_BUILDER_ENABLED=true` and an active approved template. Private file reads/exports require the storage bucket and working credentials. None of these optional checks authorizes an external action or blocks core chat.

After deployment, refresh setup status, verify owner access and required checks, then run an owner-approved minimal chat to verify OpenAI access. Check one authorized Gmail read and one selected private document before broader pilot use. Review every prepared mutation and email before approval. Disable the workspace flag and redeploy to stop new workspace work; reconcile uncertain external actions before restarting. Live provider acceptance remains separate from automated PGlite tests and builds.
