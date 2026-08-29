import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { issueOfficeToken } from "@/features/office/office-auth";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { verifyPasswordCredential } from "@/lib/password-credential";
import { DEVELOPMENT_SAMPLE_LOGINS } from "@/features/development/development-sample-accounts";

const router: IRouter = Router();
const repository = new DrizzleOfficeAccountRepository(db);
const requireOffice = createRequireOfficeMiddleware(repository);

const loginSchema = z.object({
  loginName: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(500),
}).strict();

router.post("/office/auth/login", async (req, res): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your username and password." });
    return;
  }
  try {
    const account = await repository.findByLogin(parsed.data.loginName);
    if (!account?.enabled || !(await verifyPasswordCredential(parsed.data.password, account.passwordHash, account.passwordSalt))) {
      res.status(401).json({ error: "Incorrect username or password" });
      return;
    }
    const issued = issueOfficeToken({ accountId: account.id, sessionVersion: account.sessionVersion });
    if (!issued) {
      res.status(500).json({ error: "Office sign-in is not configured" });
      return;
    }
    res.json({
      ...issued,
      office: { id: account.id, displayName: account.displayName, role: account.role },
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to sign in office account");
    res.status(500).json({ error: "Could not sign in. Try again." });
  }
});

router.post("/office/auth/demo-login", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV !== "development") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    const account = await repository.findByLogin(DEVELOPMENT_SAMPLE_LOGINS.office.loginName);
    if (!account?.enabled) {
      res.status(503).json({ error: "Development sample account is unavailable" });
      return;
    }
    const issued = issueOfficeToken({ accountId: account.id, sessionVersion: account.sessionVersion });
    if (!issued) {
      res.status(500).json({ error: "Office sign-in is not configured" });
      return;
    }
    res.json({
      ...issued,
      office: { id: account.id, displayName: account.displayName, role: account.role },
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to sign in development office sample");
    res.status(500).json({ error: "Could not sign in. Try again." });
  }
});

router.get("/office/auth/me", requireOffice, (req, res) => {
  res.json({ ok: true, office: req.officeAccount });
});

export default router;
