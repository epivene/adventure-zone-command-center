import { Router, type IRouter } from "express";
import { and, count, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { bookings, bossAssignments, designCertificates, designOutputs, designProjects, eventChecklistItemResults, eventChecklistRuns, eventManagerReviews, legExpenses, legReceipts, officeEmailDrafts, travelLegs } from "@/db/schema";
import { eventLegLifecycle } from "@/features/leg-manager/event-lifecycle-schema";
import { deleteChecklistRun } from "@/features/leg-manager/delete-checklist-run";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const uuid = z.string().uuid();
const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

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
router.get("/boss/dashboard", requireBoss, async (req, res) => {
  const officeAccountId = req.bossAccount!.studioOfficeAccountId;
  const [receipts, submittedDrafts, assignments, reviews, reviewsDue, checklists, lifecycle, businessDocumentCounts] = await Promise.all([
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
          .where(eq(designProjects.officeAccountId, req.bossAccount!.studioOfficeAccountId))
          .orderBy(desc(designProjects.updatedAt))
          .limit(25)
       : Promise.resolve([]),
    db.select().from(bossAssignments).orderBy(desc(bossAssignments.updatedAt)).limit(25),
    db.select({ id: eventManagerReviews.id, bookingId: eventManagerReviews.bookingId, bookingName: bookings.name, legId: eventManagerReviews.legId, legName: travelLegs.name, rating: eventManagerReviews.rating, feedback: eventManagerReviews.feedback, createdAt: eventManagerReviews.createdAt })
      .from(eventManagerReviews).innerJoin(bookings, eq(bookings.id, eventManagerReviews.bookingId)).innerJoin(travelLegs, eq(travelLegs.id, eventManagerReviews.legId)).orderBy(desc(eventManagerReviews.createdAt)).limit(25),
    db.select({ bookingId: bookings.id, bookingName: bookings.name, legId: bookings.travelLegId, legName: travelLegs.name, endsAt: bookings.endsAt })
      .from(bookings).innerJoin(travelLegs, eq(travelLegs.id, bookings.travelLegId)).leftJoin(eventManagerReviews, eq(eventManagerReviews.bookingId, bookings.id))
      .where(and(
        lte(bookings.endsAt, new Date()),
        isNull(eventManagerReviews.id),
        sql`not exists (select 1 from event_manager_review_dismissals d where d.booking_id=${bookings.id} and d.leg_id=${bookings.travelLegId})`,
      )).orderBy(desc(bookings.endsAt)).limit(25),
    db.select({ id: eventChecklistRuns.id, bookingId: eventChecklistRuns.bookingId, bookingName: bookings.name, legId: eventChecklistRuns.legId, legName: travelLegs.name, phase: eventChecklistRuns.phase, state: eventChecklistRuns.state, startedAt: eventChecklistRuns.startedAt, completedAt: eventChecklistRuns.completedAt, unableReason: eventChecklistRuns.unableReason })
      .from(eventChecklistRuns).innerJoin(bookings, eq(bookings.id, eventChecklistRuns.bookingId)).innerJoin(travelLegs, eq(travelLegs.id, eventChecklistRuns.legId)).orderBy(desc(eventChecklistRuns.updatedAt)).limit(50),
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
       : Promise.resolve([{ value: 0 }, { value: 0 }, { value: 0 }]),
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
    })),
  ];
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
  res.json({
    submittedReceipts: receipts.length,
    receipts: receipts.map(({ amountCents, imageStatus, ...item }) => ({
      ...item,
      amount: amountCents / 100,
      status: imageStatus === "image_uploaded" ? "submitted" : imageStatus,
    })),
    submittedDrafts,
    businessDocumentsCount: businessDocumentCounts.reduce((total, result) => total + Number(result[0]?.value ?? 0), 0),
    assignments,
    reviewAndWrapUp,
    checklistAndMaintenance,
  });
});
export default router;