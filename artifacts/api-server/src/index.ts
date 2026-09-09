import { randomUUID } from "node:crypto";

import app from "./app";
import { logger } from "./lib/logger";
import { runStartupStep } from "./lib/startup-step";
import { exitAfterRequiredStartupFailure } from "./lib/required-startup-shutdown";
import { validateOwnerConfig } from "./lib/auth";
import { db, pool } from "@workspace/db";
import { runActReviewMigrationsAtStartup } from "./db/act-review-startup";
import { runRequiredSchemaStartup } from "./db/required-schema-startup";
import { recoverStaleDatabaseLockConvoys } from "./db/stale-lock-recovery";
import { autoConsolidateImportedLocationFamilies } from "./features/organizations/imported-location-family-consolidation";
import { cleanupKnownEmptyTestProfileClusters } from "./features/organizations/known-empty-test-profile-cluster-cleanup";
import {
  cleanupKnownEmptyTestProfiles,
  enrichKnownBlankProfiles,
} from "./features/organizations/known-empty-test-profile-cleanup";
import { applyWyo131DuplicateCleanup } from "./features/organizations/wyo131-duplicate-cleanup";
import { PostgresWyo131DuplicateRepository } from "./features/organizations/wyo131-duplicate-postgres";
import { ensureEventFamilySchema } from "./features/event-families/event-family-repository";
import { ensureBookingProbabilitySchema } from "./features/bookings/booking-probability-schema";
import { ensureActivityDeleteSchema } from "./features/activities/activity-delete-schema";
import { ensurePackageIntelligenceSchema } from "./features/packages/package-intelligence-schema";
import { ensureBookingAssistantSchema } from "./features/assistant/assistant-schema";
import { ensureCallScriptSettingsSchema } from "./features/calls/call-script-settings";
import { ensureBusinessSourceSeed } from "./features/business-sources/business-source-seed";
import { ensureCommercialOfferSeed } from "./features/commercial-offers/commercial-offer-seed";
import { ensureEarlyBirdPromoOffer } from "./features/early-bird-promo/early-bird-promo-offer-seed";
import { EarlyBirdPromoRepository } from "./features/early-bird-promo/early-bird-promo-repository";
import { EarlyBirdPromoWorker } from "./features/early-bird-promo/early-bird-promo-worker";
import {
  EarlyBirdPromoWorkerLoop,
  systemEarlyBirdPromoWorkerLoopScheduler,
} from "./features/early-bird-promo/early-bird-promo-worker-loop";
import { ensureEventChecklistTemplates } from "./features/leg-manager/event-checklist-seed";
import { importApprovedProfilesAtStartup } from "./features/approved-profile-import/startup-import";
import { APPROVED_PROFILE_STARTUP_TIMEOUT_MS } from "./features/approved-profile-import/startup-config";
import { runMaintenanceAndStartWorkers } from "./features/approved-profile-import/post-listen-startup";
import { LeadScoutWorker } from "./features/assistant/lead-scout-worker";
import {
  LeadScoutWorkerLoop,
  systemLeadScoutWorkerLoopScheduler,
} from "./features/assistant/lead-scout-worker-loop";
import { ScoutAlertWorker } from "./features/assistant/scout-alert-worker";
import {
  ScoutAlertWorkerLoop,
  systemScoutAlertWorkerLoopScheduler,
} from "./features/assistant/scout-alert-worker-loop";
import { AssistantJobWorker } from "./features/assistant/assistant-job-worker";
import {
  AssistantJobWorkerLoop,
  systemAssistantJobWorkerLoopScheduler,
} from "./features/assistant/assistant-job-worker-loop";
import { ensureCrewWorkerLegMembershipSchema } from "./features/leg-manager/crew-worker-membership-schema";
import { ensureEventLegLifecycleSchema } from "./features/leg-manager/event-lifecycle-schema";
import { PostgresBusinessKnowledgeRepository } from "./features/assistant/business-knowledge-repository";
import { ensureManagerAssistantSchema } from "./features/manager-assistant/manager-assistant-schema";
import { ensureDevelopmentSampleAccounts } from "./features/development/development-sample-accounts";
import { PaperNoteExtractionRepository } from "./features/paper-notes/paper-note-extraction-repository";
import { createPaperNoteExtractionWorker } from "./features/paper-notes/paper-note-extraction-worker";
import { createPaperNoteObjectStorage } from "./features/paper-notes/paper-note-object-storage";
import {
  PaperNoteWorkerLoop,
  systemPaperNoteWorkerLoopScheduler,
} from "./features/paper-notes/paper-note-worker-loop";
import { createOpportunityEmailWorkerLoop } from "./features/opportunity-email/opportunity-email-worker-runtime";
import { readInboundCallingConfig } from "./features/calls/inbound-calling-config";
import { TwilioComputerVoiceProvider } from "./features/calls/twilio-computer-voice-provider";
import { readComputerCallingConfig } from "./features/calls/computer-calling-config";
import { VoicemailRetentionWorker } from "./features/calls/voicemail-retention-worker";
import { VoicemailRetentionWorkerLoop } from "./features/calls/voicemail-retention-worker-loop";
import { GoogleSentProfileLinkSweepService } from "./features/google-workspace/google-sent-profile-link-sweep-service";
import { GoogleRecentValidationService } from "./features/google-workspace/google-recent-validation-service";
import {
  GoogleSentProfileLinkSweepLoop,
  systemGoogleSentProfileLinkSweepLoopScheduler,
} from "./features/google-workspace/google-sent-profile-link-sweep-loop";
import {
  GoogleHistoricalBackfillLoop,
  systemGoogleHistoricalBackfillLoopScheduler,
} from "./features/google-workspace/google-historical-backfill-loop";
import { GoogleHistoricalBackfillService } from "./features/google-workspace/google-historical-backfill-service";
import { GoogleHistoricalBackfillRepository } from "./features/google-workspace/google-historical-backfill-repository";
import { GoogleHistoricalRunLease } from "./features/google-workspace/google-historical-run-lease";
import { PostgresGoogleValidationRepository } from "./features/google-workspace/google-validation-repository";
import {
  createActExtractionRuntime,
  createActServerShutdown,
  shouldStartActBackgroundWorkers,
  type ActExtractionRuntime,
} from "./features/act-replacement/runtime";
import { DrizzleWebsiteInquiryRepository } from "./features/website-inquiries/website-inquiry-repository";
import { WebsiteInquiryAlertWorker } from "./features/website-inquiries/website-inquiry-alert-worker";
import { createGoogleWorkspaceMailDelivery } from "./features/website-inquiries/google-workspace-mail-delivery";
import { PostgresGoogleConnectionRepository } from "./features/google-workspace/google-connection-repository";
import {
  WebsiteInquiryAlertWorkerLoop,
  systemWebsiteInquiryAlertWorkerLoopScheduler,
} from "./features/website-inquiries/website-inquiry-alert-worker-loop";
import { markAppReady, markAppStarting } from "./lib/startup-readiness";
import { MarketingService } from "./features/marketing/marketing-service";
import { MarketingCampaignWorkerLoop } from "./features/marketing/marketing-campaign-worker-loop";
import { BusinessDocumentIngestion } from "./features/business-documents/business-document-ingestion";
import { GoogleGmailDocumentSource, PostgresExistingGoogleProfileFileLookup } from "./features/business-documents/google-gmail-document-source";
import { GoogleDocumentWorker, PostgresGoogleDocumentWorkerState } from "./features/business-documents/google-document-worker";
import { GoogleDocumentWorkerLoop, systemGoogleDocumentWorkerLoopScheduler } from "./features/business-documents/google-document-worker-loop";
import { BusinessDocumentStorage } from "./features/business-documents/business-document-storage";
import { GoogleDriveBackupBackfillService } from "./features/google-drive-backup/google-drive-backup-backfill-service";
import { readGoogleDriveBackupRuntimeConfig } from "./features/google-drive-backup/google-drive-backup-config";
import { GoogleDriveBackupDocumentRepository } from "./features/google-drive-backup/google-drive-backup-document-repository";
import { PostgresGoogleDriveBackupRepository, type GoogleDriveBackupSqlPool } from "./features/google-drive-backup/google-drive-backup-repository";
import { GoogleDriveBackupSnapshotRepository, GoogleWorkspaceProfileEmailProvider } from "./features/google-drive-backup/google-drive-backup-snapshot-repository";
import { GoogleDriveBackupWorker } from "./features/google-drive-backup/google-drive-backup-worker";
import { GoogleDriveBackupWorkerLoop } from "./features/google-drive-backup/google-drive-backup-worker-loop";
import { getGoogleWorkspaceEnvironment } from "./features/google-workspace/google-workspace-env";

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

