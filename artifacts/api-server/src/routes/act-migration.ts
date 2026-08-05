import { Router, type IRouter } from "express";
import { parseActEnvironment } from "@/lib/env";
import {
  createActMigrationPreviewService,
  createActMigrationApplyService,
  createActMigrationWorkspaceReader,
  type StoredMigrationWorkspace,
} from "@/features/act-migration/runtime";
import {
  DrizzleActMigrationSnapshotRepository,
  type SnapshotProgress,
} from "@/features/act-migration/snapshot-repository";
import { ActMigrationSnapshotService } from "@/features/act-migration/snapshot-service";

const router: IRouter = Router();

// ─── In-memory pipeline state ────────────────────────────────────────────────

type PipelinePhase =
  | "snapshotting"
  | "previewing"
  | "apply_gated"
  | "applying"
  | "partially_applied"
  | "applied"
  | "failed";

interface PipelineRun {
  runId: string;
  phase: PipelinePhase;
  error?: string;
  startedAt: Date;
  activityImport?: {
    note: { inserted: number; skipped: number; unlinked: number; errors: number };
    history: { inserted: number; skipped: number; unlinked: number; errors: number };
    activity: { inserted: number; skipped: number; unlinked: number; errors: number };
    errorMessage?: string;
  };
}

const activeRuns = new Map<string, PipelineRun>();
let latestRunId: string | null = null;

// ─── Capture service factory that accepts credential overrides ─────────────

async function buildCaptureService(credentialOverride?: {
  baseUrl: string;
  databaseName: string;
  username: string;
  password: string;
}) {
  const [{ ActApiError }, { ActClient }, { HttpActMigrationSourceClient }] =
    await Promise.all([
      import("@/features/act-sync/act-errors"),
      import("@/features/act-sync/act-client"),
      import("@/features/act-migration/source-client"),
    ]);

  let config: {
    baseUrl: "https://apius.act.com/act.web.api";
    databaseName: string;
    username: string;
    password: string;
  };

  if (credentialOverride) {
    // Validate that baseUrl is the expected value
    const env = parseActEnvironment({
      ACT_API_BASE_URL: credentialOverride.baseUrl,
      ACT_DATABASE_NAME: credentialOverride.databaseName,
      ACT_USERNAME: credentialOverride.username,
      ACT_PASSWORD: credentialOverride.password,
    });
    if (!env.configured) {
      throw new ActApiError("not_configured", false);
    }
    config = env.config;
  } else {
    const env = parseActEnvironment(process.env);
    if (!env.configured) {
      throw new ActApiError("not_configured", false);
    }
    config = env.config;
  }

  const { db } = await import("@/db/client");
  const snapshots = new DrizzleActMigrationSnapshotRepository(db);
  const sourceClient = new HttpActMigrationSourceClient(new ActClient(config));
  return {
    snapshotService: new ActMigrationSnapshotService(sourceClient, snapshots),
    sourceClient,
  };
}

// ─── Background pipeline ─────────────────────────────────────────────────────

