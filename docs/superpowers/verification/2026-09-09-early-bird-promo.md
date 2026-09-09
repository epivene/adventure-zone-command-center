# Early Bird Promo verification

Verified on 2026-09-09 in `design/winter-early-booking-promotion`.

## Focused acceptance evidence

- API focused suite: 13 files, 42 tests passed.
- Web focused suite: 2 files, 7 tests passed.
- `@workspace/db` TypeScript build passed.
- `@workspace/api-server` production build passed.
- `@workspace/adventure-zone` production build passed.

The focused coverage includes the approved 10% offer seed, March 31 campaign cutoff,
30-day customer-specific deadline, qualifying and excluded template categories, all
current convention templates, rich HTML preservation, confirmed-send enrollment,
deadline reuse, interest confirmation, day-15 review-only reminder creation, worker
leases, deposit cancellation, profile actions, Boss review labeling, and startup order.

## Known repository baseline failures

The complete API and web typechecks are not green on the base repository. Their
failures span existing ACT recovery, assistant, bookings, Google Workspace, lead
intake, organization, paper-note, Today, and test-mock typing code. No focused
Early Bird UI file reports a type error. An Early Bird repository comparison error
found during this run was corrected before final verification.

The older broad API suite also has unrelated failures in ACT organization,
organization-location, Google Workspace, paper-note, calendar, and AI suggestion
tests. The older `EventProfilePage.test.tsx` suite remains timing/DOM-order unstable;
the focused Early Bird profile-card and Boss-review tests pass independently.
