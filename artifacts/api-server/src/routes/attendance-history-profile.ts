import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { AttendanceHistoryRepository } from "@/features/attendance/attendance-history-repository";

const router: IRouter = Router();
const repository = new AttendanceHistoryRepository(db);
const uuid = z.string().uuid();

router.get("/event-profiles/:id/attendance-history", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id ?? "";
  if (!uuid.safeParse(id).success) {
    res.status(400).json({ error: "Invalid profile ID." });
    return;
  }
  try {
    res.json({ history: await repository.listForOrganization(id, "owner") });
  } catch (err) {
    req.log.error({ err }, "Failed to load profile attendance history");
    res.status(500).json({ error: "Could not load attendance history." });
  }
});

export default router;
