# Com email linking and Needs Attention

## Approved intent
Desiree wants Com to link email conversations to the correct event profile and keep ongoing conversations visible in both Gmail and Today → Needs Attention. Apply the profile label, apply Needs Attention while work remains, and remove Inbox only after those labels are successfully applied. Distinguish “Needs your reply” from “Waiting for their reply.” Never send email without a separate explicit instruction.

This is an architectural extension: it joins connector authorization, CRM assignment, Gmail mutations and the Today queue. No production implementation has started.

## Existing behavior and reuse
GoogleReviewProfileAssignmentService already persists assignments, queues Gmail mutations and archives email into profile history. Its result separates Gmail and archive synchronization. GoogleProfileLabelSyncService currently removes Inbox for assign_thread. Reuse these services and their durable mutation machinery; do not introduce a separate Gmail writer.

The Today master queue derives attention from opportunities and follow-ups. It does not currently represent the proposed thread attention state. Shared booking work has waiting_desiree and waiting_customer, but is one record per profile/year rather than per conversation. Keep that queue's ownership rules intact.

## Selected approach
Persist one current attention record per app Gmail connection and thread, alongside the existing authoritative assignment. Store profile ID, nullable verified event year, state, reason, optional follow-up date/reference, last reviewed message ID, revision, actor and timestamps. States: needs_your_reply, waiting_for_their_reply, resolved. Retain transitions in audit history.

This record is the source for Gmail label synchronization and Today display. Gmail labels are a projection, not the authority. A label-only solution would leave Today disconnected; using booking-work status alone would collapse separate conversations into one. Use the thread record to avoid both problems.

Do not infer event year from the current date or silently change bookings. Unknown year is allowed and displayed as unconfirmed. A follow-up date is not proof a reminder was created; link an existing verified reminder or separately save one through the existing service.

## Connector flow and authorization
Expose preview_email_profile_assignment, apply_email_profile_assignment and read_email_profile_assignment. Preview reads the real message/thread from the app's authorized Gmail account and the live target profile; callers cannot fabricate email headers as source evidence. It returns the current assignment, proposed profile, attention state, exact label effects and an opaque 15-minute preview ID bound to owner, connector, Gmail account, source version and target.

Apply requires the preview ID, expected revision, stable request key and reason. Recheck active authorization, target validity, Gmail account identity, latest message and current assignment before committing. A changed source or assignment requires a fresh preview. Refuse ambiguous or conflicting assignments until the owner chooses the target. Do not silently replace another profile.

Add a narrowly described email:organize consent scope for assignment, profile-history import and managed label changes. Existing CRM grants do not silently gain Gmail write authority. Preserve existing grants; provide the owner consent flow without approving it on the owner's behalf. Preview/read remain subject to authorized read access and account binding. No send capability.

Use the existing transaction and durable mutation paths for assignment and attention intent. Record the request key and receipt atomically with the CRM decision. Gmail synchronization happens after commit. Replays return the committed decision and current synchronization status, never repeat a changed decision. Recheck authorization before connector-initiated retries.

## Gmail behavior
Use the existing profile-label resolver. Resolve exactly one user label named Needs Attention; reuse it or create it through the authorized Gmail client. Do not alter unrelated labels or read/unread state.

For either ongoing state, add profile and Needs Attention labels before removing Inbox. If applying either required label fails, retain Inbox and expose the failure. Preserve the existing protection against older mutations overwriting newer assignment intents.

For resolved state, remove Needs Attention only on an explicit reviewed resolution that establishes no outstanding reply or follow-up remains for this conversation. Keep the profile label and history. Do not equate “draft saved,” “email sent,” or “archived” with resolved. Waiting after an authorized send remains visible.

The implementation does not change Com's hosted trigger or autonomously send messages. Com uses these tools under its existing workflow; clearing or advancing a state is an explicit audited action. A new inbound message after preview invalidates that preview. A later inbound must be reviewed before an earlier resolution may be applied again.

## App behavior
Add thread-attention candidates to Today → Needs Attention. Show the profile, subject, verified year if available, next action, and a clear state badge. Put “Needs your reply” above “Waiting for their reply”; waiting is visible but not styled as overdue unless a verified due date has passed.

Link to the exact saved conversation and profile. Deduplicate against existing reply candidates only when they carry the same verified thread identity; never suppress unrelated work merely because it shares a profile. Add thread identity to relevant projections where needed. Do not change unrelated opportunity priorities, completion states or shared-work ownership.

Expose the same preview/apply service through owner UI actions so Desiree can correct states without Com. Keep existing boss/office permissions unchanged.

## Errors and receipts
Return separate CRM assignment, attention state, Gmail label sync and profile-history import statuses. Partial success stays visible and retryable; never report “filed” solely because the database committed. A retry of archive import must deduplicate by existing thread/source identity. Connection changes, stale previews, revoked grants and conflicting profile decisions fail explicitly.

## Verification and scope
Test scope and account boundaries, revoked grants, stale/new-message previews, changed payload replay, concurrent assignment, unknown year, label failure preserving Inbox, retry recovery, no duplicate archive, ongoing versus resolved labels, Today ordering and thread-specific deduplication. Exercise MCP dispatch with app AI disabled. Verify owner UI controls and mobile layout. No live email relabeling is part of development testing.

Out of scope: email sending, historical bulk relabeling, automatic reminder creation, booking-stage changes, leg/camper planning and changes to Com's hosted trigger.

## Acceptance
A reviewed ongoing conversation is linked to the correct profile, remains accessible under its profile label and Needs Attention in Gmail, appears with the correct waiting/reply state in Today, and has separately verified synchronization results. Resolving it preserves profile/history and removes only its attention marker.
