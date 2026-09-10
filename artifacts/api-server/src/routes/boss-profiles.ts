import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { officeEmailDrafts } from "@/db/schema";
import { createGoogleWorkspaceProfileEmailRouter } from "./google-workspace-profile-email";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { OfficeProfileService } from "@/features/office/office-profile-service";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const profiles = new OfficeProfileService(db);
const uuid = z.string().uuid();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/boss/profiles", requireBoss, async (req, res): Promise<void> => {
  const parsed = z.object({
    q: z.string().catch("").default(""),
    page: z.coerce.number().int().min(1).max(10000).catch(1).default(1),
  }).parse({ q: req.query.q ?? undefined, page: req.query.page ?? undefined });
  try {
    res.json(await profiles.listProfiles({ search: parsed.q.trim(), page: parsed.page }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list Boss profiles");
    res.status(500).json({ error: "Could not load profiles." });
  }
});

router.get("/boss/profiles/:profileId", requireBoss, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
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
    req.log.error({ err: error }, "Failed to load Boss profile");
    res.status(500).json({ error: "Could not load profile." });
  }
});

router.use("/boss/google-workspace", requireBoss, createGoogleWorkspaceProfileEmailRouter({ profilePath: "/profiles", emailsOnly: true }));

router.get("/boss/profiles/:profileId/email-drafts", requireBoss, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  if (!uuid.safeParse(profileId).success) { res.status(400).json({ error: "Invalid profile ID." }); return; }
  try {
    const drafts = await db.select({
      id: officeEmailDrafts.id,
      subject: officeEmailDrafts.subject,
      body: officeEmailDrafts.body,
      recipientEmail: officeEmailDrafts.recipientEmail,
      state: officeEmailDrafts.state,
      sentAt: officeEmailDrafts.sentAt,
      updatedAt: officeEmailDrafts.updatedAt,
    }).from(officeEmailDrafts)
      .where(eq(officeEmailDrafts.organizationId, profileId))
      .orderBy(desc(officeEmailDrafts.updatedAt));
    res.json({ drafts });
  } catch (error) {
    req.log?.error?.({ err: error }, "Failed to load Boss profile emails");
    res.status(500).json({ error: "Could not load profile email drafts." });
  }
});

export default router;
