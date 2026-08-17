import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleCrewRepository } from "@/features/leg-manager/crew-repository";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const crew = new DrizzleCrewRepository(db);

router.delete("/manager/crew/:workerId", requireManager, async (req, res): Promise<void> => {
  const raw = req.params.workerId;
  const workerId = Array.isArray(raw) ? raw[0] ?? "" : raw;
  if (!workerId) {
    res.status(400).json({ error: "Worker id is required" });
    return;
  }
  const worker = await crew.getWorker(workerId);
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  if (!(await crew.workerBelongsToLeg(workerId, req.legManager!.legId))) {
    res.status(403).json({ error: "This worker is not associated with your leg" });
    return;
  }
  await crew.deleteWorker(workerId);
  res.status(204).end();
});

export default router;
