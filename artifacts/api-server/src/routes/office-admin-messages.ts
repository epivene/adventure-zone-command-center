import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { DrizzleOfficeMessageRepository } from "@/features/office/office-message-repository";

const router: IRouter = Router();
const accounts = new DrizzleOfficeAccountRepository(db);
const messages = new DrizzleOfficeMessageRepository(db);
const uuid = z.string().uuid();
const messageSchema = z.object({ body: z.string().trim().min(1).max(8000) }).strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function accountExists(id: string) {
  if (!uuid.safeParse(id).success) return false;
  const all = await accounts.listAdmin();
  return all.some((account) => account.id === id);
}

router.get("/office-admin/messages/:accountId", async (req, res): Promise<void> => {
  const accountId = param(req.params.accountId);
  if (!(await accountExists(accountId))) {
    res.status(404).json({ error: "Office Coordinator account not found." });
    return;
  }
  res.json({ messages: await messages.list(accountId), unread: await messages.unreadCount(accountId, "owner") });
});

router.post("/office-admin/messages/:accountId", async (req, res): Promise<void> => {
  const accountId = param(req.params.accountId);
  const parsed = messageSchema.safeParse(req.body);
  if (!(await accountExists(accountId))) {
    res.status(404).json({ error: "Office Coordinator account not found." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Add a message." });
    return;
  }
  res.status(201).json({ message: await messages.send(accountId, "owner", parsed.data.body) });
});

router.post("/office-admin/messages/:accountId/read", async (req, res): Promise<void> => {
  const accountId = param(req.params.accountId);
  if (!(await accountExists(accountId))) {
    res.status(404).json({ error: "Office Coordinator account not found." });
    return;
  }
  await messages.markRead(accountId, "owner");
  res.json({ ok: true });
});

export default router;
