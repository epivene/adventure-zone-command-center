import { Router, type IRouter } from "express";

import { ProfileIntegrityAuditService } from "@/features/profile-integrity/profile-integrity-audit";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();

router.use(requireAssistantImportToken);

router.get("/profile-integrity-audit", async (req, res): Promise<void> => {
  try {
    const report = await new ProfileIntegrityAuditService().run(new Date());
    res.json(report);
  } catch (error) {
    req.log.error({ err: error }, "Failed read-only profile integrity audit");
    res.status(500).json({
      ok: false,
      error: "PROFILE_INTEGRITY_AUDIT_FAILED",
    });
  }
});

export default router;
