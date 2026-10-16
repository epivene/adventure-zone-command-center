import { z } from "zod";
import type { ConnectionPrincipal, ConnectionScope } from "./contracts";
import { BookingWorkService, workKeySchema, recoverWorkSchema } from "../booking-work/service";
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
    " Coordination metadata only: never sends email, schedules a worker or invokes paid app AI. Preserve user edits and verify receipts. If work is already assigned, use its review link; do not take over.";
  return [
    make(
      "recover_booking_work",
      "crm:update",
      false,
      recoverWorkSchema,
      "Resume an existing card after reconnection only when its previous connection is revoked and belongs to the same owner and OAuth client. Read the card first; supply its exact revision and previousConnectionId. Preserves all progress, links, dates and status; returns an audited idempotent receipt. An active foreign assignment requires owner handoff at /settings/booking-work, never takeover or a duplicate card. Does not send mail. For outreach, determine the planned send date in the recipient timezone (8 a.m. local), calculate a 30-calendar-day offer from that date, and preserve explicitly approved campaign deadlines and deadlines already sent; do not ask the owner what today's date is.",
      (a) => s.recover(p, a),
    ),
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

