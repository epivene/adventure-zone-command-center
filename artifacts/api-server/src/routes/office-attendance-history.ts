import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { AttendanceHistoryRepository } from "@/features/attendance/attendance-history-repository";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const repository = new AttendanceHistoryRepository(db);
const uuid = z.string().uuid();

router.get("/office/profiles/:profileId/attendance-history", requireOffice, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId)
    ? req.params.profileId[0] ?? ""
    : req.params.profileId ?? "";
  if (!uuid.safeParse(profileId).success) {
    res.status(400).json({ error: "Invalid profile ID." });
    return;
  }
  try {
    res.json({ history: await repository.listForOrganization(profileId, "office") });
  } catch (err) {
    req.log.error({ err }, "Failed to load Office profile attendance history");
    res.status(500).json({ error: "Could not load attendance history." });
  }
});

export default router;
