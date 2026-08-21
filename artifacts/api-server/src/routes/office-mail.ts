import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { DrizzleOfficeMailRepository } from "@/features/office/office-mail-repository";
import { OfficeMailError, OfficeMailService } from "@/features/office/office-mail-service";

const router: IRouter = Router();
const repository = new DrizzleOfficeMailRepository(db);
const service = new OfficeMailService(repository);
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const uuid = z.string().uuid();

const preparedSchema = z.object({
  recipientName: z.union([z.string().max(240), z.null()]).transform((value) => value?.trim() || null),
  address1: z.union([z.string().max(400), z.null()]).transform((value) => value?.trim() || null),
  address2: z.union([z.string().max(400), z.null()]).transform((value) => value?.trim() || null),
  city: z.union([z.string().max(120), z.null()]).transform((value) => value?.trim() || null),
  region: z.union([z.string().max(120), z.null()]).transform((value) => value?.trim() || null),
  postalCode: z.union([z.string().max(20), z.null()]).transform((value) => value?.trim() || null),
}).strict();
const mailedSchema = z.object({
  mailedAt: z.coerce.date(),
  note: z.union([z.string().max(2000), z.null()]).transform((value) => value?.trim() || null),
}).strict();

function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function mailError(res: any, error: unknown) {
  if (error instanceof OfficeMailError) {
    const messages = {
      TASK_NOT_FOUND: "Mail task not found.",
      NOT_MAIL_TASK: "That task is not a brochure-mail task.",
      PROFILE_REQUIRED: "This mail task needs a linked profile.",
      NOT_PREPARED: "Mark the brochure prepared before marking it mailed.",
    } as const;
    res.status(error.code === "TASK_NOT_FOUND" ? 404 : 400).json({ error: messages[error.code] });
    return true;
  }
  return false;
}

router.get("/office/mail", requireOffice, async (req, res) => {
  res.json({ mail: await repository.listForOffice(req.officeAccount!.accountId) });
});

router.post("/office/mail/:taskId/prepared", requireOffice, async (req, res): Promise<void> => {
  const taskId = param(req.params.taskId);
  const parsed = preparedSchema.safeParse(req.body);
  if (!uuid.safeParse(taskId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid task ID." : parsed.error.issues[0]?.message ?? "Review the mailing address." });
    return;
  }
  try {
    const mail = await service.markPrepared({ accountId: req.officeAccount!.accountId, taskId, ...parsed.data });
    res.json({ mail });
  } catch (error) {
    if (mailError(res, error)) return;
    req.log.error({ err: error }, "Failed to mark brochure prepared");
    res.status(500).json({ error: "Could not mark the brochure prepared." });
  }
});

router.post("/office/mail/:taskId/mailed", requireOffice, async (req, res): Promise<void> => {
  const taskId = param(req.params.taskId);
  const parsed = mailedSchema.safeParse(req.body);
  if (!uuid.safeParse(taskId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid task ID." : parsed.error.issues[0]?.message ?? "Review the mailed details." });
    return;
  }
  try {
    const mail = await service.markMailed({ accountId: req.officeAccount!.accountId, taskId, ...parsed.data });
    res.json({ mail });
  } catch (error) {
    if (mailError(res, error)) return;
    req.log.error({ err: error }, "Failed to mark brochure mailed");
    res.status(500).json({ error: "Could not mark the brochure mailed." });
  }
});

export default router;
