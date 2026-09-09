import { Router, type IRouter } from "express";
import { and, count, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { bookings, bossAssignments, designCertificates, designOutputs, designProjects, eventChecklistItemResults, eventChecklistRuns, eventManagerReviews, legExpenses, legReceipts, officeEmailDrafts, travelLegs } from "@/db/schema";
import { eventLegLifecycle } from "@/features/leg-manager/event-lifecycle-schema";
import { deleteChecklistRun } from "@/features/leg-manager/delete-checklist-run";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { BossWorkRequestService } from "@/features/boss-work-requests/boss-work-request-service";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const bossWorkRequestService = new BossWorkRequestService(db);
const uuid = z.string().uuid();
const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const receiptStorage = new GoogleCloudLegManagerObjectStorage();
type RecentCompletedMaintenanceRow = {
  id: string;
  bookingId: string;
  title: string;
  legId: string;
  legName: string;
  phase: string;
  status: string;
  completedAt: Date;
};

const reviewPatchSchema = z.object({
  rating: z.number().int().min(0).max(5).optional(),
  feedback: z.string().trim().max(12000).nullable().optional(),
  organizerSiteNotes: z.string().trim().max(12000).nullable().optional(),
  crewNotes: z.string().trim().max(12000).nullable().optional(),
  recommendReturn: z.enum(["yes", "no", "unsure"]).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "No review changes provided.");

router.get("/boss/maintenance/:runId", requireBoss, async (req, res): Promise<void> => {
  const runId = param(req.params.runId);
  if (!uuid.safeParse(runId).success) { res.status(400).json({ error: "Invalid maintenance record ID." }); return; }
  const [run] = await db.select({
    id: eventChecklistRuns.id, bookingId: eventChecklistRuns.bookingId, bookingName: bookings.name,
    legId: eventChecklistRuns.legId, legName: travelLegs.name, phase: eventChecklistRuns.phase,
    state: eventChecklistRuns.state, startedAt: eventChecklistRuns.startedAt,
    completedAt: eventChecklistRuns.completedAt, unableReason: eventChecklistRuns.unableReason,
  }).from(eventChecklistRuns)
    .innerJoin(bookings, eq(bookings.id, eventChecklistRuns.bookingId))
    .innerJoin(travelLegs, eq(travelLegs.id, eventChecklistRuns.legId))
    .where(eq(eventChecklistRuns.id, runId)).limit(1);
  if (!run) { res.status(404).json({ error: "Maintenance record not found." }); return; }
  const items = await db.select({
    id: eventChecklistItemResults.id, label: eventChecklistItemResults.itemLabelSnapshot,
    resourceName: eventChecklistItemResults.resourceNameSnapshot, result: eventChecklistItemResults.result,
    note: eventChecklistItemResults.note, followUpSyncState: eventChecklistItemResults.followUpSyncState,
  }).from(eventChecklistItemResults).where(eq(eventChecklistItemResults.runId, runId));
  res.json({ record: { ...run, items } });
});

router.delete("/boss/maintenance/:runId", requireBoss, async (req, res): Promise<void> => {
  const runId = param(req.params.runId);
  if (!uuid.safeParse(runId).success) { res.status(400).json({ error: "Invalid maintenance record ID." }); return; }
  const deleted = await deleteChecklistRun(db, runId);
  if (!deleted) { res.status(404).json({ error: "Maintenance record not found." }); return; }
  res.json({ ok: true });
});

router.delete("/boss/reviews/due/:bookingId", requireBoss, async (req, res): Promise<void> => {
  const bookingId = param(req.params.bookingId);
  if (!uuid.safeParse(bookingId).success) { res.status(400).json({ error: "Invalid booking ID." }); return; }
  const [booking] = await db.select({ legId: bookings.travelLegId }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking?.legId) { res.status(404).json({ error: "Review-due item not found." }); return; }
  await db.execute(sql`
    insert into event_manager_review_dismissals (booking_id, leg_id, reason, dismissed_by)
    values (${bookingId}::uuid, ${booking.legId}::uuid, 'Removed from review-due by Boss', ${req.bossAccount!.displayName})
    on conflict (booking_id, leg_id) do update set
      reason=excluded.reason, dismissed_by=excluded.dismissed_by, dismissed_at=now(), updated_at=now()
  `);
  res.json({ ok: true });
});

router.patch("/boss/reviews/:reviewId", requireBoss, async (req, res): Promise<void> => {
  const reviewId = param(req.params.reviewId);
  const parsed = reviewPatchSchema.safeParse(req.body);
  if (!uuid.safeParse(reviewId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid review ID." : parsed.error.issues[0]?.message ?? "Review the changes." });
    return;
  }
  const [review] = await db.update(eventManagerReviews)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(
      eq(eventManagerReviews.id, reviewId),
      sql`exists (
        select 1 from bookings b
        where b.id=${eventManagerReviews.bookingId}
          and b.travel_leg_id=${eventManagerReviews.legId}
      )`,
    ))
    .returning();
  if (!review) { res.status(404).json({ error: "Review not found for an assigned event." }); return; }
  res.json({ review });
});

router.delete("/boss/reviews/:reviewId", requireBoss, async (req, res): Promise<void> => {
  const reviewId = param(req.params.reviewId);
  if (!uuid.safeParse(reviewId).success) { res.status(400).json({ error: "Invalid review ID." }); return; }
  const [review] = await db.delete(eventManagerReviews)
    .where(and(
      eq(eventManagerReviews.id, reviewId),
      sql`exists (
        select 1 from bookings b
        where b.id=${eventManagerReviews.bookingId}
          and b.travel_leg_id=${eventManagerReviews.legId}
      )`,
    ))
    .returning({ id: eventManagerReviews.id, bookingId: eventManagerReviews.bookingId, legId: eventManagerReviews.legId });
  if (!review) { res.status(404).json({ error: "Review not found for an assigned event." }); return; }
  await db.execute(sql`
    insert into event_manager_review_dismissals (booking_id, leg_id, reason, dismissed_by)
    values (${review.bookingId}::uuid, ${review.legId}::uuid, 'Saved review deleted by Boss', ${req.bossAccount!.displayName})
    on conflict (booking_id, leg_id) do update set
      reason=excluded.reason, dismissed_by=excluded.dismissed_by, dismissed_at=now(), updated_at=now()
  `);
  res.json({ ok: true });
});

router.get("/boss/dashboard", requireBoss, async (req, res) => {
  const officeAccountId = req.bossAccount!.studioOfficeAccountId;
  const [receipts, submittedDrafts, assignments, reviews, reviewsDue, checklists, recentCompletedChecklists, lifecycle, businessDocumentCounts] = await Promise.all([
    db.select({
      id: legReceipts.id,
      legId: legReceipts.legId,
      legName: travelLegs.name,
      bookingId: legExpenses.bookingId,
      bookingName: bookings.name,
      amountCents: legExpenses.amountCents,
      category: legExpenses.category,
      vendor: legExpenses.merchant,
      description: legExpenses.notes,
      submittedAt: legReceipts.createdAt,
      imageStatus: legReceipts.imageStatus,
      objectKey: legReceipts.objectKey,
      mimeType: legReceipts.mimeType,
    }).from(legReceipts)
      .innerJoin(legExpenses, eq(legExpenses.id, legReceipts.expenseId))
      .innerJoin(travelLegs, eq(travelLegs.id, legReceipts.legId))
      .leftJoin(bookings, eq(bookings.id, legExpenses.bookingId))
      .where(eq(legReceipts.imageStatus, "image_uploaded"))
      .orderBy(desc(legReceipts.createdAt))
      .limit(50),
     officeAccountId
      ? db.select({
          id: designProjects.id,
          name: designProjects.name,
          type: designProjects.type,
          status: designProjects.status,
          updatedAt: designProjects.updatedAt,
        }).from(designProjects)
          .where(eq(designProjects.officeAccountId, officeAccountId))
          .orderBy(desc(designProjects.updatedAt))
          .limit(25)
       : Promise.resolve([]),
    db.select().from(bossAssignments).orderBy(desc(bossAssignments.updatedAt)).limit(25),
    db.select({ id: eventManagerReviews.id, bookingId: eventManagerReviews.bookingId, bookingName: bookings.name, legId: eventManagerReviews.legId, legName: travelLegs.name, rating: eventManagerReviews.rating, feedback: eventManagerReviews.feedback, organizerSiteNotes: eventManagerReviews.organizerSiteNotes, crewNotes: eventManagerReviews.crewNotes, recommendReturn: eventManagerReviews.recommendReturn, createdAt: eventManagerReviews.createdAt })
      .from(eventManagerReviews).innerJoin(bookings, and(eq(bookings.id, eventManagerReviews.bookingId), eq(bookings.travelLegId, eventManagerReviews.legId))).innerJoin(travelLegs, eq(travelLegs.id, eventManagerReviews.legId)).orderBy(desc(eventManagerReviews.createdAt)).limit(25),
    db.select({ bookingId: bookings.id, bookingName: bookings.name, legId: bookings.travelLegId, legName: travelLegs.name, endsAt: bookings.endsAt })
      .from(bookings).innerJoin(travelLegs, eq(travelLegs.id, bookings.travelLegId)).leftJoin(eventManagerReviews, eq(eventManagerReviews.bookingId, bookings.id))
      .where(and(
        lte(bookings.endsAt, new Date()),
        isNull(eventManagerReviews.id),
        sql`not exists (select 1 from event_manager_review_dismissals d where d.booking_id=${bookings.id} and d.leg_id=${bookings.travelLegId})`,
      )).orderBy(desc(bookings.endsAt)).limit(25),
    db.select({ id: eventChecklistRuns.id, bookingId: eventChecklistRuns.bookingId, bookingName: bookings.name, legId: eventChecklistRuns.legId, legName: travelLegs.name, phase: eventChecklistRuns.phase, state: eventChecklistRuns.state, startedAt: eventChecklistRuns.startedAt, completedAt: eventChecklistRuns.completedAt, unableReason: eventChecklistRuns.unableReason })
      .from(eventChecklistRuns).innerJoin(bookings, eq(bookings.id, eventChecklistRuns.bookingId)).innerJoin(travelLegs, eq(travelLegs.id, eventChecklistRuns.legId)).orderBy(desc(eventChecklistRuns.updatedAt)).limit(50),
    db.execute<RecentCompletedMaintenanceRow>(sql`
      select *
      from (
        select distinct on (run.booking_id)
          run.id,
          run.booking_id as "bookingId",
          event.name as title,
          run.leg_id as "legId",
          leg.name as "legName",
          run.phase,
          run.state as status,
          run.completed_at as "completedAt"
        from event_checklist_runs run
        inner join bookings event on event.id = run.booking_id
        inner join travel_legs leg on leg.id = run.leg_id
        where run.state = 'completed' and run.completed_at is not null
        order by run.booking_id, run.completed_at desc
      ) recent
      order by recent."completedAt" desc
      limit 3
    `),
    (db as any).select({ bookingId: eventLegLifecycle.bookingId, bookingName: bookings.name, legId: eventLegLifecycle.legId, legName: travelLegs.name, checkedOutAt: eventLegLifecycle.checkedOutAt, wrapUpStatus: eventLegLifecycle.wrapUpStatus, wrapUpFinishedAt: eventLegLifecycle.wrapUpFinishedAt, updatedAt: eventLegLifecycle.updatedAt })
      .from(eventLegLifecycle).innerJoin(bookings, eq(bookings.id, eventLegLifecycle.bookingId)).innerJoin(travelLegs, eq(travelLegs.id, eventLegLifecycle.legId)).orderBy(desc(eventLegLifecycle.updatedAt)).limit(25),
     officeAccountId
       ? Promise.all([
           db.select({ value: count() }).from(designOutputs)
             .innerJoin(designProjects, eq(designProjects.id, designOutputs.projectId))
             .where(and(eq(designProjects.officeAccountId, officeAccountId), eq(designOutputs.outputType, "contract"))),
           db.select({ value: count() }).from(designCertificates)
             .where(eq(designCertificates.officeAccountId, officeAccountId)),
           db.select({ value: count() }).from(officeEmailDrafts)
             .where(eq(officeEmailDrafts.officeAccountId, officeAccountId)),
         ])
       : Promise.resolve([[{ value: 0 }], [{ value: 0 }], [{ value: 0 }]]),
  ]);
  const reviewAndWrapUp = [
    ...reviewsDue.map((item) => ({
      id: `review-due:${item.bookingId}`,
      bookingId: item.bookingId,
      title: item.bookingName,
      legId: item.legId,
      legName: item.legName,
      eventDate: item.endsAt,
      status: "review_due",
    })),
    ...lifecycle.map((item: any) => ({
      id: `wrap-up:${item.bookingId}`,
      bookingId: item.bookingId,
      title: item.bookingName,
      legId: item.legId,
      legName: item.legName,
      eventDate: item.updatedAt,
      status: item.wrapUpFinishedAt ? "completed" : "wrap_up_due",
      wrapUpStatus: item.wrapUpStatus,
    })),
    ...reviews.map((item) => ({
      id: item.id,
      bookingId: item.bookingId,
      title: item.bookingName,
      legId: item.legId,
      legName: item.legName,
      eventDate: item.createdAt,
      status: "review_completed",
      rating: item.rating,
      notes: item.feedback,
      feedback: item.feedback,
      organizerSiteNotes: item.organizerSiteNotes,
      crewNotes: item.crewNotes,
      recommendReturn: item.recommendReturn,
    })),
  ];
  const recentCompletedMaintenanceEvents = recentCompletedChecklists.rows;
  const checklistAndMaintenance = checklists.map((item) => ({
    id: item.id,
    bookingId: item.bookingId,
    title: item.bookingName,
    legId: item.legId,
    legName: item.legName,
    phase: item.phase,
    status: item.state,
    dueAt: item.startedAt,
    completedAt: item.completedAt,
    notes: item.unableReason,
  }));
  const visibleReceipts = await Promise.all(receipts.map(async ({ amountCents, imageStatus, objectKey, ...item }) => ({
    ...item,
    amount: amountCents / 100,
    status: imageStatus === "image_uploaded" ? "submitted" : imageStatus,
    imageUrl: imageStatus === "image_uploaded" && objectKey
      ? await receiptStorage.getSignedReadUrl(objectKey, 15 * 60).catch(() => null)
      : null,
  })));
  const workRequestQueue = await bossWorkRequestService.bossQueue(req.bossAccount!.accountId);
  res.json({
    workRequests: {
      needsAttention: workRequestQueue.active.length,
      recentlyCompleted: workRequestQueue.recentlyCompleted.length,
    },
    submittedReceipts: receipts.length,
    receipts: visibleReceipts,
    submittedDrafts,
    businessDocumentsCount: businessDocumentCounts.reduce((total, result) => total + Number(result[0]?.value ?? 0), 0),
    assignments,
    reviewAndWrapUp,
    checklistAndMaintenance,
    recentCompletedMaintenanceEvents,
  });
});
export default router;