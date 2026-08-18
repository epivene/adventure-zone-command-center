import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleCrewRepository } from "@/features/leg-manager/crew-repository";

const router: IRouter = Router();
const crew = new DrizzleCrewRepository(db);

router.delete("/manager-admin/crew/:workerId", async (req, res): Promise<void> => {
  const raw = req.params.workerId;
  const workerId = Array.isArray(raw) ? raw[0] ?? "" : raw;
  if (!workerId) {
    res.status(400).json({ error: "Worker id is required" });
    return;
  }
  if (!(await crew.getWorker(workerId))) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  await crew.deleteWorker(workerId);
  res.status(204).end();
});

export default router;
