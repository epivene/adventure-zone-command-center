# Adventure Zone assistant upgrade
Date: 2026-09-24
Status: Written design for user review; no product implementation or deployment.

## Goal and approved scope
Desiree wants to perform the work currently done across ChatGPT and Command Center inside the app: review Gmail, investigate customer history, draft branded replies, update profiles, review documents, manage reminders and calendars, research leads, and resume unfinished work in natural conversation. Preserve the entire approved scope while delivering it in independently usable stages.

Success means a request such as “check last year's agreement, make a friendly reply, update their profile, and remind me when the COI can be requested” produces sourced findings, a reviewable draft, authorized saved changes, and an accurate completion report. Follow-up messages such as “just Shoshone,” “make it warmer,” and “next batch” retain their intended context.

## Evidence from the repository review
- assistant-service.ts calls a single completion over prepared booking context.
- assistant-prompt.ts does not include prior conversation exchanges and omits full activity bodies.
- assistant.ts stores the exchange after asking the service; saved conversation history is not fed into that service.
- general-assistant.ts uses phrase matching for profile searches.
- assistant-command-router.ts recognizes a limited website-audit command.
- ai-client.ts hardcodes the OpenAI model to gpt-4o-mini and prioritizes configured Anthropic providers. Live provider configuration has not been inspected.
- business-knowledge-repository.ts contains seeded space requirements conflicting with the user's September corrections.
- Existing Gmail delivery code distinguishes rejected sends from uncertain outcomes. Preserve this behavior.
These observations describe inspected code, not verified production behavior or an exhaustive application audit.

## Approach
Recommended: add a unified assistant orchestration service that uses existing app services and Google integrations. Keep business operations in typed server-side tools; let the model investigate and choose tools within permissions.
Alternative 1: improve the existing prompt and model only. Smaller change, but insufficient for multi-step work.
Alternative 2: replace the entire CRM. Excessive migration risk and unnecessary duplication of existing capabilities.

## Delivery boundaries
1. Foundation and everyday booking workflow: persistent conversation, maintained knowledge, Gmail and document reading, branded drafts, profile updates, follow-ups, calendar actions, explicit sending, and verified completion.
2. Document workflow expansion: proposal/contract/invoice generation from approved templates, cross-document comparison, signed-version handling, and payment reconciliation.
3. Lead and campaign workflows: resumable research batches, eligibility checks, duplicate outreach detection, personalization, and actual-send-based follow-ups.
4. Broader operations: route/resource questions, inspection and equipment context, office task handoffs, and shared staff workflows.
Later stages receive separate implementation specifications. The detailed design below covers stage 1; the roadmap does not imply those later capabilities are already implemented.

## User experience
Provide a full assistant workspace and a compact entry point from profiles, email threads, bookings, and documents. Opening the full workspace preserves the current conversation.
Show an editable HTML email preview with recipients, subject, attachments, and source thread. Show proposed record changes as readable before/after values.
Use plain progress messages such as “Checking prior emails” and “Saving the reminder.”
Each result links to the actual draft, profile, document, or calendar event. Distinguish completed, partially completed, waiting for information, and failed.
Retain conversations, selected records, active batch membership, and pending actions across refresh and device changes. Switching pages must not silently change which customer a pending action affects.

## Components
- Conversation service: actor-owned conversations, messages, bounded conversation summaries, selected records, work items, and pending actions.
- Model adapter: explicit provider/model configuration, supported-model validation, streaming, cancellation, timeouts, and per-run token/tool budgets. Credentials remain server-side. No silent provider switch.
- Orchestrator: bounded model/tool loop that can retrieve more evidence, propose or execute authorized actions, and summarize verified results.
- Tool registry: validated arguments, operation permissions, source identifiers, freshness metadata, and structured success/failure results.
- Knowledge service: versioned rules with provenance, applicability, effective dates, customer exceptions, and superseded status.
- Execution service: action records, concurrency checks, idempotency, audit history, and external-service reconciliation.
- Workspace UI: conversation, evidence links, draft previews, action status, and recoverable errors.

