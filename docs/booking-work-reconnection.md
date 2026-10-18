# Booking work after reconnecting

Owner controls: Admin Tools → Shared booking work (`/settings/booking-work`).
This page loads the work API directly, without loading the full event profile.
An optional `profileId` query parameter narrows the queue. The existing owner
authentication and work-route guards remain unchanged.

To release a card: Edit work → Hand off to → Unassigned → Change assignment.
COM then reads and claims that same card with its current revision. Do not create
a replacement card, overwrite progress, or assume that a draft-ready card proves
an email was never sent. Verify actual sent-mail history before updating progress.

After deployment and connector refresh, `recover_booking_work` can move a card
from a revoked connection to the caller, only for the same owner and OAuth client.
It requires existing `crm:update`, the exact card revision, the prior connection
ID, and a stable retry key. It preserves all work fields except assignment,
revision, and update time. The transactional operation receipt records both
assignments and the recovery reason. Receipt persistence failure rolls back the
assignment. Active, missing, other-client, and other-owner connections require
an owner handoff; card age never grants permission. No scope expansion, background
job, schema migration, or automatic bulk takeover is introduced.

For new outreach, derive the planned mailing date from the actual authorized
send schedule (normally 8 a.m. recipient local time). A rolling offer ends 30
calendar days after that mailing date. An explicitly approved campaign deadline
takes precedence. Follow-ups retain the deadline already communicated; they do
not restart the offer. Owner-relative dates use America/Denver.

Verification: seven isolated PGlite tests cover successful recovery, preservation,
idempotency, changed retry input, active/unrelated prior connections, stale or
changed cards, terminal state, scope/revocation, and receipt-failure rollback.
The fixture mocks profile locking and receipt construction; service, repository,
scope checks and operation storage execute against PostgreSQL-compatible PGlite.
Four changed TS/TSX files passed syntax transpilation. Full app build and deployed
browser verification remain outstanding. This does not repair the separate
profile-detail API 500 or change any live work assignments.
