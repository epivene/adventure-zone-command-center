import { Router, type IRouter } from "express";

import {
  PostgresGmailProfileIntegrityRepository,
  repairGmailProfileIntegrity,
} from "@/features/google-workspace/gmail-profile-integrity";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();
const repository = new PostgresGmailProfileIntegrityRepository();

router.use(requireAssistantImportToken);

router.get("/gmail-profile-integrity-audit", async (req, res): Promise<void> => {
  try {
    await repository.ensureSchema();
    const audit = await repository.audit();
    res.json({ ok: true, mode: "read_only", audit });
  } catch (error) {
    req.log.error({ err: error }, "Failed sent Gmail profile-integrity audit");
    res.status(500).json({
      ok: false,
      error: "GMAIL_PROFILE_INTEGRITY_AUDIT_FAILED",
    });
  }
});

router.post("/gmail-profile-integrity-repair", async (req, res): Promise<void> => {
  try {
    const result = await repairGmailProfileIntegrity(repository);
    res.json({ ok: true, result });
  } catch (error) {
    req.log.error({ err: error }, "Failed sent Gmail profile-integrity repair");
    res.status(500).json({
      ok: false,
      error: "GMAIL_PROFILE_INTEGRITY_REPAIR_FAILED",
    });
  }
});

export default router;
