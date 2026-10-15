import { z } from "zod";
import type { ConnectionPrincipal, ConnectionScope } from "./contracts";
import { BookingWorkService, workKeySchema } from "../booking-work/service";
import {
  createWorkSchema,
  filterSchema,
  patchWorkSchema,
} from "../booking-work/contracts";
export function bookingWorkTools(
  s: BookingWorkService,
  p: ConnectionPrincipal,
) {
  const make = (
    name: string,
    scope: ConnectionScope,
    readOnly: boolean,
    schema: z.ZodType,
    description: string,
    call: (a: any) => Promise<unknown>,
  ) => ({ name, scope, readOnly, schema, description, call });
  const safety =
    " Coordination metadata only: never sends email, schedules a worker or invokes paid app AI. Preserve user edits and verify receipts. On WORK_NOT_ASSIGNED read_booking_work: if unassigned, claim_existing_booking_work with its current revision, then update with the returned revision. If assigned to another actor (including an older connection), report its ID and review link for owner reassignment. Never take over based on age/reconnection or create a duplicate card.";
  return [
    make(
      "list_booking_work",
      "crm:read",
      true,
      filterSchema,
      "Read shared booking work with status, owner, progress and next actions. Follow nextCursor for all records. Last update is not a live heartbeat.",
      (a) => s.list(p, a),
    ),
    make(
      "read_booking_work",
      "crm:read",
      true,
      z.object({ id: z.string().uuid() }).strict(),
      "Read current booking activity and revision before editing.",
      (a) => s.read(p, a.id),
    ),
    make(
      "claim_booking_work",
      "crm:append",
      false,
      createWorkSchema.extend({
        requestKey: z.string().trim().min(1).max(200),
      }),
      "Claim work BEFORE researching or drafting. One active activity per profile/year; returns existing work on conflict without takeover. Reuse requestKey on retries." +
        safety,
      (a) => s.claim(p, a),
    ),
    make(
      "update_booking_work",
      "crm:update",
      false,
      workKeySchema.extend({ patch: patchWorkSchema }),
      "Update your assigned activity using its exact revision. Keep one activity through draft revisions; report progress and next action. Completion does not mark emails sent or follow-ups complete." +
        safety,
      (a) => s.update(p, a),
    ),
    make(
      "release_booking_work",
      "crm:update",
      false,
      workKeySchema,
      "Explicitly release your assignment, retaining all progress and the active activity. Staleness alone is not permission to release." +
        safety,
      (a) => s.release(p, a),
    ),
    make(
      "claim_existing_booking_work",
      "crm:update",
      false,
      workKeySchema,
      "Claim only an explicitly unassigned existing activity using the current revision." +
        safety,
      (a) => s.claimExisting(p, a),
    ),
  ];
}

