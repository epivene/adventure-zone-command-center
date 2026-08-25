import { Router, type IRouter } from "express";
import eventProfilesRouter from "./event-profiles";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();

router.use(requireAssistantImportToken);
router.use((req, res, next) => {
  if (req.method !== "POST" || req.path !== "/event-profiles") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
});
router.use(eventProfilesRouter);

export default router;
