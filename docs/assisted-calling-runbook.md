# Assisted-calling rollout and rollback

This is an owner-only, staged rollout. Do not deploy or enable the feature from
this runbook without an approved release window. Keep private launcher URLs,
phone numbers, credentials, and call notes out of source control and tickets.

## Before the release window

- Confirm the API deployment has `ASSISTED_CALLING_ENABLED=false`.
- Leave `VOICEMAIL_LAUNCH_URL` unset unless the owner has supplied a private
  launcher URL through the deployment environment.
- Take the normal database backup and record the code revision and migration
  runner result. The migrations are additive and recorded call data is retained.

## Rollout

1. Deploy the code with `ASSISTED_CALLING_ENABLED=false`. Confirm `GET
   /api/calls/config` reports `assistedCallingEnabled: false` before continuing.
2. Run the registered database migrations through the normal migration runner.
   Confirm migrations `020_assisted_calling.sql` and
   `021_call_session_metadata.sql` are recorded as applied. Verify every legacy
   nonblank contact phone has exactly one primary `contact_phones` row and stop
   if this query returns any rows:

   ```sql
   SELECT c.id,
          count(cp.id) FILTER (WHERE cp."primary") AS primary_phone_count,
          count(cp.id) FILTER (
            WHERE cp."primary"
              AND cp.number = c.phone
              AND cp.normalized_number IS NOT DISTINCT FROM c.normalized_phone
          ) AS matching_legacy_primary_count
   FROM contacts c
   LEFT JOIN contact_phones cp ON cp.contact_id = c.id
   WHERE btrim(coalesce(c.phone, '')) <> ''
   GROUP BY c.id
   HAVING count(cp.id) FILTER (WHERE cp."primary") <> 1
      OR count(cp.id) FILTER (
           WHERE cp."primary"
             AND cp.number = c.phone
             AND cp.normalized_number IS NOT DISTINCT FROM c.normalized_phone
         ) <> 1;
   ```

   Also confirm `contact_phones` contains no blank numbers and no contact has
   more than one primary row.
3. Optionally set `VOICEMAIL_LAUNCH_URL` in the owner deployment environment.
   Reopen the workspace and verify the action is still labelled **Leave
   voicemail**. Opening the launcher must not claim delivery, connection, or a
   saved call outcome.
4. Set `ASSISTED_CALLING_ENABLED=true` only for the owner deployment. Confirm
   the configuration endpoint reports enabled and that unauthorised users still
   cannot access owner routes.
5. With designated non-sensitive test records, complete one standard test call,
   one office-extension call, one explicitly saved **Left voicemail** log, one
   incoming caller lookup, and one mobile log. Confirm the office call stores
   the selected number and extension snapshots, and each saved outcome creates
   the expected activity and follow-up state exactly once.
6. Review the UI and recorded activities. Confirm no wording claims a call was
   connected, a voicemail was delivered, or any other delivery/connection event
   occurred. The user must explicitly save **Left voicemail** before that
   outcome is recorded.

## Acceptance checks

- Today still shows the queue while the active caller is open.
- The workspace shows booking status, route leg, last-contacted time, mobile and
  office numbers, office extension, unknown number type, **Copy number**, and
  **Do Not Call** with the approved simple wording.
- One exact normalized caller match opens automatically. Area-code and location
  matches remain suggestions that require a click and display their reasons.
- Refresh restores an unfinished note. A failed save retains it; a successful
  save clears it.
- Keyboard focus is visible, fields have announced labels, and interactive touch
  targets are at least 44 by 44 CSS pixels at desktop and 390 by 844 viewports.
- A configured `tel:` handler may open; **Copy number** remains available if it
  does not. Opening the voicemail launcher alone never changes the outcome.

Record the browser, viewport, timestamp, test-record identifiers, and result for
each acceptance check. Do not infer a pass when the browser, configured phone
handler, clipboard permission, or voicemail launcher is unavailable; record the
item as blocked and name the missing dependency.

## Rollback

1. Set `ASSISTED_CALLING_ENABLED=false` and confirm the configuration endpoint
   reports disabled.
2. Leave the additive database migrations in place. Do not delete
   `contact_phones`, call-session metadata, activities, follow-ups, audit rows,
   or recorded call data.
3. Remove or unset `VOICEMAIL_LAUNCH_URL` only if the launcher itself is part of
   the incident.
4. Verify the legacy non-assisted workflow remains available, then capture the
   failure time, affected record IDs, and relevant request IDs without copying
   private call content into the incident report.

Rollback hides the assisted-calling UI; it does not reverse migrations or erase
already recorded calls. Any data correction requires a separate, audited plan.
