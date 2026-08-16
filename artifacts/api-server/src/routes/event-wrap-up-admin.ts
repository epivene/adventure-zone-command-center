import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleEventWrapUpRepository } from "@/features/leg-manager/event-wrap-up-repository";
import { EventWrapUpService, type EventWrapUpDraftInput, type EventWrapUpStore } from "@/features/leg-manager/event-wrap-up-service";
import { DrizzleEventWrapUpSource } from "@/features/leg-manager/event-wrap-up-source";

const draftSchema = z.object({
  ratingStars: z.number().int().min(0).max(5).nullable(),
  ratingNotes: z.string().max(10_000).nullable(),
  actualCashOnHandCents: z.number().int().nonnegative().nullable(),
  cashDifferenceNote: z.string().max(4_000).nullable(),
}).strict();
const travelOverrideSchema = z.object({
  tripId: z.string().uuid(),
  overrideMiles: z.number().nonnegative().nullable().optional(),
  overrideCostCents: z.number().int().nonnegative().nullable().optional(),
  reason: z.string().trim().min(1).max(2_000),
}).strict();
const overheadSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  label: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2_000),
}).strict();
const adjustmentSchema = z.object({
  scope: z.enum(["direct", "true_profit"]),
  amountCents: z.number().int(),
  label: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2_000),
}).strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function actor(req: any) { return String(req.userId ?? "owner"); }

export function createEventWrapUpAdminRouter(deps: {
  service: Pick<EventWrapUpService, "listSubmittedForAdmin" | "loadAdminWrapUp" | "saveAdminDraft" | "reviewAdminWrapUp" | "reopenAdminWrapUp">;
  store: Pick<EventWrapUpStore, "saveTravelOverride" | "saveOverhead" | "addAdjustment" | "deleteAdjustment">;
  payload: (bookingId: string, result: any) => Promise<any>;
  automaticMiles: (bookingId: string, tripId: string) => Promise<number>;
}): IRouter {
  const router: IRouter = Router();

  router.get("/event-wrap-up-admin", async (_req, res): Promise<void> => {
    try {
      const rows = await deps.service.listSubmittedForAdmin();
      const wrapUps = await Promise.all(rows.map((row: any) => deps.payload(row.bookingId, { wrapUp: row, sourceDataChanged: false })));
      res.json({ wrapUps });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Could not load wrap-ups" });
    }
  });

  router.get("/event-wrap-up-admin/:bookingId", async (req, res): Promise<void> => {
    const bookingId = param(req.params.bookingId);
    try {
      const result = await deps.service.loadAdminWrapUp(bookingId);
      res.json(await deps.payload(bookingId, result));
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Could not load wrap-up" });
    }
  });

  router.put("/event-wrap-up-admin/:bookingId", async (req, res): Promise<void> => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review wrap-up" }); return; }
    const bookingId = param(req.params.bookingId);
    try {
      const wrapUp = await deps.service.saveAdminDraft(bookingId, parsed.data as EventWrapUpDraftInput);
      res.json(await deps.payload(bookingId, { wrapUp, sourceDataChanged: false }));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not save wrap-up" });
    }
  });

  router.post("/event-wrap-up-admin/:bookingId/review", async (req, res): Promise<void> => {
    const bookingId = param(req.params.bookingId);
    try {
      const wrapUp = await deps.service.reviewAdminWrapUp(bookingId, actor(req));
      res.json({ wrapUp });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Could not review wrap-up" });
    }
  });

  router.post("/event-wrap-up-admin/:bookingId/reopen", async (req, res): Promise<void> => {
    const bookingId = param(req.params.bookingId);
    try {
      const wrapUp = await deps.service.reopenAdminWrapUp(bookingId, actor(req));
      res.json({ wrapUp });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Could not reopen wrap-up" });
    }
  });

  router.put("/event-wrap-up-admin/:bookingId/travel-allocation", async (req, res): Promise<void> => {
    const parsed = travelOverrideSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "A reason is required" }); return; }
    const bookingId = param(req.params.bookingId);
    try {
      const automaticMiles = await deps.automaticMiles(bookingId, parsed.data.tripId);
      const override = await deps.store.saveTravelOverride({
        bookingId,
        tripId: parsed.data.tripId,
        automaticMiles,
        overrideMiles: parsed.data.overrideMiles ?? null,
        overrideCostCents: parsed.data.overrideCostCents ?? null,
        reason: parsed.data.reason,
        updatedBy: actor(req),
      });
      res.json({ override });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not save travel allocation" });
    }
  });

  router.put("/event-wrap-up-admin/:bookingId/overhead", async (req, res): Promise<void> => {
    const parsed = overheadSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "A reason is required" }); return; }
    const bookingId = param(req.params.bookingId);
    const overhead = await deps.store.saveOverhead({ bookingId, ...parsed.data, updatedBy: actor(req) });
    res.json({ overhead });
  });

  router.post("/event-wrap-up-admin/:bookingId/adjustments", async (req, res): Promise<void> => {
    const parsed = adjustmentSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "A reason is required" }); return; }
    const bookingId = param(req.params.bookingId);
    const adjustment = await deps.store.addAdjustment({ bookingId, ...parsed.data, createdBy: actor(req) });
    res.status(201).json({ adjustment });
  });

  router.delete("/event-wrap-up-admin/:bookingId/adjustments/:adjustmentId", async (req, res): Promise<void> => {
    const deleted = await deps.store.deleteAdjustment(param(req.params.bookingId), param(req.params.adjustmentId));
    if (!deleted) { res.status(404).json({ error: "Adjustment not found" }); return; }
    res.json({ ok: true });
  });

  return router;
}

const store = new DrizzleEventWrapUpRepository(db);
const source = new DrizzleEventWrapUpSource(db, store);
const service = new EventWrapUpService(store, source);
const router = createEventWrapUpAdminRouter({
  service,
  store,
  automaticMiles: (bookingId, tripId) => source.automaticMiles(bookingId, tripId),
  payload: async (bookingId, result) => {
    const wrapUp = result?.wrapUp ?? result ?? null;
    const payload = await source.buildPayload(bookingId, wrapUp);
    return { ...payload, sourceDataChanged: Boolean(result?.sourceDataChanged) };
  },
});

router.get("/event-wrap-up-ratings/family/:familyId", async (req, res): Promise<void> => {
  try {
    const familyId = z.string().uuid().parse(param(req.params.familyId));
    res.json(await store.averageRatingForFamily(familyId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not load rating" });
  }
});

router.get("/event-wrap-up-ratings/organization/:organizationId", async (req, res): Promise<void> => {
  try {
    await store.ensureSchema();
    const organizationId = z.string().uuid().parse(param(req.params.organizationId));
    const result = await db.execute(sql`
      select avg(w.rating_stars)::float as average, count(w.rating_stars)::int as count
      from event_wrap_ups w
      inner join bookings b on b.id=w.booking_id
      where b.organization_id=${organizationId}::uuid and w.rating_stars is not null
    `);
    const row = ((result as any).rows ?? [])[0];
    res.json({ average: row?.average == null ? null : Number(row.average), count: Number(row?.count ?? 0) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not load rating" });
  }
});

export default router;
