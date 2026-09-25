# Assistant step-budget completion verification

## Production diagnosis

PR952 was merged as 198e39aeaa246e099e2bef89a3e3f3f71780b2ef and was the live Render API deployment. The new stopped conversation showed 144,207 reported tokens, 12 steps, no draft. A scoped SELECT-only transaction through authenticated Render Web Shell read the recorded tool statuses with the app’s existing database/TLS configuration. It changed no records, settings, permissions, drafts, or deliveries and made no model retry.

The twelve calls were:

1. search_profiles
2. select_profiles
3. read_profile_history
4. select_profiles
5. read_rules
6. read_commercial_records — partial, ASSISTANT_EVENT_YEAR_UNCLASSIFIED
7. search_email
8. read_email_thread
9. read_email_thread
10. search_email
11. read_email_thread
12. read_email_thread

All other calls succeeded. No template lookup or draft creation was attempted. The commercial partial result means zero totals are not proof that the deposit was paid or unpaid.

## Repair

The provider can now request several independent tools in one response. The orchestrator still executes and checkpoints each call in order, validates cancellation/lease/usage between calls, and delegates authorization to the existing registries/executors. Search and selection dependencies must be resolved before dependent reads.

Each model call gets its remaining rounds and token allowance. The final configured round exposes no tools and explicitly requests a sourced final answer or specific blocker. Unexpected calls in that closing response are never executed. The final text and usage are saved together so a recovered checkpoint returns the same answer without another provider call. A legacy checkpoint already at its limit gets receipt-aware draft/send/uncertain outcome reporting, with fixed wording for recognized blockers. New turns are not described as automatically resuming old checkpoints.

A new selected-profile read returns the current organization and active contacts without loading historical activities or bookings. It explicitly states that history is excluded, and evidence is marked incomplete for historical purposes. Full history remains available. Draft instructions explain recipient/template requirements and allow neutral payment-status questions without inventing an amount or paid/unpaid conclusion.

## Evidence

- Initial adapter/orchestrator regressions: 8 expected failures, 25 existing tests passed. Current-profile regression also failed before implementation.
- Expanded focused checks: 38 tests across 4 files passed, including grouped calls, exact call IDs, inter-call cancellation, interrupted-write recovery, final-response recovery, scope checks, and draft/send/uncertain cutoff outcomes.
- Scripted provider integration used the actual OpenAI adapter, read/workspace registries, PGlite conversation and draft stores. Nine tools, including two complete incoming/sent threads, finished in five model rounds and saved one reviewable in-app draft with a verified receipt and no action grants. Commercial data was a partial/unknown-status fixture. This validates orchestration and persistence, not a live model’s decision sequence.
- Full backend CI selection: 55 files / 264 tests passed in 291.06 seconds.
- Assistant UI: 7 files / 20 tests passed.
- API and frontend production builds passed on Node 22.
- API type diagnostics remain at the pre-existing 94-error baseline, with no added file/error-code diagnostics.

## Limits and decisions

Keep the existing configured step/token limits. Reserving the last round leaves 11 working rounds under the default 12-round limit; complex requests may still need another user turn. Token exhaustion takes priority and uses a deterministic saved-outcome message without another provider call. Existing full-history and tool output limits remain in place.

No model response is guaranteed by scripted tests. After merge/deployment, retry the BBQ Days draft and confirm the saved draft, accurate payment uncertainty, recipient, and thread before any email send. The change does not classify the unyearred commercial record or send outreach.

Independent whole-branch review found no Critical or Important issues. One optional minor remains: a response using the reserved final round is conservatively marked partial even when a preceding action saved the requested draft. The draft and verified receipt remain available. The reviewer inspected code/tests and did not independently repeat the production query or full CI. Unchanged send/reconciliation paths were not exhaustively re-audited; no exactly-once provider billing claim is made for crashes before checkpoint persistence.
