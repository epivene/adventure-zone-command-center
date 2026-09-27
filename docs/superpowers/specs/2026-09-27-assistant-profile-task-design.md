# Persistent assistant profile tasks

Status: Proposed for review; not implemented or deployed.

## User outcome

When Desiree asks the assistant to research and update a set of profiles, it should keep working in small batches within her spending limits, save authorized changes, and show accurate completed, needs-review, and remaining counts. Closing the phone or saying Continue must not lose the job or repeat successful writes. This addresses the screenshot showing 120 profiles remaining, repeated usage stops, pending note IDs, and expensive context reuse.

## Evidence and dependencies

The existing assistant-workspace RunStore persists individual runs, leases and TurnCheckpoints. Conversation context contains bounded recent messages and excerpts, not an authoritative task ledger. Record mutation grants bind actor, source message, action kind, target IDs, revision and connection. The orchestrator explicitly warns that a new message does not automatically resume a checkpoint. Extend these mechanisms rather than bypassing them.

At review time PRs #957 (offline startup), #958 (history, saved info, readable research), and #959 (daily/monthly spending) remain open and unmerged. Implementation must refresh main and these heads, preserve their changes, and integrate spending controls before enabling automatic paid continuation. The separate prepare-booking proposal is outside this first release.

## Approach

Use a persistent profile-task ledger backed by the existing run worker. Prompt-only reminders cannot provide exact progress or reliable resumption. A new general-purpose autonomous agent framework would add unnecessary scope. The ledger supplies durable task state while existing tools perform research and mutations.

## Task scope and authorization

Create a task from the user's request and an explicit, frozen set of profile IDs. Store actor, conversation, original request, event-year scope, objective, permitted action kinds, selected fields, and any task cost cap. Resolve the full target set before execution; a model-reported count is never sufficient. Show the target count and permitted updates in a task card. An ambiguous request remains proposed until clarified.

An explicit request to research and save notes can authorize additive sourced notes across that set. A request to fill missing contact fields can authorize those specific empty fields using supported official evidence. Merely selecting profiles or asking a question grants no mutation rights. Server-side scope checks mint grants compatible with the existing executor for each child run; do not loosen global authorization checks. Recheck actor access, current revisions and task status at execution time. Scope expansion requires a new user instruction.

Overwriting populated fields, merging profiles, deleting records, sending messages, signing documents and recording payments remain outside this task's automatic authority. Present concrete review cards with profile names, old/new values and sources for changes that require review. Support approving selected compatible changes together; retain individual receipts and conflict results. Never present internal action IDs as the user's required next step.

## Data model and state

Persist task, task-item and task-to-run records. Task states: proposed, running, paused, waiting_review, completed, cancelled. Item states: pending, researching, ready_to_save, awaiting_review, completed, needs_review, failed, uncertain. Each item retains profile ID, year, evidence references and retrieval dates, planned changes, action IDs, verified receipts, attempt count and last error. Unique task/profile/year identity prevents duplicate membership.

Only server-verified outcomes may mark completed: required requested fields already verified, or successful matching write receipts. A research note alone does not complete a missing-contact objective. Unknown contact details finish as needs_review with a reason instead of triggering endless searches. Display completed, needs review, failed and remaining as disjoint counts; remaining includes pending, in-progress, awaiting approval and uncertain items. Counts always sum to the frozen total. A finished queue with unresolved items is labelled Finished with items needing review, never all profiles completed.

## Execution and continuation

Process at most four profiles per batch, one active child run per task. Use worker leases and versioned task transitions to prevent duplicate Continue clicks or concurrent workers from dispatching overlapping batches. Persist each item outcome before scheduling the next. Automatically schedule the next eligible batch while the task is authorized and running and budget remains. Per-run step exhaustion yields a persisted checkpoint, not a reset of the task.

Continue resolves the active task in the conversation and resumes eligible unfinished work; if multiple tasks are resumable, show a chooser. Refreshing or closing the browser does not stop server execution. Pause and Cancel controls stop new dispatches and check for cancellation before each paid call and write. A call already in flight may settle and must be recorded. Revoked permissions or archived/trashed conversations stop further execution through existing lifecycle guards.

Use stable idempotency keys per task item and intended change. Reconcile uncertain writes against receipts before retrying; never issue duplicate notes or declare success from assistant text. Bound transient retries to two automatic attempts per item, then expose Retry. Stop a batch with no durable progress rather than spending indefinitely.

## Evidence and cost

Retrieve only current batch profiles, relevant rules, a compact task summary and required source excerpts. Reuse saved research when its scope, age and evidence meet the objective; retain provenance. Record missing facts explicitly. An official general office contact may be saved as a general contact when authorized, but never relabel it as a named event organizer. Prior-year evidence cannot silently verify a future organizer or event date.

Every paid path uses #959's shared reservation and settlement controls. Automatic batches stop at the owner's daily/monthly allowance and any smaller task cap. A budget pause requires explicit Resume after allowance is available; rollover must not silently restart the job. The model cannot increase limits or change models to bypass them. Display task cost and per-batch estimates with the same uncertainty language as existing cost controls. No paid live research is required for automated tests.

## User interface

Add a task card to the conversation: objective, scope, counts, current batch, cumulative estimated cost, and Pause/Resume/Cancel. Show named items requiring attention and concrete Approve/Skip/Retry controls where appropriate. Persist state on reload and report offline status as last known; reconnect fetches authoritative progress. Show readable evidence using #958's research report component. Avoid sending all task history back to the model or filling the chat with a reply per profile.

## Verification and rollout

Test a 120-profile fixture across multiple batches; restart the worker mid-task; repeat Continue concurrently; inject budget stops, stale revisions, revoked grants, uncertain writes and incomplete research. Assert exact counts, no duplicated writes, no cross-owner access, no fabricated completion, no paid dispatch after pause, and no bypass of spending or review gates. Verify the task card and approval controls at Fold-sized widths and across reload/offline/reconnect.

Ship schema and task APIs first, then worker integration and UI behind a disabled feature flag. Migrations must preserve existing conversations, pending actions and receipts. Enable only after tests and review, then validate a small explicitly authorized task before offering large queues. No model training or production code-editing capability is included.
