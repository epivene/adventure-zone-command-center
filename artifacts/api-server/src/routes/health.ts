import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { inspectDatabaseHealth } from "@/features/health/db-health";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/db", async (req, res): Promise<void> => {
  try {
    const data = await inspectDatabaseHealth(pool);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Database health diagnostic failed");
    res.status(500).json({
      status: "degraded",
      reason: "diagnostic_failed",
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        max: Number(pool.options.max ?? 10),
      },
      database: null,
    });
  }
});

export default router;
