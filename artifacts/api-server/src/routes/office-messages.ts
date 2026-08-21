import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { DrizzleOfficeMessageRepository } from "@/features/office/office-message-repository";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const messages = new DrizzleOfficeMessageRepository(db);
const messageSchema = z.object({ body: z.string().trim().min(1).max(8000) }).strict();

router.get("/office/messages", requireOffice, async (req, res) => {
  const accountId = req.officeAccount!.accountId;
  res.json({ messages: await messages.list(accountId), unread: await messages.unreadCount(accountId, "office") });
});
router.post("/office/messages", requireOffice, async (req, res): Promise<void> => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Add a message." }); return; }
  res.status(201).json({ message: await messages.send(req.officeAccount!.accountId, "office", parsed.data.body) });
});
router.post("/office/messages/read", requireOffice, async (req, res) => {
  await messages.markRead(req.officeAccount!.accountId, "office");
  res.json({ ok: true });
});

export default router;
