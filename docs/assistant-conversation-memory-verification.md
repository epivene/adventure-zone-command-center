# Conversation history, saved information and public research

This change adds Recent, Archived and Trash history views. Archive and Trash preserve the conversation, drafts, screenshots and action receipts. Restore returns a conversation to Recent and permits new work again. Trash is recoverable; this feature does not permanently delete stored records, Gmail messages or offline copies.

Chat history and conversation summaries already persist automatically. **Remember this** now opens a review form for a selected message; it does not create memory merely by clicking the button. **Saved info & rules** supports manual notes, corrections, customer/year/effective-date scope and **Stop using**. Only approved current information is supplied as active saved knowledge. Old conversation text and knowledge history remain available. Live balances, availability and other changing facts still require current records.

Public research now has a bounded preview and **View full report**. The report retains all original sections, citations, consulted sources and warnings. Markdown tables scroll horizontally within their container. The wider report uses a native modal compatible with the compact workspace results sheet.

## Data and rollout

- `20260926_assistant_conversation_lifecycle.sql` and the startup migration add a default-active lifecycle column, index and database guards. Existing conversations retain their contents.
- Lifecycle changes use the conversation version. New work and Archive/Trash serialize on the same conversation row. Running or uncertain assistant/Gmail operations must finish or be reconciled before moving the conversation.
- Knowledge retirement advances the scope head version and retains the prior approval. Stale approvals/retirements conflict; deliberate retirement of a seeded rule does not disable assistant readiness.
- Offline sync checks current server lifecycle before applying edits. Archived/trashed conversations require Restore. Pending local edits and uncertain attempts are preserved.
- No email sends, real customer changes, production database writes or model calls were used for verification.

## Manual acceptance after deployment

1. Open a saved conversation. Archive it; confirm it leaves Recent, remains readable in Archived and cannot start new work. Restore and continue.
2. Move it to Trash, then restore it. Try moving a conversation with unsent text; cancelling must keep the text. A running/uncertain operation must block moving.
3. Click **Remember this**, review the full text and customer/year scope, and save. Open a new conversation with matching scope and verify applicable saved info. Edit it, then stop using it; its history should remain.
4. On an open Fold and its narrow screen, open Drafts and actions, then a full public research report. Confirm table scrolling, usable links, close/Escape returning to the results sheet and focus returning to the report button.
5. Keep unsynced offline edits, archive the conversation online, then try syncing: the edits must remain, with a Restore-first message. Restore and sync normally.

Physical Galaxy Fold behavior and deployment uptake still require the manual device check. The separate offline startup recovery change is tracked in PR #957.

## Automated verification

- UI: 8 focused suites, 72 tests passed, including history transitions, stale list responses, dirty saved-info navigation, reviewed memory versions, retirement, customer labels, report/table rendering, nested modal close/focus, draft editing and offline sync preservation.
- Frontend TypeScript comparison: 135 existing diagnostics, no additional file/code diagnostic counts from this change.
- API TypeScript comparison: 94 existing diagnostics, no additional file/code diagnostic counts from this change.
- Frontend and API production builds passed. Build tooling still reports existing large-bundle warnings.
- Independent UI and backend reviews are resolved. PGlite tests cover both arrival orders; real multi-connection PostgreSQL contention was not exercised.
- API: 13 focused suites, 95 tests passed, covering lifecycle ownership/version checks, new-work guards, inactive draft/screenshot paths, Gmail approval commit/rollback, knowledge retirement/scoping, readiness, routes and worker behavior.
