# Access-window date repair storage failure

The date-format matcher accepts Pikes Peak's saved July 12–19, 2026 access range, but applying a verified reservation writes `source='reviewed_timestamp'` into `booking_operational_windows`.

The production schema and required startup DDL allow only `app`, `google_calendar` and `manual`. PostgreSQL rejects the incompatible value with a check-constraint violation (23514). The route converts unexpected database exceptions into the generic “Date repair could not be completed. Your draft is preserved.” response. Generating another preview cannot fix this writer/schema mismatch.

## Change

Persist owner-reviewed access windows as `manual`, an existing supported storage source. Retain exact endpoint values, inclusive/exclusive semantics and source references in `booking_date_evidence`. The existing provenance-aware calendar/capacity readers derive the `reviewed_timestamp` projection tag from that evidence; it is not a stored-source value. No production constraint is relaxed.

The shared date-repair SQL fixture now includes the production source check. Previously it accepted arbitrary source strings, hiding this error even in reservation apply tests.

Four PGlite regression cases cover rejection of the unsupported source, insert/update of the saved Pikes Peak public/access ranges, idempotent receipts, preserved history/status, SQL provenance and calendar endpoint readback, and transactional rollback if audit persistence fails. Calendar readback specifically verifies that July 19 access is not shortened by one day.

## Validation status

Source inspection confirms the corrected write uses a value allowed by the actual required startup DDL. Database tests, Vitest, build and typechecking have not run: process creation still fails with `helper_unknown_error: setup refresh had errors`. This is not a live database reproduction or a completed rollout.

Keep the PR in draft pending execution of the date-repair tests and required checks. No production booking, source note, reservation or audit record has been changed in this task. After deployment, use a new exact-source preview and the normal owner Apply workflow, then verify both public and access dates. Do not trigger paid Actions for this task.