async function runPipeline(
  runId: string,
  state: PipelineRun,
  snapshotService: ActMigrationSnapshotService,
  sourceClient: import("@/features/act-migration/source-client").ActMigrationSourceClient,
) {
  try {
    // Phase 1: snapshot — loop until snapshot_complete or non-retryable failure
    state.phase = "snapshotting";
    let snapshotDone = false;
    while (!snapshotDone) {
      const { progress, changed } = await snapshotService.captureNext(runId, {
        maxRequests: 10,
      });
      if (progress.status === "snapshot_complete") {
        snapshotDone = true;
      } else if (progress.status === "failed") {
        const interruption = progress.interruption;
        if (!interruption || !interruption.retryable) {
          // Non-retryable — give up
          state.phase = "failed";
          state.error = `Snapshot failed: ${interruption?.code ?? "unknown"}`;
          await failRunInDb(runId);
          return;
        }
        // Retryable — sleep until the indicated retry time, then loop again
        const waitMs = progress.retryAfter
          ? Math.max(0, progress.retryAfter.getTime() - Date.now())
          : 5_000;
        await sleep(Math.min(waitMs, 30_000));
      } else if (!changed) {
        // No work claimed — all checkpoints are leased or retryable with a
        // future retryAfter. Sleep until the earliest retryAfter so we don't
        // busy-poll between now and when the checkpoint becomes eligible again.
        const waitMs = progress.retryAfter
          ? Math.max(0, progress.retryAfter.getTime() - Date.now())
          : 2_000;
        await sleep(Math.min(waitMs, 30_000));
      }
    }

    // Phase 2: preview
    state.phase = "previewing";
    const previewService = await createActMigrationPreviewService();
    await previewService.finalizePreview(runId);

    // Phase 3: apply — always run (single-owner import tool, no gate needed)
    state.phase = "applying";
    const applyService = await createActMigrationApplyService();
    const batchKey = `auto-${runId}`;
    const startResult = await applyService.start({
      requestKey: batchKey,
      runId,
      requestedBy: "migration-api",
    });
    const batchId = startResult.batchId;

    // Apply loop: bounded by a hard iteration cap, a consecutive-stall cap,
    // and a per-call wall-clock timeout so a hung DB operation can't block
    // indefinitely. Each call to applyService.continue() races against the
    // timeout; if it doesn't resolve in time the apply phase is marked failed.
    const MAX_APPLY_ITERATIONS = 500;
    const MAX_STALL_ITERATIONS = 10;
    const APPLY_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes
    let applyDone = false;
    let applyIteration = 0;
    let stallCount = 0;

    while (!applyDone && applyIteration < MAX_APPLY_ITERATIONS) {
      applyIteration++;

      // Race each batch call against the hard timeout so a single hung
      // transaction (e.g. a lock wait that never resolves) doesn't stall
      // the pipeline forever.
      let result: Awaited<ReturnType<typeof applyService.continue>>;
      try {
        result = await Promise.race([
          applyService.continue({ runId, batchId }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("APPLY_TIMEOUT")),
              APPLY_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.message === "APPLY_TIMEOUT";
        state.phase = "failed";
        state.error = isTimeout
          ? `Apply timeout: apply phase exceeded ${APPLY_TIMEOUT_MS / 60_000} minutes (APPLY_TIMEOUT)`
          : `Apply error: ${err instanceof Error ? err.message : String(err)}`;
        await failRunInDb(runId);
        return;
      }

      // Fatal/non-retryable apply error from the service itself
      if (result.errorCode && !result.retryable) {
        state.phase = "failed";
        state.error = `Apply failed: ${result.errorCode}`;
        await failRunInDb(runId);
        return;
      }

      // Retryable service-level error — sleep, count against stall budget
      if (result.errorCode && result.retryable) {
        stallCount++;
        if (stallCount >= MAX_STALL_ITERATIONS) {
          // Retry budget exhausted — treat remaining failures as terminal
          break;
        }
        const retryAfterStr = result.retryAfter;
        const waitMs = retryAfterStr
          ? Math.max(0, new Date(retryAfterStr).getTime() - Date.now())
          : 5_000;
        await sleep(Math.min(waitMs, 30_000));
        continue;
      }

      const stillPending = result.counts.pending > 0 || result.counts.leased > 0;
      if (!stillPending) {
        applyDone = true;
        stallCount = 0;
      } else if (!result.changed) {
        // No progress this iteration — all operations leased or pending retryAfter
        stallCount++;
        if (stallCount >= MAX_STALL_ITERATIONS) {
          // No forward progress for too long — break rather than loop indefinitely
          break;
        }
        await sleep(1_000);
      } else {
        stallCount = 0;
      }
    }

    // Determine terminal phase based on whether any operations failed
    const { db: finalDb } = await import("@/db/client");
    const finalApply = new (await import("@/features/act-migration/apply-repository")).DrizzleActMigrationApplyRepository(finalDb);
    const finalWorkspace = await finalApply.getApplyWorkspace(runId);
    const finalBatch = finalWorkspace.batches.find((b) => b.id === batchId);
    const hasFailed = (finalBatch?.summary.failed ?? 0) > 0;

    state.phase = hasFailed ? "partially_applied" : "applied";

    // Phase 4: import Act! notes, history, and activities into the activity timeline.
    //
    // Gated on a fully-successful apply: `act_external_links` entries are only
    // created for entities that successfully applied.  Running the import on a
    // partially-applied run would silently count notes for un-applied entities
    // as "unlinked" and they would never be retried.  When the run is re-started
    // and fully applied those notes will be picked up then (idempotency key
    // prevents re-insertion of any notes that did land in a prior run).
    if (state.phase === "applied") {
      let activityImportOutcome: PipelineRun["activityImport"];
      try {
        const { ActMigrationActivityImportService } = await import(
          "@/features/act-migration/activity-import-service"
        );
        const { db: importDb } = await import("@/db/client");
        const activityImporter = new ActMigrationActivityImportService(
          sourceClient,
          importDb,
        );
        // Pass an incremental callback so each stream's result is persisted as
        // soon as it finishes. This makes the import resumable: if the process
        // is killed mid-run the completed streams' counts survive in the DB.
        const partial: PipelineRun["activityImport"] = {
          note: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
          history: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
          activity: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
        };
        const result = await activityImporter.importAll(
          async (streamType, streamResult) => {
            partial![streamType] = streamResult;
            state.activityImport = { ...partial };
            await persistActivityImportSummary(runId, { ...partial });
          },
        );
        activityImportOutcome = result;
      } catch (importErr: unknown) {
        activityImportOutcome = {
          note: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
          history: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
          activity: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
          errorMessage:
            importErr instanceof Error
              ? importErr.message
              : "Activity import failed",
        };
      }

      // Attach to in-memory state so the current run's status response is accurate.
      state.activityImport = activityImportOutcome;

      // Persist to the run's summary JSONB so the result survives server restarts.
      await persistActivityImportSummary(runId, activityImportOutcome);
    }
  } catch (err: unknown) {
    state.phase = "failed";
    state.error =
      err instanceof Error ? err.message : "Unknown pipeline error";
    await failRunInDb(runId);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Persist the activity import result into the run's summary JSONB column so
 * the counts and any error are visible after a server restart.
 */
async function persistActivityImportSummary(
  runId: string,
  outcome: PipelineRun["activityImport"],
): Promise<void> {
  try {
    const [{ db }, { actMigrationRuns }, { eq }, { sql }] = await Promise.all([
      import("@/db/client"),
      import("@/db/schema"),
      import("drizzle-orm"),
      import("drizzle-orm"),
    ]);
    // Merge activityImport into any existing JSONB (reconciliation report etc.)
    // using Postgres || operator so pre-existing keys are preserved.
    const patch = JSON.stringify({ activityImport: outcome ?? null });
    await db
      .update(actMigrationRuns)
      .set({
        summary: sql`COALESCE(${actMigrationRuns.summary}, '{}'::jsonb) || ${patch}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(actMigrationRuns.id, runId));
  } catch {
    // Best-effort — never let a DB error mask the pipeline outcome
  }
}
/**
 * Best-effort: persist "failed" status to the DB so that phase reads derive
 * the correct state from DB alone and survive server restarts.
 */
async function failRunInDb(runId: string): Promise<void> {
  try {
    const [{ db }, { actMigrationRuns }, { eq }] = await Promise.all([
      import("@/db/client"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);
    await db
      .update(actMigrationRuns)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(actMigrationRuns.id, runId));
  } catch {
    // Best-effort — never let a DB error mask the original pipeline failure
  }
}

/**
 * Best-effort: mark a stale apply batch as failed in the DB.
 * Called when we detect an "applying" batch with no in-memory pipeline — the
 * server restarted and the batch was left mid-flight. Persisting "failed" here
 * means subsequent reads derive the correct terminal phase from the DB alone.
 */
async function markStaleBatchFailed(batchId: string, runId: string): Promise<void> {
  try {
    const [{ db }, { actMigrationApplyBatches, actMigrationRuns }, { eq }] =
      await Promise.all([
        import("@/db/client"),
        import("@/db/schema"),
        import("drizzle-orm"),
      ]);
    const now = new Date();
    await Promise.all([
      db
        .update(actMigrationApplyBatches)
        .set({ status: "failed", updatedAt: now })
        .where(eq(actMigrationApplyBatches.id, batchId)),
      db
        .update(actMigrationRuns)
        .set({ status: "failed", updatedAt: now })
        .where(eq(actMigrationRuns.id, runId)),
    ]);
  } catch {
    // Best-effort — display phase is already overridden in formatRunStatus
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/** GET /api/migration/act/config — returns whether env vars are configured */
router.get("/migration/act/config", (_req, res) => {
      const env = parseActEnvironment(process.env);
  res.json({ envConfigured: env.configured });
});

/** POST /api/migration/act/start — starts a new migration run */
router.post("/migration/act/start", (_req, res) => {
  res.status(410).json({ code: "replacement_import_required" });
});

/** GET /api/migration/act/status/latest — status for the most recent run */
router.get(
  "/migration/act/status/latest",
  async (req, res): Promise<void> => {
    try {
      const reader = await createActMigrationWorkspaceReader();
      const envConfigured = parseActEnvironment(process.env).configured;

      const workspace = await reader.getWorkspace({
        runId: latestRunId ?? undefined,
        query: { page: 1, pageSize: 1 },
      });

      if (!workspace) {
        res.json({ envConfigured, run: null });
        return;
      }

      const pipelineState = latestRunId ? activeRuns.get(latestRunId) : undefined;

      // Fire-and-forget stale-batch cleanup
      if (!pipelineState && workspace.apply?.batch) {
        const derivedPhase = derivePhaseFromBatchStatus(workspace.apply.batch.status);
        if (derivedPhase === "applying") {
          markStaleBatchFailed(workspace.apply.batch.id, workspace.progress.runId).catch(() => {});
        }
      }

      res.json({
        envConfigured,
        run: formatRunStatus(workspace, pipelineState),
      });
    } catch (err) {
      req.log?.error({ err }, "Failed to load latest migration status");
      res.status(500).json({ error: "Failed to load migration status" });
    }
  },
);

/** GET /api/migration/act/status/:runId — status for a specific run */
router.get(
  "/migration/act/status/:runId",
  async (req, res): Promise<void> => {
    try {
      const { runId } = req.params;
      const reader = await createActMigrationWorkspaceReader();
      const envConfigured = parseActEnvironment(process.env).configured;

      const workspace = await reader.getWorkspace({
        runId,
        query: { page: 1, pageSize: 1 },
      });

      if (!workspace) {
        res.status(404).json({ error: "Run not found" });
        return;
      }

      const pipelineState = activeRuns.get(runId);

      // Fire-and-forget stale-batch cleanup (same logic as /status/latest)
      if (!pipelineState && workspace.apply?.batch) {
        const derivedPhase = derivePhaseFromBatchStatus(workspace.apply.batch.status);
        if (derivedPhase === "applying") {
          markStaleBatchFailed(workspace.apply.batch.id, workspace.progress.runId).catch(() => {});
        }
      }

      res.json({
        envConfigured,
        run: formatRunStatus(workspace, pipelineState),
      });
    } catch (err) {
      req.log?.error({ err }, "Failed to load migration status");
      res.status(500).json({ error: "Failed to load migration status" });
    }
  },
);

// ─── Helper: format workspace for API response ────────────────────────────────

function formatRunStatus(
  workspace: StoredMigrationWorkspace,
  pipelineState?: PipelineRun,
) {
  const { progress, preview, apply } = workspace;

  const streams = progress.streams.map((s) => ({
    streamType: s.streamType,
    completedCheckpoints: s.completedCheckpoints,
    totalCheckpoints: s.totalCheckpoints,
    stagedRecords: s.stagedRecords,
    failedCheckpoints: s.failedCheckpoints,
    errorCode: s.errorCode,
  }));

  // Phase priority:
  //   1. In-memory pipeline state for the currently active run (most precise)
  //   2. Apply batch status from DB — survives server restarts and captures
  //      whether apply actually ran (and how it ended)
  //   3. Snapshot run status from DB — fallback when no batch exists
  let phase: PipelinePhase;
  let staleBatchDetected = false;
  if (pipelineState) {
    phase = pipelineState.phase;
  } else if (apply?.batch) {
    const derivedPhase = derivePhaseFromBatchStatus(apply.batch.status);
    if (derivedPhase === "applying") {
      // No in-memory pipeline but batch looks active — the server restarted
      // while apply was running. Mark as failed so the UI shows the re-run
      // button instead of spinning forever.
      phase = "failed";
      staleBatchDetected = true;
    } else {
      phase = derivedPhase;
    }
  } else {
    phase = derivePhaseFromSnapshotStatus(progress.status, !!apply);
  }

  const applySummary = apply?.batch
    ? {
        status: apply.batch.status,
        counts: apply.batch.counts,
        byTarget: apply.byTarget,
      }
    : apply
      ? {
          status: "pending",
          counts: apply.summary,
          byTarget: apply.byTarget,
        }
      : null;

  // Activity import result: prefer live in-memory state for the active run;
  // fall back to the persisted DB summary so the field survives server restarts.
  const activityImport: PipelineRun["activityImport"] =
    pipelineState?.activityImport ??
    (workspace.runSummary?.activityImport as PipelineRun["activityImport"] | undefined) ??
    undefined;

  return {
    runId: progress.runId,
    status: progress.status,
    phase,
    pipelineError: pipelineState?.phase === "failed"
      ? pipelineState.error
      : staleBatchDetected
        ? "Apply was interrupted (server restarted mid-run). Click 'Run import again' to resume."
        : null,
    snapshot: {
      completedCheckpoints: progress.completedCheckpoints,
      totalCheckpoints: progress.totalCheckpoints,
      stagedRecords: progress.stagedRecords,
      failedCheckpoints: progress.failedCheckpoints,
      streams,
      interruption: progress.interruption,
    },
    preview: preview
      ? {
          total: preview.total,
          entityCounts: preview.entityCounts,
        }
      : null,
    apply: applySummary,
    activityImport: activityImport ?? null,
  };
}

/**
 * Derive phase from the apply batch status stored in the DB.
 * This is accurate regardless of server restarts.
 */
function derivePhaseFromBatchStatus(batchStatus: string): PipelinePhase {
  switch (batchStatus) {
    case "applied":           return "applied";
    case "partially_applied": return "partially_applied";
    case "failed":            return "failed";
    case "applying":
    case "pending":
    default:                  return "applying";
  }
}

/**
 * Fallback: derive phase from the snapshot run status when no apply batch exists.
 * - "previewed" with no batch → pipeline stopped at preview (apply disabled or not started)
 * - "previewed" with apply workspace but no batch → apply was started but batch not found
 */
function derivePhaseFromSnapshotStatus(status: string, hasApplyWorkspace: boolean): PipelinePhase {
  switch (status) {
    case "snapshotting":
      return "snapshotting";
    case "snapshot_complete":
    case "matching":
      return "previewing";
    case "previewed":
      // No apply batch found: either apply is disabled or the run is from
      // before apply was enabled. Show as apply_gated (conservative/honest).
      return hasApplyWorkspace ? "applying" : "apply_gated";
    case "applying":
      return "applying";
    case "partially_applied":
      return "partially_applied";
    case "applied":
      return "applied";
    case "failed":
      return "failed";
    default:
      return "snapshotting";
  }
}

// ─── Route scan ──────────────────────────────────────────────────────────────

const SCAN_CAP_PER_STREAM = 500;

/**
 * POST /api/migration/act/scan-routes
 * Read-only scan: fetches activities, notes, and history from Act! and
 * matches them against known organization names in the local DB.
 * No data is written to the database.
 */
router.post("/migration/act/scan-routes", async (req, res): Promise<void> => {
  try {
    const body = req.body ?? {};
    const credentialOverride =
      body.baseUrl && body.databaseName && body.username && body.password
        ? {
            baseUrl: body.baseUrl as string,
            databaseName: body.databaseName as string,
            username: body.username as string,
            password: body.password as string,
          }
        : undefined;

    // ── Date range ──────────────────────────────────────────────────────────
    // Default: last 12 months. The frontend always sends ISO date strings.
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

    const fromDate: Date = body.fromDate ? new Date(body.fromDate as string) : defaultFrom;
    const toDate: Date = body.toDate ? new Date(body.toDate as string) : now;

    // Clamp toDate to end-of-day so a "today" date includes today's records.
    toDate.setHours(23, 59, 59, 999);

    const fromIso = fromDate.toISOString();
    const toIso   = toDate.toISOString();

    // OData $filter expressions — activities use scheduleDate, notes/history use createDate.
    const activityFilter = `scheduleDate ge ${fromIso} and scheduleDate le ${toIso}`;
    const dateFilter     = `createDate ge ${fromIso} and createDate le ${toIso}`;

    const [
      { ActApiError },
      { ActClient },
      { HttpActMigrationSourceClient },
      { parseRawItem },
      { matchItemsToRoutes },
    ] = await Promise.all([
      import("@/features/act-sync/act-errors"),
      import("@/features/act-sync/act-client"),
      import("@/features/act-migration/source-client"),
      import("@/features/act-migration/act-activity-parser"),
      import("@/features/act-migration/act-route-matcher"),
    ]);

    let config: {
      baseUrl: "https://apius.act.com/act.web.api";
      databaseName: string;
      username: string;
      password: string;
    };

    if (credentialOverride) {
      const env = parseActEnvironment(process.env);
      if (!env.configured) throw new ActApiError("not_configured", false);
      config = env.config;
    } else {
      const env = parseActEnvironment(process.env);
      if (!env.configured) throw new ActApiError("not_configured", false);
      config = env.config;
    }

    const sourceClient = new HttpActMigrationSourceClient(
      new ActClient(config),
    );

    // Page through all three streams up to SCAN_CAP_PER_STREAM items each
    type StreamName = "activity" | "note" | "history";
    type PageRequest = Parameters<typeof sourceClient.listActivities>[0];
    const streams: {
      name: StreamName;
      filter: string;
      list: (req: PageRequest) => ReturnType<typeof sourceClient.listActivities>;
    }[] = [
      { name: "activity", filter: activityFilter, list: (r) => sourceClient.listActivities(r) },
      { name: "note",     filter: dateFilter,     list: (r) => sourceClient.listNotes(r) },
      { name: "history",  filter: dateFilter,     list: (r) => sourceClient.listHistory(r) },
    ];

    const PAGE_SIZE = 100;
    const allParsed = [];

    for (const stream of streams) {
      let skip = 0;
      let fetched = 0;
      // Start in projected mode; the source client may return queryMode: "plain"
      // as a one-time signal that the endpoint requires unprojected queries.
      let queryMode: "projected" | "plain" = "projected";

      while (fetched < SCAN_CAP_PER_STREAM) {
        const top = Math.min(PAGE_SIZE, SCAN_CAP_PER_STREAM - fetched);
        const page = await stream.list({ skip, top, queryMode, filter: stream.filter });

        // Projected-to-plain fallback: the source client returns queryMode "plain"
        // (with nextSkip still at the current skip and items=[]) to signal the
        // caller must retry in plain/unprojected mode. Switch and loop again.
        if (page.queryMode !== queryMode) {
          queryMode = page.queryMode as "projected" | "plain";
          // nextSkip is preserved (still 0); skip stays the same
          continue;
        }

        for (const raw of page.items) {
          const parsed = parseRawItem(stream.name, raw);
          if (parsed) allParsed.push(parsed);
        }
        fetched += page.items.length;

        // nextSkip is null when there are no more pages
        if (page.nextSkip === null) break;
        skip = page.nextSkip;
      }
    }

    // Load organization names from the local DB
    const { db } = await import("@/db/client");
    const { organizations } = await import("@/db/schema");
    const orgRows = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations);
    const routeNames = orgRows
      .map((r) => r.name)
      .filter((name) => name && name.trim().length > 0);

    // Match items to routes
    const result = matchItemsToRoutes(allParsed, routeNames);

    res.json({
      ok: true,
      totalScanned: allParsed.length,
      routeCount: routeNames.length,
      matched: result.matched,
      unmatched: result.unmatched,
      fromDate: fromIso,
      toDate: toIso,
    });
  } catch (err: unknown) {
    req.log?.error({ err }, "Route scan failed");
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "not_configured"
    ) {
      res.status(400).json({ ok: false, error: "Act! credentials not configured" });
      return;
    }
    const msg = err instanceof Error ? err.message : "Scan failed";
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * POST /api/migration/act/import-history
 *
 * Re-runs just the activity-import phase (notes, history, activities) for the
 * most recently completed migration run, without repeating the full entity
 * migration.  Requires the latest run to be in the "applied" state; returns
 * 409 otherwise.
 *
 * Use this to recover "not yet linked" history entries after:
 * - A partially-applied run that is now fully applied on a second attempt
 * - Manual investigation / review that resolved previously unlinked contacts
 *
 * Because every imported row carries a unique actRecordId, re-running is safe:
 * duplicate entries are suppressed by the partial unique index.
 */
router.post(
  "/migration/act/import-history",
  async (req, res): Promise<void> => {
    try {
      // ── Resolve the latest run and verify it is fully applied ──────────────
      const reader = await createActMigrationWorkspaceReader();
      const env = parseActEnvironment(process.env);
      if (!env.configured) {
        res.status(400).json({ ok: false, error: "Act! credentials not configured" });
        return;
      }

      const workspace = await reader.getWorkspace({
        runId: latestRunId ?? undefined,
        query: { page: 1, pageSize: 1 },
      });
      if (!workspace) {
        res.status(404).json({ ok: false, error: "No migration run found" });
        return;
      }

      const runId = workspace.progress.runId;

      // Derive the phase the same way the status endpoint does
      const pipelineState = latestRunId ? activeRuns.get(latestRunId) : undefined;
      const formatted = formatRunStatus(workspace, pipelineState);
      if (formatted.phase !== "applied") {
        res.status(409).json({
          ok: false,
          error: `History import requires a fully-applied run (current phase: ${formatted.phase})`,
        });
        return;
      }

      // ── Build source client and run importer ───────────────────────────────
      const [
        { ActClient },
        { HttpActMigrationSourceClient },
        { ActMigrationActivityImportService },
        { db: importDb },
      ] = await Promise.all([
        import("@/features/act-sync/act-client"),
        import("@/features/act-migration/source-client"),
        import("@/features/act-migration/activity-import-service"),
        import("@/db/client"),
      ]);

      const sourceClient = new HttpActMigrationSourceClient(
        new ActClient(env.config),
      );
      const importer = new ActMigrationActivityImportService(sourceClient, importDb);
      const result = await importer.importAll();

      // ── Persist and surface in status responses ────────────────────────────
      await persistActivityImportSummary(runId, result);
      if (pipelineState) pipelineState.activityImport = result;

      res.json({ ok: true, result });
    } catch (err: unknown) {
      req.log?.error({ err }, "History import failed");
      const msg = err instanceof Error ? err.message : "History import failed";
      res.status(500).json({ ok: false, error: msg });
    }
  },
);

export default router;
