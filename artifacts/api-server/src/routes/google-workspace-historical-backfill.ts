import { Router, type IRouter, type Request } from "express";

import { GoogleHistoricalBackfillRepository } from "@/features/google-workspace/google-historical-backfill-repository";
import { GoogleHistoricalBackfillService } from "@/features/google-workspace/google-historical-backfill-service";
import { GoogleHistoricalOutcomeReconciler } from "@/features/google-workspace/google-historical-outcome-reconciler";
import { GoogleHistoricalRunLease } from "@/features/google-workspace/google-historical-run-lease";
import { PostgresGoogleValidationRepository } from "@/features/google-workspace/google-validation-repository";

type HistoricalStateView = { status?: string };

type RepositoryAccess = {
  getState(): Promise<unknown>;
  approveFirstBatch(actorId: string): Promise<void>;
  pause(actorId: string): Promise<void>;
};

type ServiceAccess = {
  runNextBatch(): Promise<unknown>;
  retryFailures(limit?: number): Promise<unknown>;
};

type LeaseAccess = {
  recoverStale(): Promise<boolean>;
  acquire(): Promise<boolean>;
  heartbeat(): Promise<void>;
  markErrorIfRunning(): Promise<void>;
};

type ReconcilerAccess = {
  reconcile(): Promise<unknown>;
};

type ValidationAccess = {
  getStatus(): Promise<"not_started" | "ready_for_review" | "approved" | "rejected">;
};

type OwnerRequest = Request & { userId?: string };

function ownerActorId(req: Request): string {
  return ((req as OwnerRequest).userId || "owner").trim() || "owner";
}

function syncEnabledFromEnv(): boolean {
  return process.env.GOOGLE_WORKSPACE_SYNC_ENABLED?.trim().toLowerCase() === "true";
}

function safeCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("GOOGLE_WORKSPACE_")) return code;
  }
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_FAILED";
}

function statusFor(code: string): number {
  if (
    code === "GOOGLE_WORKSPACE_HISTORICAL_SYNC_DISABLED" ||
    code === "GOOGLE_WORKSPACE_HISTORICAL_VALIDATION_APPROVAL_REQUIRED" ||
    code === "GOOGLE_WORKSPACE_HISTORICAL_FIRST_BATCH_APPROVAL_REQUIRED" ||
    code === "GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_ALREADY_RUNNING" ||
    code === "GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_PAUSED" ||
    code === "GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_COMPLETE" ||
    code === "GOOGLE_WORKSPACE_NOT_CONNECTED" ||
    code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"
  ) return 409;
  if (
    code === "GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_UNAVAILABLE" ||
    code === "GOOGLE_WORKSPACE_HISTORICAL_RETRY_UNAVAILABLE"
  ) return 503;
  return 500;
}

export function createGoogleWorkspaceHistoricalBackfillRouter(options?: {
  repository?: RepositoryAccess;
  service?: ServiceAccess;
  lease?: LeaseAccess;
  reconciler?: ReconcilerAccess;
  validation?: ValidationAccess;
  syncEnabled?: boolean;
  actorId?: (req: Request) => string;
}): IRouter {
  const router: IRouter = Router();
  const repository = options?.repository ?? new GoogleHistoricalBackfillRepository();
  const service = options?.service ?? new GoogleHistoricalBackfillService();
  const lease = options?.lease ?? new GoogleHistoricalRunLease();
  const reconciler = options?.reconciler ??
    (options ? { reconcile: async () => undefined } : new GoogleHistoricalOutcomeReconciler());
  const validation = options?.validation ?? new PostgresGoogleValidationRepository();
  const syncEnabled = options?.syncEnabled ?? syncEnabledFromEnv();
  const actorId = options?.actorId ?? ownerActorId;

  async function requireRunGates(): Promise<void> {
    if (!syncEnabled) throw new Error("GOOGLE_WORKSPACE_HISTORICAL_SYNC_DISABLED");
    if ((await validation.getStatus()) !== "approved") {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_VALIDATION_APPROVAL_REQUIRED");
    }
  }

  async function statusWithRecovery(): Promise<unknown> {
    let state = (await repository.getState()) as HistoricalStateView;
    if (state.status === "running" && (await lease.recoverStale())) {
      state = (await repository.getState()) as HistoricalStateView;
    }
    await reconciler.reconcile();
    return repository.getState();
  }

  async function runOneLeasedBatch(): Promise<unknown> {
    let state = (await repository.getState()) as HistoricalStateView;
    if (state.status === "running") {
      const recovered = await lease.recoverStale();
      if (!recovered) {
        throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_ALREADY_RUNNING");
      }
      state = (await repository.getState()) as HistoricalStateView;
    }

    const leaseEligible =
      state.status === "not_started" ||
      state.status === "ready" ||
      state.status === "error";
    if (!leaseEligible) {
      return service.runNextBatch();
    }

    if (!(await lease.acquire())) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_ALREADY_RUNNING");
    }

    const heartbeatTimer = setInterval(() => {
      void lease.heartbeat().catch(() => undefined);
    }, 30_000);
    heartbeatTimer.unref?.();

    try {
      await lease.heartbeat();
      return await service.runNextBatch();
    } catch (error) {
      await lease.markErrorIfRunning().catch(() => undefined);
      throw error;
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  router.get("/google-workspace/historical-gmail", async (_req, res): Promise<void> => {
    try {
      res.json({
        syncEnabled,
        validationStatus: await validation.getStatus(),
        state: await statusWithRecovery(),
      });
    } catch (error) {
      const code = safeCode(error);
      res.status(statusFor(code)).json({ error: code });
    }
  });

  router.post(
    "/google-workspace/historical-gmail/run-next",
    async (_req, res): Promise<void> => {
      try {
        await requireRunGates();
        res.json(await runOneLeasedBatch());
      } catch (error) {
        const code = safeCode(error);
        res.status(statusFor(code)).json({ error: code });
      }
    },
  );

  router.post(
    "/google-workspace/historical-gmail/retry-failures",
    async (_req, res): Promise<void> => {
      try {
        await requireRunGates();
        res.json(await service.retryFailures(250));
      } catch (error) {
        const code = safeCode(error);
        res.status(statusFor(code)).json({ error: code });
      }
    },
  );

  router.post(
    "/google-workspace/historical-gmail/approve-first-batch",
    async (req, res): Promise<void> => {
      try {
        await requireRunGates();
        await repository.approveFirstBatch(actorId(req));
        res.json({ ok: true, state: await repository.getState() });
      } catch (error) {
        const code = safeCode(error);
        res.status(statusFor(code)).json({ error: code });
      }
    },
  );

  router.post(
    "/google-workspace/historical-gmail/pause",
    async (req, res): Promise<void> => {
      try {
        if (!syncEnabled) throw new Error("GOOGLE_WORKSPACE_HISTORICAL_SYNC_DISABLED");
        await repository.pause(actorId(req));
        res.json({ ok: true, state: await repository.getState() });
      } catch (error) {
        const code = safeCode(error);
        res.status(statusFor(code)).json({ error: code });
      }
    },
  );

  return router;
}

export default createGoogleWorkspaceHistoricalBackfillRouter();
