import { randomUUID } from "node:crypto";
import { WorkflowError, type WorkflowDatabase } from "./workflow-types";
export function suggestSentFollowUp(input: {
  purpose: "quote" | "availability" | "normal" | "post_event";
  sentAt: Date;
  overrideDueAt?: string;
}) {
  const due = input.overrideDueAt
    ? new Date(input.overrideDueAt)
    : new Date(
        input.sentAt.getTime() +
          { quote: 4, availability: 4, normal: 7, post_event: 21 }[
            input.purpose
          ] *
            86400000,
      );
  if (!Number.isFinite(due.getTime()) || due <= input.sentAt)
    throw new WorkflowError(
      "INVALID_INPUT",
      400,
      "Choose a follow-up after the sent date.",
    );
  return due.toISOString();
}
export async function recordSentEmailFollowUp(
  db: WorkflowDatabase,
  input: {
    opportunityId: string;
    draftId: string;
    messageId: string;
    sentAt: Date;
  },
) {
  return db.transaction(async (tx) => {
    const parent = (
      await tx.query(
        "SELECT organization_id FROM booking_opportunities WHERE id=$1",
        [input.opportunityId],
      )
    ).rows[0];
    if (!parent)
      throw new WorkflowError("NOT_FOUND", 404, "Opportunity not found.");
    await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      parent.organization_id,
    ]);
    const opportunity = (
      await tx.query(
        "SELECT *,updated_at::text revision FROM booking_opportunities WHERE id=$1 FOR UPDATE",
        [input.opportunityId],
      )
    ).rows[0];
    const marker = `Sent email: ${input.draftId}`;
    if (
      (
        await tx.query(
          "SELECT id FROM activities WHERE organization_id=$1 AND subject=$2 AND deleted_at IS NULL",
          [parent.organization_id, marker],
        )
      ).rows.length
    )
      return;
    const email = (
      await tx.query(
        "SELECT subject,sent_at FROM booking_opportunity_email_state WHERE id=$1 AND opportunity_id=$2 AND state='sent' AND gmail_message_id=$3",
        [input.draftId, input.opportunityId, input.messageId],
      )
    ).rows[0];
    if (!email)
      throw new WorkflowError(
        "SEND_NOT_CONFIRMED",
        409,
        "A confirmed sent record is required.",
      );
    const subject = String(email.subject);
    const booking = opportunity.booking_id
      ? (
          await tx.query("SELECT status,ends_at FROM bookings WHERE id=$1", [
            opportunity.booking_id,
          ])
        ).rows[0]
      : null;
    const purpose =
      booking?.status === "completed"
        ? "post_event"
        : /\bquote|proposal|pricing\b/i.test(subject)
          ? "quote"
          : /\bavailability|available|dates\b/i.test(subject)
            ? "availability"
            : "normal";
    const blocked = [
      "declined",
      "not_pursuing",
      "territory_hold",
      "cancelled",
    ].includes(opportunity.status);
    let next = (
      await tx.query(
        `SELECT id,kind,due_at FROM follow_ups WHERE completed_at IS NULL
      AND opportunity_id=$1 AND ($2::timestamptz IS NULL OR (due_at=$2 AND ($3::text IS NULL OR kind=$3))) ORDER BY due_at,id LIMIT 1`,
        [
          opportunity.id,
          opportunity.next_action_due_at,
          opportunity.next_action_kind,
        ],
      )
    ).rows[0];
    if (!blocked && !next) {
      // An explicit organizer-requested date in the existing projection wins.
      const due = opportunity.next_action_due_at
        ? new Date(opportunity.next_action_due_at).toISOString()
        : suggestSentFollowUp({ purpose, sentAt: new Date(email.sent_at) });
      const kind = opportunity.next_action_kind || `Follow up about ${subject}`;
      next = (
        await tx.query(
          `INSERT INTO follow_ups(id,organization_id,contact_id,booking_id,opportunity_id,kind,due_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,kind,due_at`,
          [
            randomUUID(),
            opportunity.organization_id,
            opportunity.contact_id,
            opportunity.booking_id,
            opportunity.id,
            kind,
            due,
          ],
        )
      ).rows[0];
    }
    if (!blocked)
      await tx.query(
        "UPDATE booking_opportunities SET status=CASE WHEN status='ready_to_contact' THEN 'contacted' ELSE status END,next_action_kind=$2,next_action_due_at=$3,updated_at=clock_timestamp() WHERE id=$1",
        [opportunity.id, next.kind, next.due_at],
      );
    await tx.query(
      `INSERT INTO activities(id,organization_id,contact_id,booking_id,kind,subject,body,occurred_at,timeline_sort_at) VALUES($1,$2,$3,$4,'note',$5,$6,$7,$7)`,
      [
        randomUUID(),
        opportunity.organization_id,
        opportunity.contact_id,
        opportunity.booking_id,
        marker,
        `Sent email about ${subject}. ${blocked ? `Follow-up unchanged: ${opportunity.status.replaceAll("_", " ")}.` : `Next action: ${next.kind}, due ${new Date(next.due_at).toISOString()}.`}`,
        email.sent_at,
      ],
    );
  });
}
export async function reconcileSentEmailFollowUps(db: WorkflowDatabase) {
  const rows = (
    await db.query(`SELECT e.id,e.opportunity_id,e.gmail_message_id,e.sent_at FROM booking_opportunity_email_state e
    WHERE e.state='sent' AND e.gmail_message_id IS NOT NULL AND e.sent_at >= (SELECT activated_at FROM follow_up_workflow_settings WHERE id=true)
    AND NOT EXISTS(SELECT 1 FROM activities a WHERE a.organization_id=e.organization_id AND a.subject='Sent email: '||e.id::text AND a.deleted_at IS NULL)
    ORDER BY e.sent_at,e.id LIMIT 50`)
  ).rows;
  for (const row of rows)
    await recordSentEmailFollowUp(db, {
      opportunityId: row.opportunity_id,
      draftId: row.id,
      messageId: row.gmail_message_id,
      sentAt: new Date(row.sent_at),
    });
}
