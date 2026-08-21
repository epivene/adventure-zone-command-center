import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeMailRepository } from "@/features/office/office-mail-repository";

const router: IRouter = Router();
const repository = new DrizzleOfficeMailRepository(db);
const uuid = z.string().uuid();

router.get("/office-admin/mail", async (req, res): Promise<void> => {
  const raw = typeof req.query.accountId === "string" ? req.query.accountId : null;
  if (raw && !uuid.safeParse(raw).success) {
    res.status(400).json({ error: "Invalid Office Coordinator account." });
    return;
  }
  res.json({ mail: await repository.listForOwner(raw) });
});

export default router;
