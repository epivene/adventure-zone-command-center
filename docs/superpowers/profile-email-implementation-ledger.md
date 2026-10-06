# Implementation ledger — profile Call Brief and native Emails
Baseline: 36139ecaea0c35a34d8d74cc2621f24c4dc831ee
Feature branch: codex/profile-email-implementation-2026-10-06

Ruling: Use connector-backed feature branch and local source copies because managed worktree setup and git network access failed. No main-branch edits.
Ruling: User explicitly authorized skipping paid GitHub Actions. Use dependency-free local behavioral checks and syntax validation; full build/typecheck and live Gmail remain unverified.
Ruling: Direct profile association is committed before Gmail label work. Missing/conflicting saved labels are visible attention states; no label creation from Link to profile.
Ruling: New composer creates plain-text Gmail drafts or renders an existing active approved template through the existing renderer. Existing draft MIME, formatting and attachments remain intact; attachment additions are made in Gmail. This limits editing compared with a full rich-mail editor.
Ruling: Recorded contract terms and invoice amounts are labeled by source rather than presented as an accepted quote. All facts bind to selected booking/year.
Ruling: Uncertain Gmail delivery never automatically retries; durable per-account/draft send record rejects duplicate attempts.

Validation:
- Original link tests: 5 failing behavioral checks reproduced undesired archive/duplicate creation, one legacy case passed.
- Updated link behavior: 6/6 passing.
- Expanded native service/projection checks: 24/24 passing (real production logic; fake Gmail and SQL boundary).
- Babel parser: 23 TS/TSX files parsed.
- No production inbox was changed; no email sent during development.
Final fresh-context reviewer: gpt-6-astra. Six Important findings found. One fix pass:
- Inbound replies inherit link-only policy under the thread lock. Native regressions failed before the fix, then passed.
- Completed reconciliation checks current intent/generation. Native regression failed before the fix, then passed.
- Conversation-specific picker resets on message changes; explicit reassignment compares the verified previous owner.
- Search only filters Search; Inbox/Sent/Drafts have no invisible search query.
- Definite pre-send/rejection errors do not leave an uncertain ledger record. Native regressions failed before the fix, then passed.
- Cc and Bcc are read from reviewed MIME and displayed before send. Native regression failed before the fix, then passed.

Additional completion: read/unread indicators and actions; account-specific Open Gmail fallback; quoted reply expansion; phone list/reader and back scroll; folder/search/thread restoration; active approved template preview; linked saved-copy fallback with timestamp; profile lookup includes event/contact/email/phone/city; Gmail label recovery respects durable thread ownership.

Limitations: no full build/typecheck, browser/device runtime or live Gmail integration run in this restricted workspace. No production mail changed.
Ruling: Uncertain-send reconciliation remains a manual check in Gmail Sent; the app never clears uncertainty automatically. Cost: an uncertain draft must be checked outside the app.
Deferred minor: Call Brief shows concise source excerpts and existing source sections, without a separate conflict-evidence expansion panel.
