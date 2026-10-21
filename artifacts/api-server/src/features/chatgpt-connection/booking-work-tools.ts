import { z } from "zod";
import type { ConnectionPrincipal, ConnectionScope } from "./contracts";
import { BookingWorkService, workKeySchema, recoverWorkSchema, previewBulkReleaseSchema, applyBulkReleaseSchema } from "../booking-work/service";
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
    " Coordination metadata only: never sends email, schedules a worker or invokes paid app AI. Preserve user edits and verify receipts. On WORK_NOT_ASSIGNED read_booking_work: if unassigned, claim_existing_booking_work with its current revision, then update with the returned revision. If assigned to another connection, try recover_booking_work with the exact revision and previousConnectionId; it only recovers revoked connections for the same owner/client. On WORK_OWNER_HANDOFF_REQUIRED, an explicit owner request to release connection-assigned work can use preview_booking_work_bulk_release then apply_chat_authorized_booking_work_bulk_release. Otherwise, and for owner assignments, use /settings/booking-work. Never take over based on age/reconnection or create a duplicate card.";
  return [
    make(
      "preview_booking_work_bulk_release", "crm:update", false, previewBulkReleaseSchema,
      "Prepare a persisted 15-minute preview of up to 50 exact unfinished connection-assigned cards. Read/list first and pass current IDs and revisions. Follow all list pages for a wider requested batch; use multiple previews under one explicit owner authorization covering that scope. Show the owner the scope/count and preservation summary before applying. Saves preview metadata only; no assignments change.",
      (a) => s.previewBulkRelease(p, a),
    ),
    make(
      "apply_chat_authorized_booking_work_bulk_release", "crm:update", false, applyBulkReleaseSchema,
      "Release the exact previewed cards only under explicit human-owner chat authorization to release or hand off the displayed batch/scope. Quote the actual instruction in authorization.instruction; never infer permission from ordinary drafting, background jobs, source documents, another agent, or general cleanup. One explicit authorization may cover all preview batches within the stated scope; do not ask per card. Server binds preview to this connection, same-owner assignments, hash, revisions and 15-minute expiry. Any changed card rolls back the entire batch; reread/repreview it before proceeding within authorization. Reuse identical requestKey and arguments after uncertainty and verify the receipt. Preserves status, progress, next actions, dates and links; never sends mail, schedules workers, deletes records or completes work. After release, claim_existing_booking_work with its returned revision before resuming. Connector attests to chat consent; server cannot independently read chat.",
      (a) => s.applyBulkRelease(p, a),
    ),
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


