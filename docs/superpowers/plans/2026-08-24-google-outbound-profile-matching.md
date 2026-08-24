# Google Outbound Profile Matching Fix

**Goal:** Stop company/owner Gmail addresses from becoming CRM target profiles and correct the current 100-message validation mappings.

## Rules

- `SENT` messages match recipients, not the sender.
- `INBOX` messages match the sender, not recipients.
- When Gmail labels are ambiguous, the connected Gmail account address identifies the internal side of the conversation.
- A unique full CRM profile name in the subject is stronger evidence than a contact relationship.
- Subject matching ignores punctuation differences such as parentheses and hyphens.
- Re-running the bounded validation sample reconciles stored mappings for the current sample, removing stale automatic mappings.
- Manual review assignments are restored after reconciliation and always beat automatic matching.
- Historical backfill remains disabled.
