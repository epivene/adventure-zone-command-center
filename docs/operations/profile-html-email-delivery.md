# Profile HTML Email Delivery Runbook

## Release order

1. Deploy `20260912_profile_html_email_delivery.sql` and confirm its migration
   marker reports all 17 columns, four indexes, and four constraints.
2. Deploy the API and web application. Confirm the API can read existing
   plain-text Office drafts before enabling scheduled delivery.
3. Verify the Google Workspace connection has Gmail compose/modify scope and
   that Design Studio reports the expected profile recipient.
4. Start the separately supervised worker with:

   ```bash
   pnpm --filter @workspace/api-server start:office-email-worker
   ```

Stop the worker before rolling back the API. The database changes are additive
and should remain in place during an application rollback.

## Safe smoke test

Use an internal test profile and a non-production recipient. Never use an
actual event contact for deployment validation.

1. Open the profile and confirm its review stars, contact email, recent Gmail
   conversations, and active draft state.
2. Select **New Draft**, then verify the Design Studio project is linked to the
   same organization and active contact.
3. Use **Save in app** and confirm Gmail has no new draft.
4. Use **Create Gmail Draft** once, then again after a small content edit.
   Confirm Gmail contains one updated draft, not two.
5. Use **Review exact email**. Change the recipient, subject, or HTML and confirm
   Schedule and Send Now require a new review.
6. Schedule at least five minutes in the future in the displayed business
   timezone. Confirm the stored timestamp is UTC and the UI renders the original
   business-local time.
7. Confirm one worker claims the row, the canonical record reaches `sent`, and
   Gmail message/thread IDs plus a profile timeline activity are stored.

Automated tests use fake Gmail clients and must never call a real mailbox.

## Idempotency and recovery

- One canonical `office_email_drafts` row exists per non-null Design Studio
  project.
- Repeated Gmail Draft commands update `gmail_draft_id` in place.
- Schedule and Send commands use unique request keys. A replay returns the
  existing canonical result.
- Scheduled worker sends use
  `scheduled:<draft-id>:<design-version-id>` and `FOR UPDATE SKIP LOCKED` with a
  60-second lease.
- Retryable timeouts, 429s, and 5xx failures back off from 30 seconds to a
  maximum of one hour.
- `GMAIL_DRAFT_OUTCOME_UNKNOWN` and `GMAIL_SEND_OUTCOME_UNKNOWN` are not blindly
  retried. Check Gmail Drafts/Sent, reconcile the canonical IDs, and require a
  fresh exact-content review before another delivery attempt.

Do not place recipients, subjects, HTML bodies, OAuth credentials, or raw Gmail
payloads in logs or incident reports.

## Stop and rollback

1. Stop the Office email worker process and wait for its graceful shutdown.
2. Confirm no row has an active, unexpired dispatch lease.
3. Roll back the API/web release while leaving the additive migration intact.
4. Existing plain-text drafts and sent history remain readable. Scheduled rows
   remain durable but will not execute while the worker is stopped.

## Verification commands

From a complete repository checkout:

```bash
pnpm exec prettier --check artifacts/adventure-zone/src artifacts/api-server/src lib/api-zod/src lib/db/src docs
pnpm run typecheck
pnpm --filter @workspace/adventure-zone test
pnpm --filter @workspace/api-server test
pnpm run build
git diff --check
```

In the reduced implementation mirror used for this change, focused Vitest runs
covered the profile palette/summary, Gmail query sharing, document renderer,
schema migration, canonical commands, approval transitions, worker lifecycle,
business-time conversion, and delivery bar. Full workspace typecheck/build and
live browser verification require the complete checkout and must be confirmed
by CI or a staging deployment before production rollout.
