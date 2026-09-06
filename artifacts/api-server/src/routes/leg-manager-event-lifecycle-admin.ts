import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@workspace/db";
import {
  eventChecklistOverrides,
  eventChecklistItemResults,
  eventChecklistRuns,
  bookings,
  travelLegs,
  resourceConditionIssues,
} from "@/db/schema";
import { EventLifecycleRepository } from "@/features/leg-manager/event-lifecycle-repository";
import { deleteChecklistRun } from "@/features/leg-manager/delete-checklist-run";

const router: IRouter = Router();
const lifecycle = new EventLifecycleRepository(db);
const uuid = z.string().uuid();
const overrideSchema = z.object({
  action: z.enum(["allow_ready_to_operate", "allow_checkout"]),
  reason: z.string().trim().min(1).max(8000),
}).strict();
const resolveIssueSchema = z.object({
  resolutionNote: z.string().trim().min(1).max(8000),
}).strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function rowsOf<T>(value: unknown): T[] {
  if (value && typeof value === "object" && "rows" in value) {
    return ((value as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(value) ? value as T[] : [];
}

router.get("/manager-admin/events/lifecycle", async (_req, res) => {
  res.json({ lifecycles: await lifecycle.listAll() });
});

router.get("/manager-admin/events/checklists", async (req, res): Promise<void> => {
  try {
    const result = await db.execute(sql`
      select
        run.id,
        run.booking_id as "bookingId",
        booking.name as "bookingName",
        run.leg_id as "legId",
        leg.name as "legName",
        run.phase,
        run.state,
        run.started_at as "startedAt",
        run.completed_at as "completedAt",
        run.unable_reason as "unableReason",
        count(item.id) filter (where item.result = 'unsafe')::int as "unsafeCount",
        count(item.id) filter (where item.result = 'needs_work_safe')::int as "needsWorkCount",
        count(item.id) filter (where item.follow_up_sync_state in ('pending','needs_attention'))::int as "followUpAttentionCount",
        exists (
          select 1 from event_checklist_overrides o
          where o.run_id = run.id and o.action = 'allow_ready_to_operate'
        ) as "readyOverride",
        exists (
          select 1 from event_checklist_overrides o
          where o.run_id = run.id and o.action = 'allow_checkout'
        ) as "checkoutOverride"
      from event_checklist_runs run
      join bookings booking on booking.id = run.booking_id
      join travel_legs leg on leg.id = run.leg_id
      left join event_checklist_item_results item on item.run_id = run.id
      group by run.id, booking.id, leg.id
      order by run.started_at desc
    `);
    res.json({ checklists: rowsOf(result) });
  } catch (error) {
    req.log.error({ error }, "Failed to list event checklists for owner");
    res.status(500).json({ error: "Could not load event safety checklists." });
  }
});

router.get("/manager-admin/events/checklists/:runId", async (req, res): Promise<void> => {
  const runId = param(req.params.runId);
  if (!uuid.safeParse(runId).success) { res.status(400).json({ error: "Invalid checklist ID." }); return; }
  const [run] = await db.select({
    id: eventChecklistRuns.id, bookingId: eventChecklistRuns.bookingId, bookingName: bookings.name,
    legId: eventChecklistRuns.legId, legName: travelLegs.name, phase: eventChecklistRuns.phase,
    state: eventChecklistRuns.state, startedAt: eventChecklistRuns.startedAt,
    completedAt: eventChecklistRuns.completedAt, unableReason: eventChecklistRuns.unableReason,
  }).from(eventChecklistRuns)
    .innerJoin(bookings, eq(bookings.id, eventChecklistRuns.bookingId))
    .innerJoin(travelLegs, eq(travelLegs.id, eventChecklistRuns.legId))
    .where(eq(eventChecklistRuns.id, runId)).limit(1);
  if (!run) { res.status(404).json({ error: "Checklist not found." }); return; }
  const items = await db.select({
    id: eventChecklistItemResults.id, label: eventChecklistItemResults.itemLabelSnapshot,
    resourceName: eventChecklistItemResults.resourceNameSnapshot, result: eventChecklistItemResults.result,
    note: eventChecklistItemResults.note, followUpSyncState: eventChecklistItemResults.followUpSyncState,
  }).from(eventChecklistItemResults).where(eq(eventChecklistItemResults.runId, runId));
  res.json({ record: { ...run, items } });
});

router.delete("/manager-admin/events/checklists/:runId", async (req, res): Promise<void> => {
  const runId = param(req.params.runId);
  if (!uuid.safeParse(runId).success) { res.status(400).json({ error: "Invalid checklist ID." }); return; }
  const deleted = await deleteChecklistRun(db, runId);
  if (!deleted) { res.status(404).json({ error: "Checklist not found." }); return; }
  res.json({ ok: true });
});

router.get("/manager-admin/reviews/due", async (_req, res) => {
  const result = await db.execute(sql`
    select b.id as "bookingId", b.name as "bookingName", b.ends_at as "endsAt",
           b.travel_leg_id as "legId", l.name as "legName"
      from bookings b
      join travel_legs l on l.id=b.travel_leg_id
      left join event_manager_reviews r on r.booking_id=b.id
     where b.ends_at <= now() and r.id is null
       and not exists (
         select 1 from event_manager_review_dismissals d
          where d.booking_id=b.id and d.leg_id=b.travel_leg_id
       )
     order by b.ends_at desc
     limit 100
  `);
  res.json({ reviewsDue: rowsOf(result) });
});

router.delete("/manager-admin/reviews/due/:bookingId", async (req, res): Promise<void> => {
  const bookingId = param(req.params.bookingId);
  if (!uuid.safeParse(bookingId).success) { res.status(400).json({ error: "Invalid booking ID." }); return; }
  const [booking] = await db.select({ legId: bookings.travelLegId }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking?.legId) { res.status(404).json({ error: "Review-due item not found." }); return; }
  await db.execute(sql`
    insert into event_manager_review_dismissals (booking_id, leg_id, reason, dismissed_by)
    values (${bookingId}::uuid, ${booking.legId}::uuid, 'Removed from review-due by admin', 'owner')
    on conflict (booking_id, leg_id) do update set
      reason=excluded.reason, dismissed_by=excluded.dismissed_by, dismissed_at=now(), updated_at=now()
  `);
  res.json({ ok: true });
});

router.get("/manager-admin/resource-condition-issues", async (req, res): Promise<void> => {
  const state = req.query.state === "resolved" ? "resolved" : "open";
  try {
    const result = await db.execute(sql`
      select
        issue.id,
        issue.resource_id as "resourceId",
        resource.name as "resourceName",
        issue.booking_id as "bookingId",
        booking.name as "bookingName",
        run.id as "runId",
        run.phase,
        run.leg_id as "legId",
        leg.name as "legName",
        issue.severity,
        issue.state,
        issue.summary,
        issue.note,
        issue.created_at as "createdAt",
        issue.resolved_at as "resolvedAt",
        result.resource_name_snapshot as "resourceNameSnapshot",
        result.item_label_snapshot as "itemLabel",
        result.follow_up_sync_state as "followUpSyncState"
      from resource_condition_issues issue
      join event_checklist_item_results result on result.id = issue.checklist_result_id
      join event_checklist_runs run on run.id = result.run_id
      join bookings booking on booking.id = issue.booking_id
      join travel_legs leg on leg.id = run.leg_id
      left join resources resource on resource.id = issue.resource_id
      where issue.state = ${state}
      order by issue.created_at desc
    `);
    res.json({ issues: rowsOf(result) });
  } catch (error) {
    req.log.error({ error }, "Failed to list checklist condition issues");
    res.status(500).json({ error: "Could not load checklist safety issues." });
  }
});

router.post("/manager-admin/events/checklists/:runId/override", async (req, res): Promise<void> => {
  const runId = param(req.params.runId);
  const parsed = overrideSchema.safeParse(req.body);
  if (!uuid.safeParse(runId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid checklist run." : parsed.error.issues[0]?.message ?? "Review the override." });
    return;
  }
  const run = (
    await db.select().from(eventChecklistRuns).where(eq(eventChecklistRuns.id, runId)).limit(1)
  )[0];
  if (!run) {
    res.status(404).json({ error: "Checklist run not found." });
    return;
  }
  if (
    (parsed.data.action === "allow_ready_to_operate" && run.phase !== "pre_event") ||
    (parsed.data.action === "allow_checkout" && run.phase !== "post_event")
  ) {
    res.status(409).json({ error: "That override does not apply to this checklist phase." });
    return;
  }

  const actorId = String((req as any).userId ?? "owner");
  const [override] = await db
    .insert(eventChecklistOverrides)
    .values({
      runId,
      action: parsed.data.action,
      reason: parsed.data.reason,
      actorId,
    })
    .onConflictDoUpdate({
      target: [eventChecklistOverrides.runId, eventChecklistOverrides.action],
      set: {
        reason: parsed.data.reason,
        actorId,
        createdAt: new Date(),
      },
    })
    .returning();
  res.json({ override });
});

router.post("/manager-admin/resource-condition-issues/:issueId/resolve", async (req, res): Promise<void> => {
  const issueId = param(req.params.issueId);
  const parsed = resolveIssueSchema.safeParse(req.body);
  if (!uuid.safeParse(issueId).success || !parsed.success) {
    res.status(400).json({ error: "A resolution note is required." });
    return;
  }
  const existing = (
    await db.select().from(resourceConditionIssues).where(eq(resourceConditionIssues.id, issueId)).limit(1)
  )[0];
  if (!existing) {
    res.status(404).json({ error: "Condition issue not found." });
    return;
  }
  const actorId = String((req as any).userId ?? "owner");
  const [issue] = await db
    .update(resourceConditionIssues)
    .set({
      state: "resolved",
      resolvedAt: new Date(),
      note: `${existing.note}\n\nOwner resolution (${actorId}): ${parsed.data.resolutionNote}`,
    })
    .where(eq(resourceConditionIssues.id, issueId))
    .returning();
  res.json({ issue });
});

export default router;
