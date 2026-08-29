import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { issueLegManagerToken, verifyLegManagerPassword } from "@/features/leg-manager/leg-manager-auth";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { DEVELOPMENT_SAMPLE_LEG_ID } from "@/features/development/development-sample-accounts";

const router: IRouter = Router();
const repo = new DrizzleLegManagerRepository(db);
const requireManager = createRequireLegManagerMiddleware(repo);

router.get("/manager/auth/legs", async (_req, res) => {
  res.json({ legs: await repo.listLoginLegs() });
});

router.post("/manager/auth/login", async (req, res): Promise<void> => {
  const parsed = z.object({ legId: z.string().uuid(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a travel leg and enter its manager password" });
    return;
  }
  const access = await repo.getActiveAccess(parsed.data.legId);
  if (!access || !(await verifyLegManagerPassword(parsed.data.password, access.passwordHash, access.passwordSalt))) {
    res.status(401).json({ error: "Incorrect manager password" });
    return;
  }
  const issued = issueLegManagerToken({ legId: access.legId, sessionVersion: access.sessionVersion });
  if (!issued) {
    res.status(503).json({ error: "Manager sign-in is temporarily unavailable" });
    return;
  }
  res.json({
    token: issued.token,
    expiresAt: issued.expiresAt,
    manager: {
      legId: access.legId,
      legName: access.legName,
      managerName: access.legName,
    },
  });
});

router.post("/manager/auth/demo-login", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV !== "development") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const access = await repo.getActiveAccess(DEVELOPMENT_SAMPLE_LEG_ID);
  if (!access) {
    res.status(503).json({ error: "Development sample account is unavailable" });
    return;
  }
  const issued = issueLegManagerToken({ legId: access.legId, sessionVersion: access.sessionVersion });
  if (!issued) {
    res.status(503).json({ error: "Manager sign-in is temporarily unavailable" });
    return;
  }
  res.json({
    token: issued.token,
    expiresAt: issued.expiresAt,
    manager: {
      legId: access.legId,
      legName: access.legName,
      managerName: access.legName,
    },
  });
});

router.get("/manager/auth/me", requireManager, async (req, res): Promise<void> => {
  const access = await repo.getActiveAccess(req.legManager!.legId);
  if (!access) {
    res.status(401).json({ error: "Manager access is disabled" });
    return;
  }
  res.json({
    manager: {
      legId: access.legId,
      legName: access.legName,
      managerName: access.legName,
    },
  });
});

export default router;
