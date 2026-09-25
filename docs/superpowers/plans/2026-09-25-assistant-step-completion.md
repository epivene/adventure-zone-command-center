# Assistant step-budget completion repair

The deployed PR952 reduces context overhead, but a new BBQ Days follow-up ends at 144,207 tokens / 12 model steps without a draft. Production deploy 198e39a and the authenticated conversation UI confirm the report. The token cap is 250,000; do not infer a provider quota problem.

## Reproduced design problems

The adapter forces one tool per model call even for independent reads. An ordinary draft takes 8–11 model calls before any extra threads, pagination, or correction. The orchestrator does not tell the model its remaining budget, reserves no final answer, and discards receipt/blocker reporting at a step cutoff. New turns do not automatically resume old checkpoints despite the cutoff copy. The only profile reader fetches up to 500 activity bodies and all bookings for a narrow current request.

## Implementation and acceptance

1. Enable multiple tool calls per response while retaining sequential, scoped, checkpointed execution. Explain independent read grouping and dependency ordering. No parallel writes or relaxed grants.
2. Supply remaining round information, prioritize finishing the requested work, and reserve the final configured round for a tools-disabled answer grounded in saved results. Never execute calls returned in that closing round. Keep the existing maximum calls/tokens and cancellation rules, with a receipt-aware deterministic fallback for legacy checkpoints and token exhaustion. Report specific safe blocker guidance without exposing arbitrary tool payloads.
3. Add a current-profile/contact read that explicitly omits historical activities, preserve full-history retrieval, and clarify draft recipient/template prerequisites. Make this the default profile read for narrow follow-ups.
4. Add meaningful failing-to-passing tests for multi-call adapter requests, sequential restart safety, bounded closing responses, source-scope preservation, draft/send/uncertain cutoff messages, and current-profile reads. Run established CI selection and builds, independent whole-branch review, then prepare a draft PR preserving remote-only updates.

## Review focus

No silent source truncation; no calls executed during forced closing; no increased limits; provider accounting and closeout crash recovery; sequential batched mutation/cancellation checkpoints; current owner/profile scope; truthful draft/sent/uncertain outcomes; legacy checkpoints; specific blockers without raw errors; screenshot preservation. Live model completion remains a deployment acceptance check.

## Production trace confirmed

A scoped read-only query of the stopped conversation’s run events, through Render’s authenticated Web Shell with the same configured database and verified TLS as the app, showed exactly twelve calls: search_profiles; select_profiles; read_profile_history; select_profiles; read_rules; read_commercial_records (partial: ASSISTANT_EVENT_YEAR_UNCLASSIFIED); search_email; read_email_thread; read_email_thread; search_email; read_email_thread; read_email_thread. All other calls succeeded. Template selection and draft preparation were never called. No production data or settings were changed.
