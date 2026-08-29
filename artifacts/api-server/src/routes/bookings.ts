import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { BookingService } from "@/features/bookings/booking-service";
import { bookingInputSchema, bookingEditInputSchema } from "@/features/bookings/booking-input";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import {
  addSpecialRequestInputSchema,
  configureBookingPackagesInputSchema,
  decideSpecialRequestInputSchema,
} from "@/features/packages/package-input";
import { DrizzlePackageRepository } from "@/features/packages/package-repository";
import { PackageHistoryRepository } from "@/features/packages/package-history";
import { PackageService } from "@/features/packages/package-service";
import { DrizzleResourceRepository } from "@/features/resources/resource-repository";
import { ResourceService } from "@/features/resources/resource-service";
import { createTripTransferTimeLookup } from "@/features/trips/transfer-time-lookup";
import { LegAssignmentRepository } from "@/features/leg-assignment/leg-assignment-repository";
import { LegAssignmentService } from "@/features/leg-assignment/leg-assignment-service";
import { RouteDriveTimeEstimator } from "@/features/leg-assignment/drive-time-estimator";
import { isQualifiedPotentialStatus } from "@/features/leg-assignment/qualification";

const router: IRouter = Router();

const actionUuid = z.string().uuid().transform((v) => v.toLowerCase());
const configureResourcesSchema = z.object({
  bookingId: actionUuid,
  resourceIds: z.array(actionUuid),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.resourceIds).size !== input.resourceIds.length) {
    ctx.addIssue({ code: "custom", message: "Choose each resource only once." });
  }
});
const acknowledgeConflictSchema = z.object({
  bookingId: actionUuid,
  conflictKey: z.string().trim().min(1),
  reason: z.string().trim().min(1),
}).strict();

function bookingRepo() { return new DrizzleBookingRepository(db); }
function legAssignmentService() {
  return new LegAssignmentService(
    new LegAssignmentRepository(db),
    new RouteDriveTimeEstimator(db),
  );
}

async function evaluateQualifiedBooking(bookingId: string, status: string) {
  if (!isQualifiedPotentialStatus(status)) return;
  await legAssignmentService().evaluate(bookingId);
}

const packageErrorMessages: Record<string, string> = {
  INVALID_PACKAGE_INPUT: "Review the package configuration.",
  BOOKING_NOT_FOUND: "This booking could not be found.",
  PACKAGE_TEMPLATE_NOT_FOUND: "One of the selected packages no longer exists.",
  PACKAGE_TEMPLATE_INACTIVE: "Inactive packages can only be retained when already selected.",
  ASSIGNMENT_NOT_OWNED_BY_BOOKING: "A resource assignment changed. Refresh and review package attribution.",
  ATTRIBUTION_PACKAGE_NOT_SELECTED: "Resource attribution can use only selected packages.",
  TOTAL_REQUIRED: "Enter the shared physical attraction total.",
  SPECIAL_REQUEST_NOT_PENDING: "This request was already decided. Refresh to see its current status.",
};

const resourceErrorMessages: Record<string, string> = {
  INVALID_RESOURCE_INPUT: "Review the resource assignments.",
  BOOKING_NOT_FOUND: "This booking could not be found.",
  RESOURCE_NOT_FOUND: "One of the selected resources no longer exists.",
  CONFLICT_NOT_FOUND: "This conflict changed. Refresh and review the current warning.",
  CONFLICT_ALREADY_ACKNOWLEDGED: "This conflict was already overridden. Refresh to see its details.",
};

router.get("/bookings", async (req, res): Promise<void> => {
  try {
    const bookings = await bookingRepo().listBookings();
    res.json({ bookings });
  } catch (err) {
    req.log.error({ err }, "Failed to list bookings");
    res.status(500).json({ error: "Failed to list bookings" });
  }
});

