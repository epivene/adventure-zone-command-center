import { sql, type SQL } from "drizzle-orm";
import {
  eventPlanSchema,
  planDraftSchema,
  legSeasonPlanSchema,
  approvalRequestSchema,
  approvalDecisionInputSchema,
  type ApprovalDecision,
  type ApprovalDecisionInput,
  type PlanFacts,
  type EventPlan,
  type LegSeasonPlan,
  type PlanDraft,
  type PlanningActor,
} from "@workspace/api-zod";

export interface PlanningDatabase {
  execute(query: SQL): PromiseLike<unknown>;
}
export function planningRows<T extends Record<string, unknown>>(
  result: unknown,
): T[] {
  return (
    Array.isArray(result) ? result : (result as { rows: T[] }).rows
  ) as T[];
}
export class PlanningError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
export const actorKey = (actor: PlanningActor) =>
  actor.kind === "owner"
    ? `owner:${actor.subject}`
    : actor.kind === "boss"
      ? `boss:${actor.accountId}`
      : `manager-leg:${actor.legId}`;
export function assertPlanningLeg(actor: PlanningActor, legId: string | null) {
  if (actor.kind === "manager" && actor.legId !== legId)
    throw new PlanningError(403, "OUTSIDE_LEG");
}
export function eventPlanRow(row: Record<string, unknown>): EventPlan {
  return eventPlanSchema.parse({
    bookingId: row.booking_id,
    revision: row.revision,
    draft: row.draft,
    committed: row.committed ?? null,
    invalidationReasons: row.invalidation_reasons ?? [],
  });
}
export class DrizzlePlanningRepository {
  constructor(readonly database: PlanningDatabase) {}
  async appendDecisionIn(
    tx: PlanningDatabase,
    requestId: string,
    actor: PlanningActor,
    input: ApprovalDecisionInput,
    suppliedFacts?: PlanFacts[],
  ): Promise<ApprovalDecision> {
    const body = approvalDecisionInputSchema.parse(input);
    const [row] = planningRows(
      await tx.execute(
        sql`SELECT * FROM leg_plan_approval_requests WHERE id=${requestId}::uuid FOR UPDATE`,
      ),
    );
    if (!row) throw new PlanningError(404, "REQUEST_NOT_FOUND");
    const request = approvalRequestSchema.parse({
      id: row.id,
      type: row.type,
      parentLegId: row.parent_leg_id,
      bookingIds: row.booking_ids,
      planFingerprint: row.plan_fingerprint,
      state: row.state,
      revision: row.revision,
      createdAt: new Date(String(row.created_at)).toISOString(),
    });
    assertPlanningLeg(actor, request.parentLegId);
    await tx.execute(
      sql`SELECT singleton FROM leg_plan_authorities WHERE singleton=1 FOR SHARE`,
    );
    await tx.execute(
      sql`SELECT id FROM boss_accounts WHERE id=(SELECT account_id FROM leg_plan_authorities WHERE singleton=1) FOR SHARE`,
    );
    if (actor.kind === "manager")
      await tx.execute(
        sql`SELECT leg_id FROM leg_manager_access WHERE leg_id=${actor.legId}::uuid FOR SHARE`,
      );
    const [{ authorizeDecision, decisionAuthority }, { loadPlanFacts }] =
      await Promise.all([
        import("./approval-policy"),
        import("./planning-facts"),
      ]);
    const facts =
      suppliedFacts ??
      (await loadPlanFacts(tx, request.bookingIds, actor, new Date()));
    if (
      facts.length !== request.bookingIds.length ||
      request.bookingIds.some((id) => !facts.some((f) => f.booking.id === id))
    )
      throw new PlanningError(422, "EVIDENCE_REQUIRED");
    for (const f of facts) {
      const authorization = authorizeDecision(actor, request, f, body);
      if (!authorization.allowed)
        throw new PlanningError(
          authorization.code === "AUTHORITY_REQUIRED" ? 403 : 409,
          authorization.code,
        );
    }
    const [latest] = planningRows(
      await tx.execute(
        sql`SELECT decision FROM leg_plan_approval_decisions WHERE request_id=${requestId}::uuid ORDER BY decided_at DESC,id DESC LIMIT 1`,
      ),
    );
    if (
      latest?.decision === body.decision ||
      (body.decision === "approved" && latest)
    )
      throw new PlanningError(409, "ALREADY_DECIDED");
    const [saved] = planningRows(
      await tx.execute(
        sql`INSERT INTO leg_plan_approval_decisions(request_id,decision,actor,authority_revision,plan_fingerprint,reason,strategic_acknowledgement) VALUES(${requestId}::uuid,${body.decision},${JSON.stringify(actor)}::jsonb,${decisionAuthority(actor, request, facts[0])!},${request.planFingerprint},${body.reason},${body.strategicAcknowledgement}) RETURNING id,decided_at`,
      ),
    );
    await tx.execute(
      sql`UPDATE leg_plan_approval_requests SET state='decided',revision=revision+1 WHERE id=${requestId}::uuid`,
    );
    return {
      ...body,
      id: String(saved.id),
      requestId,
      actor,
      authorityRevision: decisionAuthority(actor, request, facts[0])!,
      planFingerprint: request.planFingerprint,
      decidedAt: new Date(String(saved.decided_at)).toISOString(),
    };
  }
  async authorizeBookingIn(
    tx: PlanningDatabase,
    bookingId: string,
    actor: PlanningActor,
  ) {
    const [booking] = planningRows<{ travel_leg_id: string | null }>(
      await tx.execute(
        sql`SELECT travel_leg_id FROM bookings WHERE id=${bookingId}::uuid`,
      ),
    );
    if (!booking) throw new PlanningError(404, "BOOKING_NOT_FOUND");
    assertPlanningLeg(actor, booking.travel_leg_id);
    return booking;
  }
  async readBooking(
    bookingId: string,
    actor: PlanningActor,
  ): Promise<EventPlan | null> {
    await this.authorizeBookingIn(this.database, bookingId, actor);
    const [row] = planningRows(
      await this.database.execute(
        sql`SELECT * FROM leg_event_plans WHERE booking_id=${bookingId}::uuid`,
      ),
    );
    return row ? eventPlanRow(row) : null;
  }
  async readSeason(
    legId: string,
    seasonYear: number,
    actor: PlanningActor,
  ): Promise<LegSeasonPlan | null> {
    assertPlanningLeg(actor, legId);
    const [row] = planningRows(
      await this.database.execute(
        sql`SELECT payload,revision FROM leg_season_plans WHERE leg_id=${legId}::uuid AND season_year=${seasonYear}`,
      ),
    );
    return row
      ? legSeasonPlanSchema.parse({
          ...(row.payload as object),
          revision: row.revision,
        })
      : null;
  }
  async saveDraftIn(
    tx: PlanningDatabase,
    input: PlanDraft,
    expectedRevision: number | null,
  ): Promise<EventPlan> {
    const draft = planDraftSchema.parse(input);
    const [leg] = planningRows(
      await tx.execute(
        sql`SELECT id FROM travel_legs WHERE id=${draft.legId}::uuid AND archived_at IS NULL`,
      ),
    );
    if (!leg) throw new PlanningError(422, "LEG_UNAVAILABLE");
    const [existing] = planningRows(
      await tx.execute(
        sql`SELECT revision FROM leg_event_plans WHERE booking_id=${draft.bookingId}::uuid FOR UPDATE`,
      ),
    );
    if ((existing?.revision ?? null) !== expectedRevision)
      throw new PlanningError(409, "STALE_REVISION");
    const [row] = planningRows(
      await tx.execute(sql`INSERT INTO leg_event_plans(booking_id,leg_id,draft) VALUES(${draft.bookingId}::uuid,${draft.legId}::uuid,${JSON.stringify(draft)}::jsonb)
      ON CONFLICT(booking_id) DO UPDATE SET leg_id=EXCLUDED.leg_id,draft=EXCLUDED.draft,revision=leg_event_plans.revision+1,updated_at=now()
      RETURNING *`),
    );
    return eventPlanRow(row);
  }
}
