import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { organizations } from "@/db/schema";
import { listProfileSourceDocuments } from "@/features/business-sources/profile-source-documents";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const uuid = z.string().uuid();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/office/profiles/:profileId/source-documents", requireOffice, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  if (!uuid.safeParse(profileId).success) {
    res.status(400).json({ error: "Invalid profile ID." });
    return;
  }
  const [profile] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, profileId))
    .limit(1);
  if (!profile) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }
  try {
    const sourceDocuments = await listProfileSourceDocuments(db, profileId, "office");
    res.json({ sourceDocuments });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Office-safe profile source documents");
    res.status(500).json({ error: "Could not load profile source documents." });
  }
});

export default router;