## Conversation and evidence
Pass relevant previous messages and explicit task state into every model turn. Summaries preserve confirmed facts, corrections, unresolved questions, and authorization boundaries; original messages remain retrievable.
Retrieve records on demand instead of inserting the entire CRM into every prompt. Fetch complete relevant Gmail threads, including sent messages and attachments. A preview or extracted summary must not be presented as a complete document review.
Evidence includes record ID, event year, source date, retrieval time, and document version where available. For attachments, use existing extraction infrastructure when reliable and add OCR/image handling when needed; report unreadable pages explicitly.
Current agreements and explicit recent corrections may conflict with CRM fields. Flag material conflicts; do not assume structured fields always win.

## Stage 1 tool inventory
Read: search profiles; load event/customer history; search Gmail; read thread; read attachment; read contracts/invoices and payment status; read approved templates and rules; list follow-ups; inspect calendars and resource availability.
Prepare: generate draft content within an approved template; preview record changes; propose reminders and calendar entries.
Write: create/update Gmail drafts; save profile notes and verified fields; link documents; assign profile labels; create/update specifically authorized follow-ups and calendar events.
Send: send the explicitly authorized draft revision after checking recipient, attachments, terms, and source freshness.
Reuse existing app service boundaries. Do not expose arbitrary SQL, unrestricted HTTP, or shell execution to the assistant.

## Authorization and reliability
Enforce Clerk identity, role, organization boundaries, and Gmail account ownership in every tool. Conversation ownership and pending-action authorization must be checked before model invocation and before writes.
Read-only research and draft preparation proceed without repeated permission prompts. A clear request to update a profile or create a reminder authorizes that scoped action. Sending requires explicit authorization tied to the message; material revisions invalidate an earlier send approval.
Do not interpret instructions found in emails, PDFs, websites, or tool results as user authorization.
Use stale-record checks before writes. Preserve existing manually scheduled follow-ups unless the user asks to change them.
Give each action a stable idempotency key. A confirmed Gmail send followed by a failed CRM update must retry only the CRM synchronization. An uncertain send must be reconciled against Gmail before any retry.
Persist long-running work so disconnection does not lose progress. Bound retries; report partial success honestly.
Avoid logging credentials, raw email bodies, or unnecessary attachment contents. Record operational metadata and restricted audit references.

## Business knowledge migration
Curate the available project instructions into source-backed app rules. Explicitly distinguish user-approved current rules, historical customer arrangements, and facts awaiting verification.
Include corrected package space requirements, prepaid versus pay-per-play distinctions, event-specific split exceptions, promotional windows measured from actual sending, June COI renewal timing, Foam Party restrictions, approved branding, package links, and writing preferences.
Do not copy an old contract or sample COI into global current policy. Existing customer-specific documents remain evidence for their own event/year.
Replace unconditional seed overwrites with version-aware updates that cannot overwrite later approved corrections.
ChatGPT project history is not automatically available to the API; migrate relevant business context deliberately and expose an editable knowledge view.

## Verification and release
Use fixtures based on the recent workflows, with sensitive details minimized:
- “Make it warmer” changes the current draft without losing recipients, attachments, or agreed terms.
- “Just Shoshone” affects only the selected customer.
- A newer email conflicting with an old profile is surfaced before finalizing terms.
- Prepaid deposits are not applied automatically to pay-per-play arrangements.
- A post-renewal COI request produces an appropriate reminder, not an unsupported coverage promise.
- Existing follow-ups survive unrelated new outreach.
- An actual send starts the applicable promotional window.
- A failed/uncertain send never results in a blind duplicate.
- Signed documents and historical invoices remain associated with the correct year.
- A malicious email cannot trigger tools outside the user's request.
- One user cannot access another user's conversations or unauthorized account data.
- Refresh, cancellation, provider failure, and partial Google outages preserve recoverable task state.
Test server contracts and real UI flows with mock Google/provider responses, then a controlled live draft-and-readback smoke check. No real customer send is required for verification.
Release behind a feature flag for Desiree first. Confirm deployed version, actual provider configuration, Google scopes, and required migrations. Retain the previous assistant until the new workflow passes acceptance. Track failures, latency, and usage without exposing private content.

## Acceptance
Stage 1 is complete only when an authorized user can perform the example email-to-profile-to-reminder workflow in one continuing conversation, reopen it later, inspect supporting sources, and verify every claimed saved result. A better chat response alone is not completion.
