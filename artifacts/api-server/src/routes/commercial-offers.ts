import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { commercialOfferInputSchema } from "@/features/commercial-offers/commercial-offer-input";
import { validateOfferActivation } from "@/features/commercial-offers/commercial-offer-policy";
import { CommercialOfferRepository } from "@/features/commercial-offers/commercial-offer-repository";
import { ensureCommercialOfferSeed } from "@/features/commercial-offers/commercial-offer-seed";

const router: IRouter = Router();
const repository = new CommercialOfferRepository(db);
const uuid = z.string().uuid();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/commercial-offers", async (req, res): Promise<void> => {
  try {
    await ensureCommercialOfferSeed(db);
    res.json({ offers: await repository.listAll() });
  } catch (err) {
    req.log.error({ err }, "Failed to load commercial offer rules");
    res.status(500).json({ error: "Could not load offers and discounts." });
  }
});

router.post("/commercial-offers", async (req, res): Promise<void> => {
  const parsed = commercialOfferInputSchema.safeParse({
    ...req.body,
    state: "proposed",
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this offer." });
    return;
  }
  try {
    const offer = await repository.create({ ...parsed.data, state: "proposed" });
    res.status(201).json({ offer });
  } catch (err) {
    req.log.error({ err }, "Failed to create commercial offer rule");
    res.status(409).json({ error: "An offer with that code may already exist." });
  }
});

router.patch("/commercial-offers/:offerId", async (req, res): Promise<void> => {
  const offerId = param(req.params.offerId);
  if (!uuid.safeParse(offerId).success) {
    res.status(400).json({ error: "Invalid offer ID." });
    return;
  }
  const existing = await repository.getById(offerId);
  if (!existing) {
    res.status(404).json({ error: "Offer not found." });
    return;
  }
  const parsed = commercialOfferInputSchema.safeParse({
    ...req.body,
    state: existing.state,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this offer." });
    return;
  }
  try {
    const offer = await repository.update(offerId, {
      ...parsed.data,
      state: existing.state,
    });
    res.json({ offer });
  } catch (err) {
    req.log.error({ err }, "Failed to update commercial offer rule");
    res.status(500).json({ error: "Could not save this offer." });
  }
});

router.post("/commercial-offers/:offerId/activate", async (req, res): Promise<void> => {
  const offerId = param(req.params.offerId);
  if (!uuid.safeParse(offerId).success) {
    res.status(400).json({ error: "Invalid offer ID." });
    return;
  }
  const existing = await repository.getById(offerId);
  if (!existing) {
    res.status(404).json({ error: "Offer not found." });
    return;
  }
  const errors = validateOfferActivation(existing);
  if (errors.length) {
    res.status(409).json({ error: errors.join(" "), errors });
    return;
  }
  const actorId = String((req as any).userId ?? "owner");
  res.json({ offer: await repository.setState(offerId, "active", actorId) });
});

router.post("/commercial-offers/:offerId/archive", async (req, res): Promise<void> => {
  const offerId = param(req.params.offerId);
  if (!uuid.safeParse(offerId).success) {
    res.status(400).json({ error: "Invalid offer ID." });
    return;
  }
  const actorId = String((req as any).userId ?? "owner");
  const offer = await repository.setState(offerId, "archived", actorId);
  if (!offer) {
    res.status(404).json({ error: "Offer not found." });
    return;
  }
  res.json({ offer });
});

export default router;
