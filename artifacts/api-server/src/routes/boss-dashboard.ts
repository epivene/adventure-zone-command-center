import { Router, type IRouter } from "express";
import { and, count, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookings, bossAssignments, designProjects, eventChecklistRuns, eventManagerReviews, legExpenses, legReceipts, travelLegs } from "@/db/schema";
import { eventLegLifecycle } from "@/features/leg-manager/event-lifecycle-schema";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
router.get("/boss/dashboard", requireBoss, async (req, res) => {
  const [receipts, submittedDrafts, assignments, reviews, reviewsDue, checklists, lifecycle] = await Promise.all([
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
    req.bossAccount!.studioOfficeAccountId
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
      .where(and(lte(bookings.endsAt, new Date()), isNull(eventManagerReviews.id))).orderBy(desc(bookings.endsAt)).limit(25),
    db.select({ id: eventChecklistRuns.id, bookingId: eventChecklistRuns.bookingId, bookingName: bookings.name, legId: eventChecklistRuns.legId, legName: travelLegs.name, phase: eventChecklistRuns.phase, state: eventChecklistRuns.state, startedAt: eventChecklistRuns.startedAt, completedAt: eventChecklistRuns.completedAt, unableReason: eventChecklistRuns.unableReason })
      .from(eventChecklistRuns).innerJoin(bookings, eq(bookings.id, eventChecklistRuns.bookingId)).innerJoin(travelLegs, eq(travelLegs.id, eventChecklistRuns.legId)).orderBy(desc(eventChecklistRuns.updatedAt)).limit(50),
    (db as any).select({ bookingId: eventLegLifecycle.bookingId, bookingName: bookings.name, legId: eventLegLifecycle.legId, legName: travelLegs.name, checkedOutAt: eventLegLifecycle.checkedOutAt, wrapUpStatus: eventLegLifecycle.wrapUpStatus, wrapUpFinishedAt: eventLegLifecycle.wrapUpFinishedAt, updatedAt: eventLegLifecycle.updatedAt })
      .from(eventLegLifecycle).innerJoin(bookings, eq(bookings.id, eventLegLifecycle.bookingId)).innerJoin(travelLegs, eq(travelLegs.id, eventLegLifecycle.legId)).orderBy(desc(eventLegLifecycle.updatedAt)).limit(25),
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
    assignments,
    reviewAndWrapUp,
    checklistAndMaintenance,
  });
});
export default router;