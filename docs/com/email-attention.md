# Com: file conversations and track attention

Com and the owner app share one account/thread attention record. Filing does not send email, complete reminders, alter event bookings, or modify the hosted reply trigger.

## Workflow

1. Read the conversation and establish the correct profile. Stop if the match is ambiguous or conflicts with its saved assignment.
2. Call `preview_email_profile_assignment` with the message ID, verified profile, nullable event year, status, and reason. A year is not inferred from today's date. A follow-up reference must belong to that profile; a date alone does not create a reminder.
3. Obtain `email:organize` through `request_email_organize_access` when needed. Existing CRM-edit consent does not grant Gmail organization. The owner must approve the consent flow.
4. Apply the preview with its exact revision and a stable request key. The preview expires after 15 minutes; source changes require a new preview. Repeat the same request key only to retry that exact decision.
5. Report assignment, Gmail synchronization, and profile-history synchronization separately. Partial, pending, failed, disabled, and superseded results are not all complete.
6. Use `read_email_profile_assignment` to read the shared current state and durable synchronization evidence. Apply replay stays bound to the originating actor and request key.

| Decision | Gmail | Today |
| --- | --- | --- |
| Needs your reply | Profile label + Needs Attention | Needs your reply |
| Waiting for their reply | Profile label + Needs Attention | Waiting for their reply |
| Resolved | Keep profile, remove Needs Attention | Remove ongoing attention card |

Inbox is removed only after required labels are read back successfully. Unrelated labels and unread state are preserved. A new verified incoming message reopens attention; sent messages and drafts do not. A linked open reminder blocks resolution. Filing and synchronization errors retain the saved decision for retry.

The app's Assign action opens the same preview flow. Today opens that conversation's filing controls, which retain the saved status, year, reason, and linked reminder. Existing reply cards are deduplicated only when a unique explicit reminder link proves the account/thread identity. Generic opportunity-level work remains visible; it may represent a different conversation for the same profile.

## Rollout and verification

- Startup installs the additive attention, preview, audit, and operation tables before listening. Existing assignments are not bulk migrated.
- Gmail label sync still uses `GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED=true` and the existing connected Workspace Gmail account and inbound polling path.
- Refresh Com's connector after deployment. Grant the new organization scope through its consent flow; refreshing alone does not grant it.
- Exercise one owner-approved ongoing thread: preview, apply, inspect profile + Needs Attention labels, verify the Today card and imported history, then reply and confirm it reopens. Do not mark resolved while a reply or reminder is outstanding.
- No production Gmail or CRM data was changed during implementation; live end-to-end verification remains a deployment check.
- Gmail offers no compare-and-swap for label writes. Source and authorization are rechecked before removals, but a reply arriving inside the final provider read/write gap relies on subsequent inbound reconciliation.
- The full test baseline is not green. Focused feature tests and the API build are the feature gate; broader test/typecheck failures and the blocked external test request are recorded in the PR. This is a draft for review, not a deployment claim.

## Independent review disposition

The final reviewer identified four important gaps. Regression checks reproduce the incoming-direction, cross-actor read, and failed-history-refresh defects. Fixes identify archived inbound by sender/account evidence, read canonical records and durable effect status, verify archived message coverage, and preserve separately completed effects on retry. Production Today now propagates thread identity through explicit reminder links; records lacking that evidence remain visible rather than being guessed from a profile. The reviewer did not perform a second review after fixes.
