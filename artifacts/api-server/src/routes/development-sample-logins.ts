import { Router, type IRouter } from "express";
import { DEVELOPMENT_SAMPLE_LOGINS } from "@/features/development/development-sample-accounts";

const router: IRouter = Router();

router.get("/dev/sample-logins", (_req, res): void => {
  if (process.env.NODE_ENV !== "development") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({
    office: {
      loginName: DEVELOPMENT_SAMPLE_LOGINS.office.loginName,
      password: DEVELOPMENT_SAMPLE_LOGINS.office.password,
    },
    manager: {
      legId: DEVELOPMENT_SAMPLE_LOGINS.manager.legId,
      legName: DEVELOPMENT_SAMPLE_LOGINS.manager.legName,
      password: DEVELOPMENT_SAMPLE_LOGINS.manager.password,
    },
  });
});

export default router;