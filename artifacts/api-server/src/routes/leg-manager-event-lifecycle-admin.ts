import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { EventLifecycleRepository } from "@/features/leg-manager/event-lifecycle-repository";

const router: IRouter = Router();
const lifecycle = new EventLifecycleRepository(db);

router.get("/manager-admin/events/lifecycle", async (_req, res) => {
  res.json({ lifecycles: await lifecycle.listAll() });
});

export default router;
