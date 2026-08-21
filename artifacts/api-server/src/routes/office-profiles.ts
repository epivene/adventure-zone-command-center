import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { OfficeProfileService } from "@/features/office/office-profile-service";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const profiles = new OfficeProfileService(db);
const uuid = z.string().uuid();

router.get("/office/profiles", requireOffice, async (req, res): Promise<void> => {
  const parsed = z.object({
    q: z.string().catch("").default(""),
    page: z.coerce.number().int().min(1).max(10000).catch(1).default(1),
  }).parse({ q: req.query.q ?? undefined, page: req.query.page ?? undefined });
  try {
    res.json(await profiles.listProfiles({ search: parsed.q.trim(), page: parsed.page }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list Office Coordinator profiles");
    res.status(500).json({ error: "Could not load profiles." });
  }
});

router.get("/office/profiles/:profileId", requireOffice, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  if (!uuid.safeParse(profileId).success) {
    res.status(400).json({ error: "Invalid profile ID." });
    return;
  }
  try {
    const profile = await profiles.getProfile(profileId);
    if (!profile) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({ profile });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Office Coordinator profile");
    res.status(500).json({ error: "Could not load profile." });
  }
});

export default router;
