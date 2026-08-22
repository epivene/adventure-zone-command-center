import { randomUUID } from "node:crypto";

import app from "./app";
import { logger } from "./lib/logger";
import { runStartupStep } from "./lib/startup-step";
import { validateOwnerConfig } from "./lib/auth";
import { db } from "@workspace/db";
import { runActReviewMigrationsAtStartup } from "./db/act-review-startup";
import { ensurePaperNotesSchemaBeforeListen } from "./db/paper-notes-required-startup";
import { ensureOfficeCoordinatorSchemaBeforeListen } from "./db/office-coordinator-required-startup";
import { ensureGoogleWorkspaceSchemaBeforeListen } from "./db/google-workspace-required-startup";
import { recoverStaleDatabaseLockConvoys } from "./db/stale-lock-recovery";
import { autoConsolidateImportedLocationFamilies } from "./features/organizations/imported-location-family-consolidation";
import { ensureEventFamilySchema } from "./features/event-families/event-family-repository";
import { ensureBookingProbabilitySchema } from "./features/bookings/booking-probability-schema";
import { ensureActivityDeleteSchema } from "./features/activities/activity-delete-schema";
import { ensurePackageIntelligenceSchema } from "./features/packages/package-intelligence-schema";
import { ensureBookingAssistantSchema } from "./features/assistant/assistant-schema";
import { ensureCallScriptSettingsSchema } from "./features/calls/call-script-settings";
import { LeadScoutWorker } from "./features/assistant/lead-scout-worker";
import {
  LeadScoutWorkerLoop,
  systemLeadScoutWorkerLoopScheduler,
} from "./features/assistant/lead-scout-worker-loop";
import { AssistantJobWorker } from "./features/assistant/assistant-job-worker";
import {
  AssistantJobWorkerLoop,
  systemAssistantJobWorkerLoopScheduler,
} from "./features/assistant/assistant-job-worker-loop";
import { ensureCrewWorkerLegMembershipSchema } from "./features/leg-manager/crew-worker-membership-schema";
import { ensureEventLegLifecycleSchema } from "./features/leg-manager/event-lifecycle-schema";
import { PostgresBusinessKnowledgeRepository } from "./features/assistant/business-knowledge-repository";
import { ensureManagerAssistantSchema } from "./features/manager-assistant/manager-assistant-schema";
import { PaperNoteExtractionRepository } from "./features/paper-notes/paper-note-extraction-repository";
import { createPaperNoteExtractionWorker } from "./features/paper-notes/paper-note-extraction-worker";
import { createPaperNoteObjectStorage } from "./features/paper-notes/paper-note-object-storage";
import {
  PaperNoteWorkerLoop,
  systemPaperNoteWorkerLoopScheduler,
} from "./features/paper-notes/paper-note-worker-loop";
import {
  createActExtractionRuntime,
  createActServerShutdown,
  shouldStartActBackgroundWorkers,
  type ActExtractionRuntime,
} from "./features/act-replacement/runtime";

validateOwnerConfig();

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const leadScoutLoop = new LeadScoutWorkerLoop({
  worker: new LeadScoutWorker(),
  workerId: `lead-scout-${randomUUID()}`,
  clock: { now: () => new Date() },
  scheduler: systemLeadScoutWorkerLoopScheduler,
});

const assistantJobLoop = new AssistantJobWorkerLoop({
  worker: new AssistantJobWorker(),
  workerId: `assistant-job-${randomUUID()}`,
  clock: { now: () => new Date() },
  scheduler: systemAssistantJobWorkerLoopScheduler,
});

const paperNoteStorage = createPaperNoteObjectStorage();
const paperNoteLoop = new PaperNoteWorkerLoop({
  worker: createPaperNoteExtractionWorker({
    repository: new PaperNoteExtractionRepository(db),
    storage: paperNoteStorage,
  }),
  workerId: `paper-notes-${randomUUID()}`,
  clock: { now: () => new Date() },
  scheduler: systemPaperNoteWorkerLoopScheduler,
});

let extractionRuntime: ActExtractionRuntime | null = null;
let extractionRuntimePromise: Promise<ActExtractionRuntime> | null = null;
let shutdownRequested = false;

await runStartupStep(
  "required paper notes schema",
  ensurePaperNotesSchemaBeforeListen,
);
await runStartupStep(
  "required office coordinator schema",
  ensureOfficeCoordinatorSchemaBeforeListen,
);
await runStartupStep(
  "required Google Workspace schema",
  ensureGoogleWorkspaceSchemaBeforeListen,
);

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
  void runPostListenMaintenance()
    .then(() => startBackgroundWorkers())
    .catch((err) => {
      logger.error(
        { err },
        "Post-listen database maintenance failed; server remains available",
      );
    });
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exitCode = 1;
});

