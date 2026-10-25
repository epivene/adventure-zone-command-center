import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listWorkQueue, queueInput } from "./work-queue";
import {
  WorkflowError,
  type WorkflowDatabase,
  type WorkflowSql,
} from "./workflow-types";

const revision = z.string().trim().min(1).max(100);
const action = z
  .object({
    kind: z.string().trim().min(1).max(500),
    dueAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const base = z.object({ id: z.string().uuid(), expectedRevision: revision });
export const snoozeInput = base
  .extend({ dueAt: z.iso.datetime({ offset: true }) })
  .strict();
export const resolveInput = base
  .extend({
    outcome: z.string().trim().min(1).max(2000),
    nextAction: action.nullable(),
    noFurtherActionReason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine(
    (x) =>
      x.nextAction ? !x.noFurtherActionReason : !!x.noFurtherActionReason,
    "Choose a next action or give a no-further-action reason.",
  );
export const planInput = base
  .extend({
    source: z.enum(["booking", "opportunity", "conversation"]),
    nextAction: action,
  })
  .strict();
export const decideInput = base
  .extend({
    source: z.enum(["booking", "opportunity", "conversation"]),
    finalStatus: z
      .enum(["booked", "not_pursuing", "declined", "cancelled"])
      .optional(),
    outcome: z.string().trim().min(1).max(2000),
    nextAction: action.nullable(),
    noFurtherActionReason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine(
    (x) =>
      x.nextAction ? !x.noFurtherActionReason : !!x.noFurtherActionReason,
    "Choose a next action or give a no-further-action reason.",
  )
  .refine(
    (x) => !x.finalStatus || x.source === "opportunity",
    "A final opportunity status requires an opportunity record.",
  );
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new WorkflowError(
      "INVALID_INPUT",
      400,
      result.error.issues[0]?.message ?? "Review the follow-up.",
    );
  return result.data;
}
function check(row: any, expected: string) {
  if (!row)
    throw new WorkflowError(
      "NOT_FOUND",
      404,
      "This work item no longer exists.",
    );
  if (row.revision !== expected)
    throw new WorkflowError(
      "STALE_REVISION",
      409,
      "This item changed. Refresh before trying again.",
    );
  if (row.completed_at)
    throw new WorkflowError(
      "ALREADY_COMPLETED",
      409,
      "This follow-up is already complete.",
    );
}
function future(value: string, now: Date) {
  if (new Date(value) <= now)
    throw new WorkflowError(
      "INVALID_INPUT",
      400,
      "Choose a future follow-up date.",
    );
}
const iso = (d: any) => (d == null ? null : new Date(d).toISOString());
function saved(r: any) {
  return {
    id: r.id,
    revision: r.revision,
    dueAt: iso(r.due_at),
    completedAt: iso(r.completed_at),
    nextFollowUpId: r.next_follow_up_id ?? null,
  };
}
async function note(
  tx: WorkflowSql,
  row: any,
  body: string,
  subject: string | null = null,
  status: string | null = null,
) {
  await tx.query(
    `INSERT INTO activities(id,organization_id,contact_id,booking_id,kind,subject,status,body,occurred_at,timeline_sort_at)
    VALUES($1,$2,$3,$4,'note',$5,$6,$7,clock_timestamp(),clock_timestamp())`,
    [
      randomUUID(),
      row.organization_id ?? null,
      row.contact_id ?? null,
      row.booking_id ?? null,
      subject,
      status,
      body,
    ],
  );
}
async function lockFollowup(tx: WorkflowSql, id: string) {
  const parent = (
    await tx.query(
      "SELECT COALESCE(f.organization_id,b.organization_id) organization_id FROM follow_ups f LEFT JOIN bookings b ON b.id=f.booking_id WHERE f.id=$1",
      [id],
    )
  ).rows[0];
  if (parent?.organization_id)
    await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      parent.organization_id,
    ]);
  return (
    await tx.query(
      "SELECT *,updated_at::text revision FROM follow_ups WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
}
async function successor(
  tx: WorkflowSql,
  row: any,
  next: z.infer<typeof action>,
) {
  return (
    await tx.query(
      `INSERT INTO follow_ups(id,organization_id,contact_id,booking_id,organization_location_id,kind,due_at,opportunity_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        randomUUID(),
        row.organization_id ?? null,
        row.contact_id ?? null,
        row.booking_id ?? null,
        row.organization_location_id ?? null,
        next.kind,
        next.dueAt,
        row.opportunity_id ?? null,
      ],
    )
  ).rows[0].id as string;
}
export class FollowUpWorkflow {
  constructor(
    private db: WorkflowDatabase,
    private now = () => new Date(),
  ) {}
  list(raw: unknown) {
    return listWorkQueue(this.db, queueInput.parse(raw), this.now());
  }
  async inspectOpportunity(raw: unknown) {
    const id = parse(z.string().uuid(), raw);
    const row = (
      await this.db.query(
        "SELECT id,status,event_year,updated_at::text revision FROM booking_opportunities WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!row)
      throw new WorkflowError("NOT_FOUND", 404, "Opportunity not found.");
    return {
      id: row.id,
      status: row.status,
      eventYear: row.event_year,
      revision: row.revision,
    };
  }
  async snooze(raw: unknown) {
    const input = parse(snoozeInput, raw);
    future(input.dueAt, this.now());
    return this.db.transaction(async (tx) => {
      const row = await lockFollowup(tx, input.id);
      check(row, input.expectedRevision);
      const updated = (
        await tx.query(
          `UPDATE follow_ups SET due_at=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=$1 RETURNING *,updated_at::text revision`,
          [input.id, input.dueAt],
        )
      ).rows[0];
      await tx.query(
        "UPDATE booking_opportunities SET next_action_due_at=$2,updated_at=clock_timestamp() WHERE id=$4 OR (booking_id=$1 AND next_action_due_at=$3)",
        [row.booking_id, input.dueAt, row.due_at, row.opportunity_id],
      );
      await tx.query(
        "UPDATE email_thread_attention SET due_at=$2,revision=$3,updated_at=clock_timestamp() WHERE followup_id=$1",
        [row.id, input.dueAt, randomUUID()],
      );
      await note(
        tx,
        row,
        `Snoozed ${row.kind}. Next follow-up: ${input.dueAt}.`,
      );
      return saved(updated);
    });
  }
  async resolve(raw: unknown) {
    const input = parse(resolveInput, raw);
    if (input.nextAction) future(input.nextAction.dueAt, this.now());
    return this.db.transaction(async (tx) => {
      const row = await lockFollowup(tx, input.id);
      check(row, input.expectedRevision);
      const nextId = input.nextAction
        ? await successor(tx, row, input.nextAction)
        : null;
      const updated = (
        await tx.query(
          `UPDATE follow_ups SET completed_at=clock_timestamp(),outcome=$2,next_follow_up_id=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=$1 RETURNING *,updated_at::text revision`,
          [input.id, input.outcome, nextId],
        )
      ).rows[0];
      // Keep the existing opportunity projection aligned only when it names this reminder's action.
      const opportunities = (
        await tx.query(
          `UPDATE booking_opportunities SET next_action_kind=$2,next_action_due_at=$3,updated_at=clock_timestamp()
        WHERE id=$5 OR (booking_id=$1 AND next_action_due_at=$4) RETURNING id`,
          [
            row.booking_id,
            input.nextAction?.kind ?? null,
            input.nextAction?.dueAt ?? null,
            row.due_at,
            row.opportunity_id,
          ],
        )
      ).rows;
      await tx.query(
        "UPDATE email_thread_attention SET followup_id=$2,due_at=$3,state=CASE WHEN $2::uuid IS NULL THEN 'resolved' ELSE state END,revision=$4,updated_at=clock_timestamp() WHERE followup_id=$1",
        [row.id, nextId, input.nextAction?.dueAt ?? null, randomUUID()],
      );
      await note(
        tx,
        row,
        `Completed ${row.kind}: ${input.outcome}. ${input.nextAction ? `Next action: ${input.nextAction.kind}, due ${input.nextAction.dueAt}.` : `No further action: ${input.noFurtherActionReason}.`}`,
        !input.nextAction && row.booking_id
          ? `Next step: booking:${row.booking_id}`
          : null,
        !input.nextAction ? "no_further_action" : null,
      );
      if (!input.nextAction)
        for (const opportunity of opportunities)
          await note(
            tx,
            row,
            `No further action: ${input.noFurtherActionReason}.`,
            `Next step: opportunity:${opportunity.id}`,
            "no_further_action",
          );
      return saved(updated);
    });
  }
  async plan(raw: unknown) {
    const input = parse(planInput, raw);
    return this.decide({ ...input, outcome: "Next action set" });
  }
  async decide(raw: unknown) {
    const input = parse(decideInput, raw);
    if (input.nextAction) future(input.nextAction.dueAt, this.now());
    return this.db.transaction(async (tx) => {
      const table = {
        booking: "bookings",
        opportunity: "booking_opportunities",
        conversation: "email_thread_attention",
      }[input.source];
      // Identifiers come only from the fixed allowlist above; values stay parameterized.
      const pre = (
        await tx.query(`SELECT * FROM ${table} WHERE id=$1`, [input.id])
      ).rows[0];
      if (!pre)
        throw new WorkflowError(
          "NOT_FOUND",
          404,
          "This work item no longer exists.",
        );
      const org = pre.organization_id ?? pre.profile_id;
      if (org)
        await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          org,
        ]);
      const row = (
        await tx.query(
          `SELECT *,${input.source === "conversation" ? "revision" : "updated_at"}::text revision FROM ${table} WHERE id=$1 FOR UPDATE`,
          [input.id],
        )
      ).rows[0];
      check(row, input.expectedRevision);
      const context = {
        organization_id: org,
        contact_id: row.contact_id ?? row.primary_contact_id ?? null,
        booking_id:
          input.source === "booking" ? row.id : (row.booking_id ?? null),
        opportunity_id: input.source === "opportunity" ? row.id : null,
      };
      const nextId = input.nextAction
        ? await successor(tx, context, input.nextAction)
        : null;
      if (input.source === "opportunity")
        await tx.query(
          "UPDATE booking_opportunities SET next_action_kind=$2,next_action_due_at=$3,status=COALESCE($4,status),updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=$1",
          [
            row.id,
            input.nextAction?.kind ?? null,
            input.nextAction?.dueAt ?? null,
            input.finalStatus ?? null,
          ],
        );
      if (input.source === "conversation")
        await tx.query(
          "UPDATE email_thread_attention SET followup_id=$2,due_at=$3,state=CASE WHEN $2::uuid IS NULL THEN 'resolved' ELSE state END,revision=$4,updated_at=clock_timestamp() WHERE id=$1",
          [row.id, nextId, input.nextAction?.dueAt ?? null, randomUUID()],
        );
      if (input.source === "booking")
        await tx.query(
          "UPDATE bookings SET updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=$1",
          [row.id],
        );
      await note(
        tx,
        context,
        input.nextAction
          ? `${input.outcome}. Next action set: ${input.nextAction.kind}, due ${input.nextAction.dueAt}.`
          : `${input.outcome}. No further action: ${input.noFurtherActionReason}.`,
        !input.nextAction ? `Next step: ${input.source}:${row.id}` : null,
        !input.nextAction ? "no_further_action" : null,
      );
      const current = (
        await tx.query(
          `SELECT ${input.source === "conversation" ? "revision" : "updated_at"}::text revision FROM ${table} WHERE id=$1`,
          [row.id],
        )
      ).rows[0];
      return { nextFollowUpId: nextId, revision: current.revision as string };
    });
  }
}
