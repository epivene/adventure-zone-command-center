import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { issueBossToken } from "@/features/boss/boss-auth";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { verifyPasswordCredential } from "@/lib/password-credential";
import { DEVELOPMENT_SAMPLE_LOGINS } from "@/features/development/development-sample-accounts";

const router: IRouter = Router(), repository = new DrizzleBossAccountRepository(db);
const login = z.object({ loginName: z.string().trim().min(1).max(120), password: z.string().min(1).max(500) }).strict();
function response(account: { id: string; displayName: string; role: "boss"; sessionVersion: number }) {
  const issued = issueBossToken({ accountId: account.id, sessionVersion: account.sessionVersion });
  return issued && { ...issued, boss: { id: account.id, displayName: account.displayName, role: account.role } };
}
router.post("/boss/auth/login", async (req, res): Promise<void> => {
  const input = login.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter your username and password." }); return; }
  const account = await repository.findByLogin(input.data.loginName);
  if (!account?.enabled || !(await verifyPasswordCredential(input.data.password, account.passwordHash, account.passwordSalt))) { res.status(401).json({ error: "Incorrect username or password" }); return; }
  const payload = response(account);
  if (!payload) { res.status(500).json({ error: "Boss sign-in is not configured" }); return; }
  res.json(payload);
});
router.post("/boss/auth/demo-login", async (_req, res): Promise<void> => {
  if (process.env.NODE_ENV !== "development") { res.status(404).json({ error: "Not found" }); return; }
  const account = await repository.findByLogin(DEVELOPMENT_SAMPLE_LOGINS.boss.loginName);
  if (!account?.enabled) { res.status(503).json({ error: "Development sample account is unavailable" }); return; }
  const payload = response(account);
  if (!payload) { res.status(500).json({ error: "Boss sign-in is not configured" }); return; }
  res.json(payload);
});
router.get("/boss/auth/me", createRequireBossMiddleware(repository), (req, res) => res.json({ ok: true, boss: req.bossAccount }));
export default router;