const shutdown = createActServerShutdown({
  async closeRuntime() {
    const runtime =
      extractionRuntime ?? (await extractionRuntimePromise?.catch(() => null));
    await Promise.all([
      runtime?.close(),
      leadScoutLoop.close(),
      assistantJobLoop.close(),
      paperNoteLoop.close(),
    ]);
  },
  closeServer() {
    return new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  },
  async closePool() {
    const { pool } = await import("./db/client");
    await pool.end();
  },
  onError(stage) {
    logger.error({ stage }, "Server shutdown phase failed");
  },
});

process.once("SIGTERM", () => {
  shutdownRequested = true;
  void shutdown();
});

async function runPostListenMaintenance() {
  const staleLockRecovery = await runStartupStep(
    "stale database lock recovery",
    recoverStaleDatabaseLockConvoys,
  );
  if (staleLockRecovery.terminated.length > 0) {
    logger.warn(
      {
        terminatedBlockers: staleLockRecovery.terminated,
        recoveryPasses: staleLockRecovery.passes,
      },
      "Terminated stale database sessions that were blocking the CRM",
    );
  }

  await runStartupStep("booking probability schema", ensureBookingProbabilitySchema);
  await runStartupStep("package intelligence schema", ensurePackageIntelligenceSchema);
  const assistantSchemaApplied = await runStartupStep(
    "booking assistant schema",
    ensureBookingAssistantSchema,
  );
  const managerAssistantSchemaApplied = await runStartupStep(
    "manager assistant schema",
    ensureManagerAssistantSchema,
  );
  await runStartupStep("call script settings schema", () => ensureCallScriptSettingsSchema(db));
  const appliedMigrations = await runStartupStep(
    "act review migrations",
    () => runActReviewMigrationsAtStartup({
      onLockUnavailable: () => {
        logger.warn(
          { startupStep: "act review migrations" },
          "Act review migrations are already running elsewhere; startup will continue",
        );
      },
      onLockTimeout: () => {
        logger.warn(
          { startupStep: "act review migrations", errorCode: "55P03" },
          "Act review migrations deferred due to database lock; startup will continue",
        );
      },
    }),
  );
  if (assistantSchemaApplied) appliedMigrations.push("045_booking_assistant.sql");
  if (managerAssistantSchemaApplied) appliedMigrations.push("046_manager_assistant_questions.sql");
  await runStartupStep("event family schema", ensureEventFamilySchema);
  await runStartupStep("activity delete schema", ensureActivityDeleteSchema);
  await runStartupStep("crew worker leg membership schema", ensureCrewWorkerLegMembershipSchema);
  await runStartupStep("event leg lifecycle schema", ensureEventLegLifecycleSchema);
  await runStartupStep("booking assistant business knowledge seed", () =>
    new PostgresBusinessKnowledgeRepository().upsertInitialSeed(
      "system:booking-assistant-seed",
    ),
  );
  logger.info(
    {
      appliedMigrations,
      releaseCommit: process.env["RENDER_GIT_COMMIT"] ?? "local",
    },
    appliedMigrations.length > 0
      ? "Database migrations applied"
      : "Database schema is current",
  );

  const importedLocationFamilies = await runStartupStep(
    "imported location family consolidation",
    () => autoConsolidateImportedLocationFamilies(db, new Date()),
  );
  logger.info(
    importedLocationFamilies,
    importedLocationFamilies.families > 0
      ? "Imported organization profiles consolidated into locations"
      : "No imported location families need consolidation",
  );
}

async function startBackgroundWorkers() {
  if (shutdownRequested) return;
  leadScoutLoop.start();
  assistantJobLoop.start();
  paperNoteLoop.start();

  const liveActBackgroundWorkersEnabled = shouldStartActBackgroundWorkers();

  try {
    extractionRuntimePromise = liveActBackgroundWorkersEnabled
      ? createActExtractionRuntime()
      : createActExtractionRuntime({
          getEnvironment: () => ({ configured: false }),
        });
    const runtime = await extractionRuntimePromise;
    extractionRuntime = runtime;
    if (!shutdownRequested) runtime.start();

    if (!liveActBackgroundWorkersEnabled) {
      logger.info(
        "ACT live background extraction workers are disabled; archive recovery remains active",
      );
    }
  } catch (err) {
    logger.error(
      {
        errorCode:
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : "unknown",
      },
      "Act archive recovery/background runtime could not be started",
    );
  }
}
