import { Router, type IRouter, type Request, type Response } from "express";

import type {
  ActRecoveryReviewPage,
  ActRecoveryStatus,
} from "@/features/act-recovery/review-service";
import type { ActRecoveryCleanupRetrySummary } from "@/features/act-recovery/review-cleanup-service";
import { cleanReviewSnapshot } from "@/features/act-recovery/review-cleanup";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const targetEntityTypes = new Set(["organization", "contact", "booking"] as const);
type TargetEntityType = "organization" | "contact" | "booking";

export interface ActRecoveryRouteService {
  startRun(input: {
    requestKey: string;
    requestedBy: string;
    sourceDatabaseKey?: string;
  }): Promise<ActRecoveryStatus>;
  startOwnershipRepair?(input: { requestedBy: string }): Promise<ActRecoveryStatus>;
  status(input?: { runId?: string; sourceDatabaseKey?: string }): Promise<ActRecoveryStatus>;
  reviewPage(input: { page: number; pageSize: number }): Promise<ActRecoveryReviewPage>;
  cleanupAndRetry(input: { decidedBy: string }): Promise<ActRecoveryCleanupRetrySummary>;
  assign(input: {
    sourceRecordId: string;
    sourceVersionId: string;
    targetEntityType: TargetEntityType;
    targetEntityId: string;
    decidedBy: string;
  }): Promise<{ ok: true }>;
  drop(input: {
    sourceRecordId: string;
    sourceVersionId: string;
    decidedBy: string;
  }): Promise<{ ok: true }>;
  retry(input: {
    sourceRecordId: string;
    sourceVersionId: string;
    decidedBy: string;
  }): Promise<{ ok: true }>;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "act_recovery_failed")
    : "act_recovery_failed";
}

function errorStatus(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  return 500;
}

function sendError(res: Response, error: unknown) {
  res.status(errorStatus(error)).json({ error: errorCode(error) });
}

function bodyRecord(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredText(value: unknown) {
  return optionalText(value) ?? null;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function unavailableOwnershipRepair() {
  return Object.assign(new Error("act_recovery_ownership_repair_unavailable"), {
    status: 501,
    code: "act_recovery_ownership_repair_unavailable",
  });
}

async function productionService(): Promise<ActRecoveryRouteService> {
  const [
    { db },
    { DrizzleActArchiveRecoveryRepository },
    { ActRecoveryReviewService },
    { ActRecoveryReviewCleanupService },
    { ActOwnershipRepairService },
  ] = await Promise.all([
    import("@/db/client"),
    import("@/features/act-recovery/recovery-repository"),
    import("@/features/act-recovery/review-service"),
    import("@/features/act-recovery/review-cleanup-service"),
    import("@/features/act-recovery/ownership-repair-service"),
  ]);
  const recoveryRepository = new DrizzleActArchiveRecoveryRepository(db);
  const review = new ActRecoveryReviewService(db, recoveryRepository);
  const cleanup = new ActRecoveryReviewCleanupService(db);
  const ownershipRepair = new ActOwnershipRepairService(db, recoveryRepository, review);
  return {
    startRun: (input) => review.startRun(input),
    startOwnershipRepair: (input) => ownershipRepair.start(input),
    status: (input) => review.status(input),
    reviewPage: (input) => review.reviewPage(input),
    cleanupAndRetry: (input) => cleanup.cleanupAndRetry(input.decidedBy),
    assign: (input) => review.assign(input),
    drop: (input) => review.drop(input),
    retry: (input) => review.retry(input),
  };
}

export function createActRecoveryRouter(input: {
  service?: ActRecoveryRouteService;
} = {}): IRouter {
  const router: IRouter = Router();
  const withService = async <T>(action: (service: ActRecoveryRouteService) => Promise<T>) =>
    action(input.service ?? await productionService());

  router.post("/act-recovery/runs", async (req, res) => {
    const body = bodyRecord(req);
    const requestKey = requiredText(body.requestKey);
    if (!requestKey) {
      res.status(400).json({ error: "act_recovery_request_key_required" });
      return;
    }
    const sourceDatabaseKey = optionalText(body.sourceDatabaseKey);
    try {
      const started = await withService((service) => service.startRun({
        requestKey,
        requestedBy: "owner",
        ...(sourceDatabaseKey ? { sourceDatabaseKey } : {}),
      }));
      await withService((service) => service.cleanupAndRetry({ decidedBy: "owner" }));
      res.json(await withService((service) => service.status({ runId: started.runId })));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/act-recovery/ownership-repair", async (_req, res) => {
    try {
      const started = await withService((service) => {
        if (!service.startOwnershipRepair) throw unavailableOwnershipRepair();
        return service.startOwnershipRepair({ requestedBy: "owner" });
      });
      res.json(await withService((service) => service.status({ runId: started.runId })));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/act-recovery/status", async (req, res) => {
    const runId = optionalText(req.query.runId);
    const sourceDatabaseKey = optionalText(req.query.sourceDatabaseKey);
    if (runId && !uuidPattern.test(runId)) {
      res.status(400).json({ error: "act_recovery_run_id_invalid" });
      return;
    }
    try {
      res.json(await withService((service) => service.status({
        ...(runId ? { runId } : {}),
        ...(sourceDatabaseKey ? { sourceDatabaseKey } : {}),
      })));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/act-recovery/review", async (req, res) => {
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
    try {
      const result = await withService((service) => service.reviewPage({ page, pageSize }));
      res.json({
        ...result,
        items: result.items.map((item) => ({
          ...item,
          rawSnapshot: cleanReviewSnapshot(item.rawSnapshot),
        })),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/act-recovery/review/cleanup-retry", async (_req, res) => {
    try {
      res.json({
        ok: true,
        summary: await withService((service) => service.cleanupAndRetry({ decidedBy: "owner" })),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/act-recovery/review/:sourceRecordId/assign", async (req, res) => {
    const sourceRecordId = req.params.sourceRecordId;
    const body = bodyRecord(req);
    const sourceVersionId = body.sourceVersionId;
    const targetEntityType = body.targetEntityType;
    const targetEntityId = body.targetEntityId;
    if (!validUuid(sourceRecordId) || !validUuid(sourceVersionId) || !validUuid(targetEntityId)
      || typeof targetEntityType !== "string"
      || !targetEntityTypes.has(targetEntityType as TargetEntityType)) {
      res.status(400).json({ error: "act_recovery_assignment_invalid" });
      return;
    }
    try {
      res.json(await withService((service) => service.assign({
        sourceRecordId,
        sourceVersionId,
        targetEntityType: targetEntityType as TargetEntityType,
        targetEntityId,
        decidedBy: "owner",
      })));
    } catch (error) {
      sendError(res, error);
    }
  });

  for (const [path, action] of [
    ["drop", "drop"],
    ["retry", "retry"],
  ] as const) {
    router.post(`/act-recovery/review/:sourceRecordId/${path}`, async (req, res) => {
      const sourceRecordId = req.params.sourceRecordId;
      const sourceVersionId = bodyRecord(req).sourceVersionId;
      if (!validUuid(sourceRecordId) || !validUuid(sourceVersionId)) {
        res.status(400).json({ error: "act_recovery_source_version_required" });
        return;
      }
      try {
        res.json(await withService((service) => service[action]({
          sourceRecordId,
          sourceVersionId,
          decidedBy: "owner",
        })));
      } catch (error) {
        sendError(res, error);
      }
    });
  }

  return router;
}

export default createActRecoveryRouter();
