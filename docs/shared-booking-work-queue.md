# Shared booking work

The owner Tasks area and each event profile show shared work for Desiree and Com.
Each activity records its booking year, queue, assigned owner, status, next action,
due date, progress, review links and last update. Existing tasks remain available.

Only one unfinished activity can exist for a profile and year. A second claim
returns the existing activity without taking ownership. Completed and cancelled
activities remain in history; a new activity can then be created for that year.

## Com workflow

After deployment, refresh the connector's tools. Existing connections need the
appropriate scopes; this change does not grant additional permissions.

1. Use `list_booking_work` or `read_booking_work` to review existing work (`crm:read`).
2. Use `claim_booking_work` before starting (`crm:append`). Check the receipt's
   `created` result and assigned actor. Existing work is not permission to take over.
3. Use `update_booking_work` with the exact revision and a stable request key
   (`crm:update`). Record progress, a specific next action and review links.
4. Use `waiting_desiree` when a draft or decision needs owner review, or
   `waiting_customer` after an independently authorized communication.
5. Use `release_booking_work` for an explicit handoff. Release preserves the
   activity and its reservation. `claim_existing_booking_work` can claim an
   unassigned activity using its exact revision (`crm:update`).
6. Complete or cancel the activity when appropriate. Closed work cannot reopen.

Retries of the same operation must reuse the same request key and payload.
After a revision conflict, read the latest activity and reconcile changes before
making a new request. The owner can edit or reassign work from the app; those
actions invalidate any older Com revision.

## Scope and limits

- Queues: new leads, replies, follow-ups, paperwork and routes.
- Status is recorded progress, not a live heartbeat or proof that Com is running.
- These tools do not invoke a model, send messages, schedule Com or change bookings.
- A due date records when action is needed; it does not create a reminder job.
- Independent email, calendar and legacy workflows are not locked by this queue.
  Duplicate protection applies when workers participate in the claim workflow.
- Internal draft, document and follow-up links are checked against the profile.
  Email links must use HTTPS. Review links do not authorize sending.
- Connector merges block active same-year collisions until one activity is closed.
  Distinct-year work and completed history move to the surviving profile. Changes
  after merge preview require a new preview. Legacy merge paths may instead reject
  a merge through database foreign-key protection.
- Access remains owner-only in the app; office and boss permissions are unchanged.
- The additive schema runs before API listen, including when the connector is off.

Deploy only after normal review. Then refresh Com's connector and add the
claim-before-work procedure to its operating instructions. This PR does not change
existing automations or remove any chat notification automation.