router.post("/bookings", async (req, res): Promise<void> => {
  const parsed = bookingInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const service = new BookingService(bookingRepo() as any);
    const booking = await service.createBooking(parsed.data as any);
    res.locals.operationalCalendarBookingId = booking.id;
    res.status(201).json({ ok: true, bookingId: booking.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create booking");
    res.status(500).json({ ok: false, error: "Could not create booking" });
  }
});

// Must be before /:id so Express matches complete-follow-up literally
router.post("/bookings/complete-follow-up", async (req, res): Promise<void> => {
  try {
    const service = new BookingService(bookingRepo() as any);
    const result = await service.completeFollowUp(req.body);
    if (result.ok && typeof req.body?.status === "string") {
      await evaluateQualifiedBooking(result.value.bookingId, req.body.status);
    }
    res.json(result ?? { ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to complete follow-up");
    res.status(500).json({ ok: false, error: "Could not complete follow-up" });
  }
});

router.post("/bookings/configure-packages", async (req, res): Promise<void> => {
  const parsed = configureBookingPackagesInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the package configuration." });
    return;
  }
  try {
    const result = await new PackageService(new DrizzlePackageRepository(db)).configureBooking(parsed.data as any);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: packageErrorMessages[result.error.code] ?? "Package configuration failed." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to configure packages");
    res.status(500).json({ ok: false, error: "The package setup could not be saved. Try again." });
  }
});

router.post("/bookings/add-special-request", async (req, res): Promise<void> => {
  const parsed = addSpecialRequestInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Describe the request and choose its count treatment." });
    return;
  }
  try {
    const result = await new PackageService(new DrizzlePackageRepository(db)).addSpecialRequest(parsed.data as any);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: packageErrorMessages[result.error.code] ?? "Could not add request." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to add special request");
    res.status(500).json({ ok: false, error: "The special request could not be added. Try again." });
  }
});

router.post("/bookings/decide-special-request", async (req, res): Promise<void> => {
  const parsed = decideSpecialRequestInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Choose a decision and add a reason." });
    return;
  }
  try {
    const result = await new PackageService(new DrizzlePackageRepository(db)).decideSpecialRequest(parsed.data as any);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: packageErrorMessages[result.error.code] ?? "Could not save decision." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to decide special request");
    res.status(500).json({ ok: false, error: "The request decision could not be saved. Try again." });
  }
});

router.post("/bookings/configure-resources", async (req, res): Promise<void> => {
  const actorId = (req as any).userId as string;
  const parsed = configureResourcesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Review the resource assignments." });
    return;
  }
  try {
    const result = await new ResourceService(
      new DrizzleResourceRepository(db),
      createTripTransferTimeLookup(db),
    ).configureBookingAssignments({ ...parsed.data, actorId });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: resourceErrorMessages[result.error.code] ?? "Could not save assignments." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to configure resources");
    res.status(500).json({ ok: false, error: "The resource assignments could not be saved. Try again." });
  }
});

router.post("/bookings/acknowledge-conflict", async (req, res): Promise<void> => {
  const actorId = (req as any).userId as string;
  const parsed = acknowledgeConflictSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Choose a current conflict and add an override reason." });
    return;
  }
  try {
    const result = await new ResourceService(
      new DrizzleResourceRepository(db),
      createTripTransferTimeLookup(db),
    ).acknowledgeConflict({ ...parsed.data, actorId });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: resourceErrorMessages[result.error.code] ?? "Could not save override." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to acknowledge conflict");
    res.status(500).json({ ok: false, error: "The conflict override could not be saved. Try again." });
  }
});

router.get("/bookings/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const detail = await bookingRepo().getBookingDetail(id);
    if (!detail) { res.status(404).json({ error: "Not found" }); return; }
    const activitySvc = new ActivityService(new DrizzleActivityRepository(db));
    const packageHistoryPromise = new PackageHistoryRepository()
      .compareBooking(id)
      .catch((err) => {
        req.log.warn({ err, bookingId: id }, "Package history comparison unavailable");
        return null;
      });
    const [allTravelLegs, timelinePage, packageHistoryComparison, legAssignment] = await Promise.all([
      new DrizzleTravelLegRepository(db).listTravelLegs({ includeArchived: true }),
      activitySvc.listTimeline({ bookingId: id }),
      packageHistoryPromise,
      new LegAssignmentRepository(db).loadPersistedDecision(id),
    ]);
    res.json({
      ...detail,
      allTravelLegs,
      timeline: timelinePage.items,
      timelineNextPage: timelinePage.nextPage,
      packageHistoryComparison,
      legAssignment,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get booking");
    res.status(500).json({ error: "Failed to get booking" });
  }
});

router.patch("/bookings/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = bookingEditInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const repo = bookingRepo();
    const before = await repo.getBookingDetail(id);
    if (!before) { res.status(404).json({ ok: false, error: "Not found" }); return; }
    await repo.updateBookingDetails(id, parsed.data as any);

    const previousLegId = before.booking.travelLegId;
    const nextLegId = parsed.data.travelLegId ?? null;
    if (previousLegId !== nextLegId && nextLegId) {
      await legAssignmentService().recordManualAssignment(id, nextLegId);
    } else if (
      previousLegId !== nextLegId &&
      nextLegId === null &&
      isQualifiedPotentialStatus(parsed.data.status)
    ) {
      await legAssignmentService().evaluate(id);
    } else if (
      before.booking.status !== parsed.data.status &&
      isQualifiedPotentialStatus(parsed.data.status)
    ) {
      await evaluateQualifiedBooking(id, parsed.data.status);
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update booking");
    res.status(500).json({ ok: false, error: "Could not update booking" });
  }
});

export default router;