const scoutAlertLoop = new ScoutAlertWorkerLoop({
  worker: new ScoutAlertWorker(),
  workerId: `scout-alert-${randomUUID()}`,
  clock: { now: () => new Date() },
  scheduler: systemScoutAlertWorkerLoopScheduler,
});

const websiteInquiryAlertLoop = new WebsiteInquiryAlertWorkerLoop({
  worker: new WebsiteInquiryAlertWorker({
    repository: new DrizzleWebsiteInquiryRepository(db),
    createMailDelivery: () => createGoogleWorkspaceMailDelivery(
      new PostgresGoogleConnectionRepository(),
    ),
  }),
  workerId: `website-inquiry-alert-${randomUUID()}`,
  clock: { now: () => new Date() },
  scheduler: systemWebsiteInquiryAlertWorkerLoopScheduler,
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

const gmailProfileLinkSweepLoop = new GoogleSentProfileLinkSweepLoop({
  recent: new GoogleRecentValidationService(),
  sentSweep: new GoogleSentProfileLinkSweepService(),
  clock: { now: () => new Date() },
  scheduler: systemGoogleSentProfileLinkSweepLoopScheduler,
});

const historicalGmailBackfillLoop = new GoogleHistoricalBackfillLoop({
  enabled:
    process.env.GOOGLE_WORKSPACE_SYNC_ENABLED?.trim().toLowerCase() === "true",
  validation: new PostgresGoogleValidationRepository(),
  repository: new GoogleHistoricalBackfillRepository(),
  service: new GoogleHistoricalBackfillService(),
  lease: new GoogleHistoricalRunLease(),
  scheduler: systemGoogleHistoricalBackfillLoopScheduler,
});

const googleConnectionRepository = new PostgresGoogleConnectionRepository();
const googleDocumentLoop = new GoogleDocumentWorkerLoop({
  worker: new GoogleDocumentWorker({
    connection: googleConnectionRepository,
    sourceFactory: (client) => new GoogleGmailDocumentSource(client, new PostgresExistingGoogleProfileFileLookup()),
    ingestion: new BusinessDocumentIngestion(),
    state: new PostgresGoogleDocumentWorkerState(),
    accountKey: "workspace",
  }),
  clock: { now: () => new Date() },
  scheduler: systemGoogleDocumentWorkerLoopScheduler,
});

const googleDriveBackupRuntimeConfig = readGoogleDriveBackupRuntimeConfig(process.env);
let googleDriveBackupLoop: GoogleDriveBackupWorkerLoop | null = null;
if (googleDriveBackupRuntimeConfig.enabled) {
  const environment = getGoogleWorkspaceEnvironment();
  if (!environment.configured) throw new Error("GOOGLE_WORKSPACE_NOT_CONFIGURED");
  const sqlPool = pool as unknown as GoogleDriveBackupSqlPool;
  const backupRepository = new PostgresGoogleDriveBackupRepository(
    sqlPool,
    googleDriveBackupRuntimeConfig.maxAutomaticAttempts,
  );
  const backupBackfill = new GoogleDriveBackupBackfillService(sqlPool);
  const emailProvider = new GoogleWorkspaceProfileEmailProvider({
    pool: sqlPool,
    connections: googleConnectionRepository,
    appOrigin: environment.value.appOrigin,
  });
  googleDriveBackupLoop = new GoogleDriveBackupWorkerLoop({
    worker: new GoogleDriveBackupWorker({
      workerId: `google-drive-backup-${randomUUID()}`,
      repository: backupRepository,
      snapshots: new GoogleDriveBackupSnapshotRepository({
        pool: sqlPool,
        appOrigin: environment.value.appOrigin,
        emailProvider,
      }),
      documents: new GoogleDriveBackupDocumentRepository(sqlPool),
      storage: new BusinessDocumentStorage(),
      connections: googleConnectionRepository,
      backfill: backupBackfill,
    }),
    idlePollMs: googleDriveBackupRuntimeConfig.idlePollMs,
    onResult: (result) => {
      if (result !== "idle") logger.info({ result }, "Google Drive backup pass completed");
    },
    onError: (err) => logger.error({ err }, "Google Drive backup worker pass failed"),
  });
}

const earlyBirdPromoLoop = new EarlyBirdPromoWorkerLoop({
  worker: new EarlyBirdPromoWorker(new EarlyBirdPromoRepository(db)),
  workerId: `early-bird-promo-${randomUUID()}`,
  clock: { now: () => new Date() },
  scheduler: systemEarlyBirdPromoWorkerLoopScheduler,
});

let extractionRuntime: ActExtractionRuntime | null = null;
let extractionRuntimePromise: Promise<ActExtractionRuntime> | null = null;
let opportunityEmailLoop:
  Awaited<ReturnType<typeof createOpportunityEmailWorkerLoop>> | null = null;
let shutdownRequested = false;
const voicemailRetentionLoop = new VoicemailRetentionWorkerLoop(
  new VoicemailRetentionWorker(db, () => {
    const config = readInboundCallingConfig(process.env);
    if (!config.enabled) throw new Error("Inbound provider unavailable");
    return new TwilioComputerVoiceProvider(config.config.voiceConfig);
  }),
  () => readInboundCallingConfig(process.env).enabled,
  (err) => logger.error({ err }, "Inbound voicemail retention pass failed"),
);
const marketingCampaignLoop = new MarketingCampaignWorkerLoop(
  new MarketingService(db),
  (err) => logger.error({ err }, "Marketing scheduled-send pass failed"),
);

markAppStarting();
const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
  void completeRequiredStartup();
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
      opportunityEmailLoop?.close(),
      leadScoutLoop.close(),
      scoutAlertLoop.close(),
      websiteInquiryAlertLoop.close(),
      assistantJobLoop.close(),
      paperNoteLoop.close(),
      gmailProfileLinkSweepLoop.close(),
      historicalGmailBackfillLoop.close(),
      googleDocumentLoop.close(),
      googleDriveBackupLoop?.close(),
      voicemailRetentionLoop.close(),
      marketingCampaignLoop.close(),
      earlyBirdPromoLoop.close(),
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

async function completeRequiredStartup(): Promise<void> {
  try {
    await runRequiredSchemaStartup();
    await runStartupStep(
      "development sample account seed",
      ensureDevelopmentSampleAccounts,
    );
  } catch (err) {
    logger.fatal(
      { err },
      "Required startup checks failed; shutting down without serving API traffic",
    );
    shutdownRequested = true;
    await exitAfterRequiredStartupFailure({
      shutdown,
      exit: (code) => process.exit(code),
    });
  }

  if (shutdownRequested) return;
  await runMaintenanceAndStartWorkers({
    runMaintenance: runPostListenMaintenance,
    startBackgroundWorkers,
    onMaintenanceError(err) {
      logger.error(
        { err },
        "Post-listen database maintenance failed; server remains available",
      );
    },
    onReady() {
      if (shutdownRequested) return;
      markAppReady();
      logger.info(
        "Required database startup settled; API traffic enabled",
      );
    },
  }).catch((err) => {
    logger.error(
      { err },
      "Background worker startup failed; server remains available",
    );
  });
}

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
  try {
    const clusterCleanup = await runStartupStep(
      "known empty test profile cluster cleanup",
      cleanupKnownEmptyTestProfileClusters,
    );
    logger.info(
      clusterCleanup,
      clusterCleanup.deleted.length > 0
        ? "Removed known empty consolidated test profile clusters"
        : "No known empty consolidated test profile clusters were eligible for removal",
    );
  } catch (err) {
    logger.error(
      { err },
      "Known empty test profile cluster cleanup deferred; startup will continue",
    );
  }
  try {
    const cleanup = await runStartupStep(
      "known empty test profile cleanup",
      cleanupKnownEmptyTestProfiles,
    );
    logger.info(
      cleanup,
      cleanup.deleted.length > 0
        ? "Removed known empty test profiles"
        : "No known empty test profiles were eligible for removal",
    );
  } catch (err) {
    logger.error(
      { err },
      "Known empty test profile cleanup deferred; startup will continue",
    );
  }
  try {
    const enrichment = await runStartupStep(
      "known blank profile enrichment",
      enrichKnownBlankProfiles,
    );
    logger.info(
      enrichment,
      enrichment.updated.length > 0
        ? "Enriched verified blank organization profiles"
        : "Verified blank organization profiles are already current or safely skipped",
    );
  } catch (err) {
    logger.error(
      { err },
      "Known blank profile enrichment deferred; startup will continue",
    );
  }
  try {
    const wyo131Cleanup = await runStartupStep(
      "reviewed WYO131 duplicate cleanup",
      () => applyWyo131DuplicateCleanup(
        new PostgresWyo131DuplicateRepository(),
      ),
    );
    logger.info(
      wyo131Cleanup,
      wyo131Cleanup.outcome === "merged"
        ? "Merged the reviewed WYO131 duplicate profiles"
        : "Reviewed WYO131 duplicate profiles were already merged or safely skipped",
    );
  } catch (err) {
    logger.error(
      { err },
      "Reviewed WYO131 duplicate cleanup deferred; startup will continue",
    );
  }
  await runStartupStep(
    "approved profile startup import",
    () => importApprovedProfilesAtStartup(port),
    APPROVED_PROFILE_STARTUP_TIMEOUT_MS,
  );
  await runStartupStep("booking assistant business knowledge seed", () =>
    new PostgresBusinessKnowledgeRepository().upsertInitialSeed(
      "system:booking-assistant-seed",
    ),
  );
  try {
    await runStartupStep("reviewed business source seed", () =>
      ensureBusinessSourceSeed(db),
    );
  } catch (err) {
    logger.error(
      { err },
      "Reviewed business source seed deferred; owner source settings can retry it later",
    );
  }
  try {
    await runStartupStep("proposed commercial offer seed", () =>
      ensureCommercialOfferSeed(db),
    );
  } catch (err) {
    logger.error(
      { err },
      "Commercial offer review seed deferred; owner offer settings can retry it later",
    );
  }
  try {
    await runStartupStep("approved Early Bird Promo offer seed", () =>
      ensureEarlyBirdPromoOffer(db),
    );
  } catch (err) {
    logger.error(
      { err },
      "Early Bird Promo offer seed deferred; startup will continue",
    );
  }
  try {
    await runStartupStep("event checklist template seed", () =>
      ensureEventChecklistTemplates(db),
    );
  } catch (err) {
    logger.error(
      { err },
      "Event checklist template seed deferred; lifecycle routes can retry it later",
    );
  }
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
  scoutAlertLoop.start();
  websiteInquiryAlertLoop.start();
  assistantJobLoop.start();
  paperNoteLoop.start();
  gmailProfileLinkSweepLoop.start();
  historicalGmailBackfillLoop.start();
  googleDocumentLoop.start();
  googleDriveBackupLoop?.start();
  voicemailRetentionLoop.start();
  marketingCampaignLoop.start();
  earlyBirdPromoLoop.start();

  try {
    opportunityEmailLoop = await createOpportunityEmailWorkerLoop();
    if (!shutdownRequested) {
      opportunityEmailLoop.start();
    } else {
      await opportunityEmailLoop.close();
      opportunityEmailLoop = null;
    }
  } catch (err) {
    opportunityEmailLoop = null;
    logger.error(
      {
        errorCode:
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : "unknown",
      },
      "Opportunity email scheduled-send worker could not be started",
    );
  }

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




