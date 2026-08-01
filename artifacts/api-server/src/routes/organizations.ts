import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import {
  organizationListQuerySchema,
  setLastResortInputSchema,
} from "@/features/organizations/last-resort-input";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";

const router: IRouter = Router();
function orgRepo() { return new DrizzleOrganizationRepository(db); }

router.get("/organizations", async (req, res): Promise<void> => {
  const query = organizationListQuerySchema.parse({
    q: req.query.q ?? undefined,
    lastResort: req.query.lastResort ?? undefined,
    leg: req.query.leg ?? undefined,
    page: req.query.page ?? undefined,
  });
  try {
    const organizations = await orgRepo().listOrganizations(query);
    const travelLegs = await new DrizzleTravelLegRepository(db).listTravelLegs();
    res.json({ organizations, travelLegs });
  } catch (err) {
    req.log.error({ err }, "Failed to list organizations");
    res.status(500).json({ error: "Failed to list organizations" });
  }
});

router.get("/organizations/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const organization = await orgRepo().getOrganizationSummary(id);
    if (!organization) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ organization });
  } catch (err) {
    req.log.error({ err }, "Failed to get organization");
    res.status(500).json({ error: "Failed to get organization" });
  }
});

router.post("/organizations/last-resort", async (req, res): Promise<void> => {
  const parsed = setLastResortInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    await orgRepo().setLastResort(parsed.data, new Date());
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update last resort");
    res.status(500).json({ ok: false, error: "Could not update last resort status" });
  }
});

export default router;
