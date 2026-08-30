import { Router, type IRouter } from "express";

import { db } from "@workspace/db";
import { requireOwnerMiddleware } from "@/lib/auth";
import {
  organizationIdSchema,
  setFillerInputSchema,
} from "@/features/organizations/last-resort-input";
import {
  getOrganizationFiller,
  setOrganizationFiller,
} from "@/features/organizations/filler-service";

const router: IRouter = Router();

router.get("/organizations/filler", requireOwnerMiddleware, async (req, res): Promise<void> => {
  const parsed = organizationIdSchema.safeParse(req.query.organizationId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid organizationId" });
    return;
  }
  try {
    const state = await getOrganizationFiller(db, parsed.data);
    if (!state) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      filler: state.filler,
      reason: state.fillerReason,
      changedAt: state.fillerChangedAt instanceof Date
        ? state.fillerChangedAt.toISOString()
        : state.fillerChangedAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to read filler strategy");
    res.status(500).json({ error: "Could not read filler strategy" });
  }
});

router.post("/organizations/filler", requireOwnerMiddleware, async (req, res): Promise<void> => {
  const parsed = setFillerInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    await setOrganizationFiller(db, parsed.data, new Date());
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update filler strategy");
    res.status(500).json({ ok: false, error: "Could not update filler strategy" });
  }
});

export default router;
