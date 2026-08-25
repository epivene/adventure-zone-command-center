import { Router, type IRouter } from "express";
import { db } from "@workspace/db";

import { importLeadWorkbookSchema } from "@/features/lead-intake/lead-intake-input";
import { LeadIntakeRepository } from "@/features/lead-intake/lead-intake-repository";

const router: IRouter = Router();
const repository = new LeadIntakeRepository(db);

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.post("/lead-intake/imports", async (req, res): Promise<void> => {
  const parsed = importLeadWorkbookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The spreadsheet import is invalid.", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await repository.importWorkbook({
      ...parsed.data,
      importedBy: String((req as any).userId ?? "owner"),
    });
    res.status(result.reused ? 200 : 201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to persist lead spreadsheet import");
    res.status(500).json({ error: "Could not import the spreadsheet for review." });
  }
});

router.get("/lead-intake/imports", async (_req, res): Promise<void> => {
  res.json({ batches: await repository.listBatches() });
});

router.get("/lead-intake/imports/:batchId", async (req, res): Promise<void> => {
  const batchId = param(req.params.batchId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    res.status(400).json({ error: "Invalid lead import batch." });
    return;
  }
  const batch = await repository.getBatch(batchId);
  if (!batch) {
    res.status(404).json({ error: "Lead import batch not found." });
    return;
  }
  res.json({ batch });
});

export default router;
