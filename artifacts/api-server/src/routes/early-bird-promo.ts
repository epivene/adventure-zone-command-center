import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { EarlyBirdPromoRepository, type EarlyBirdPromoRecord } from "@/features/early-bird-promo/early-bird-promo-repository";
import { EarlyBirdPromoService } from "@/features/early-bird-promo/early-bird-promo-service";

const uuid = z.string().uuid();
const eventYear = z.coerce.number().int().min(2000).max(2100);

function promotionView(record: EarlyBirdPromoRecord | null) {
  if (!record) return null;
  return {
    id: record.id,
    name: "Early Bird Promo",
    organizationId: record.organizationId,
    bookingId: record.bookingId,
    eventYear: record.eventYear,
    status: record.status,
    firstSentAt: record.firstSentAt,
    deadlineDate: record.deadlineDate,
    interestConfirmedAt: record.interestConfirmedAt,
    reminderDueAt: record.reminderDueAt,
    reminderPrepared: Boolean(record.reminderDraftId),
    depositReceivedAt: record.depositReceivedAt,
    cancelReason: record.cancelReason,
  };
}

export function createEarlyBirdPromoRouter(input: {
  repository: Pick<EarlyBirdPromoRepository, "getForProfileYear">;
  service: Pick<EarlyBirdPromoService, "confirmEnrollmentInterest" | "recordEnrollmentDeposit" | "cancel">;
  now?: () => Date;
}): IRouter {
  const router = Router();
  const now = input.now ?? (() => new Date());

  router.get("/early-bird-promo/profile/:organizationId", async (req, res) => {
    const organizationId = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : req.params.organizationId;
    const parsed = z.object({ organizationId: uuid, eventYear }).safeParse({ organizationId, eventYear: req.query.eventYear });
    if (!parsed.success) { res.status(400).json({ error: "Enter a valid profile and event year." }); return; }
    const record = await input.repository.getForProfileYear(parsed.data.organizationId, parsed.data.eventYear);
    res.json({ promotion: promotionView(record) });
  });

  router.post("/early-bird-promo/:id/interest", async (req, res) => {
    const parsed = z.object({ id: uuid, evidenceMessageId: z.string().trim().min(1).nullable().optional() }).safeParse({ id: req.params.id, ...req.body });
    if (!parsed.success) { res.status(400).json({ error: "Review the interest details." }); return; }
    const record = await input.service.confirmEnrollmentInterest({ enrollmentId: parsed.data.id, confirmedAt: now(), evidenceMessageId: parsed.data.evidenceMessageId });
    if (!record) { res.status(404).json({ error: "Early Bird Promo enrollment not found." }); return; }
    res.json({ promotion: promotionView(record) });
  });

  router.post("/early-bird-promo/:id/deposit", async (req, res) => {
    const parsed = z.object({ id: uuid, source: z.string().trim().min(1).max(100).default("owner_profile") }).safeParse({ id: req.params.id, ...req.body });
    if (!parsed.success) { res.status(400).json({ error: "Review the deposit details." }); return; }
    const record = await input.service.recordEnrollmentDeposit({ enrollmentId: parsed.data.id, receivedAt: now(), source: parsed.data.source });
    if (!record) { res.status(404).json({ error: "Early Bird Promo enrollment not found." }); return; }
    res.json({ promotion: promotionView(record) });
  });

  router.post("/early-bird-promo/:id/cancel", async (req, res) => {
    const parsed = z.object({ id: uuid, reason: z.string().trim().min(1).max(500) }).safeParse({ id: req.params.id, ...req.body });
    if (!parsed.success) { res.status(400).json({ error: "Enter a cancellation reason." }); return; }
    const record = await input.service.cancel({ enrollmentId: parsed.data.id, reason: parsed.data.reason, cancelledAt: now() });
    res.json({ promotion: promotionView(record) });
  });

  return router;
}

const repository = new EarlyBirdPromoRepository(db);
export default createEarlyBirdPromoRouter({
  repository,
  service: new EarlyBirdPromoService(repository),
});
