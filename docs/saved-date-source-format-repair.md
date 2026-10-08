# Human-readable saved date sources

## Problem

The booking-date repair validator compared the proposed ISO value directly with saved source text. Pikes Peak's saved agreement summary begins:

> 2026-D • NFR Open • July 14–18, Norris Penrose

The source contains the public event range, but does not contain the literal string `2026-07-14` or `2026-07-18`. This produces `DATE_NOT_IN_SAVED_SOURCE`.

Read-only evidence: profile `6321ed7b-066f-4700-908e-98eebe1e85a1`, note `65580da6-81a0-4937-ab55-ea735c204fec`. The same summary separately says Access July 12–19. No live booking or note was changed by this patch.

## Change

Replace the free-text literal check with a bounded format matcher:

- Retain exact saved ISO evidence with token boundaries.
- Recognize named-month dates and ranges, abbreviations, ordinals, hyphens/en/em dashes, “to” and “through”.
- Require an explicit year in the date clause or an explicit initial agreement/season/year heading, including the existing 2026-D heading. Never infer a year from the requested value, booking, note timestamp or an unrelated paragraph.
- Match only the requested start/end of the source range; reject invalid or reversed dates and ambiguous years.
- Human public dates cannot establish equipment/access reservations. Explicit access/setup/reservation dates cannot establish public dates. Mixed clauses are rejected.
- Human date-only evidence supports inclusive dates only; it cannot invent an instant, timezone or exclusive end. Existing `dateEndpointInstant` still supplies America/Denver calendar semantics.
- Generic deposit/payment/reminder/insurance dates do not become public dates.

The selected-source relationship, document acceptance, structured allowed endpoints, ACT classification restrictions, source revision/fingerprint rechecks, signed-window reconciliation, capacity checks and transactional audit workflow are unchanged. This matcher recognizes formatting in an already reviewed source; it does not independently verify the source or approve a booking.

Unsupported/ambiguous prose still requires explicit source review. Do not rewrite a historical agreement note simply to satisfy the old literal check.

## Validation and rollout

The 12 authored matcher cases were executed against the original literal check (8 failures, including the exact Pikes Peak case) and the patched helper (12 passes) in the available V8 runtime. Imports/type annotations were removed for execution; an `it`/`it.each`/`toBe` assertion harness was used. This is matcher verification, **not** a Vitest, PGlite, build or typecheck run.

Two PGlite service cases are added for preview/apply of the saved summary, preserving note text and unresolved reservation dates, and rejecting a source changed between preview and apply. These tests and the repository checks have not run: local process creation is rejected with `helper_unknown_error: setup refresh had errors`.

Keep the PR in draft until repository tests and typechecking can run. After deployment, reread the exact booking and source and run a fresh repair preview. Distinguish the historical 2026 public dates from the separate 2027 renewal and from the July 12–19 access window. Use the existing owner review/apply path; this code task has not applied the live repair. Do not trigger paid Actions for this task.
