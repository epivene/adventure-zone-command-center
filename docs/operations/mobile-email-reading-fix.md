# Email reading and mobile controls

Problem: Gmail HTML was discarded at the API boundary and all three readers used only bodyText. Review rows followed source order (visibly alphabetical), omitted dates, and showed redundant View/Hide controls after selection. Profile thread cards also omitted dates.

Changes:
- Preserve original HTML from inline and separately stored MIME body parts; exclude HTML file attachments from message bodies.
- Store HTML on the same archived message identity using an additive, idempotent body_html column. Existing text remains readable; previously archived HTML requires a fresh Gmail read to recover it.
- Reuse one sandboxed HTML reader for mailbox, review, profile threads and template preview. Scripts/forms/embedded frames are blocked. External images remain optional, and web/mail links open through validated user clicks. Auto-height and responsive tables avoid a fixed tiny scrolling pane.
- Render date fallbacks from numeric or serialized Gmail timestamps and RFC Date headers; leave genuinely absent dates unknown. Sorting affects presentation only, preserving chronological service data used for replies.
- Order mailbox rows, review queues, profile conversations and thread messages newest first.
- Fold old messages, hide list/search/folder controls while reading on phones, retain one Back control and a visible Reply, move connection actions into More, and remove the redundant review View/Hide button.
- Compact review keeps a Retry email control after failed reads. External-image consent is tied to the current message HTML.
- Waiting/Needs reply task queues retain their existing task-activity ordering and dates; mailbox, review and profile email dates use message timestamps.
- A saved draft's review/Send section remains open; sending still requires the explicit confirmation.

Validation:
- 7 behavioral tests and 4 React rendering/security tests pass.
- 28 existing native mailbox regression tests pass with the updated Gmail client.
- Changed TypeScript sources pass transpile syntax diagnostics.
- Live baseline inspected. Real updated list/body components checked in a local React fixture at 390px and 768px: newest first, no page horizontal overflow, formatted table visible, malicious sender script did not alter the host page.
- Fixture CSS covers the component layout; this is not a full application phone/Fold check. Full workspace build/typecheck and database migration execution remain unverified in this partial mirror.
- Screenshot attachments could not be downloaded (access denied); live browser inspection was used.

Deployment: Google workspace startup migration adds body_html for existing installations. Matching SQL migration is also included. No bulk email sync, Gmail label change, messages, sends or deployment performed as part of this fix.

Code review: no remaining Critical or Important findings. Older profile/review thread messages remain expanded; the native mailbox folds older messages.
