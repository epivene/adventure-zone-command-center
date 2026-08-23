import { randomUUID } from "node:crypto";

import type { ActPageRequest } from "@/features/act-migration/migration-types";
import { HttpActMigrationSourceClient } from "@/features/act-migration/source-client";
import type { ActClient } from "@/features/act-sync/act-client";
import type { ActReadTransport } from "./act-read-transport";
import { getActEnvironment } from "@/lib/env";
import type { ActReplacementStreamType } from "./import-types";
import type { ActExtractionSourceClient } from "./extraction-worker";
import type { AiCompletionClient } from "../ai-suggestions/ai-client";
import type { ArchiveProfileImportStore } from "./archive-profile-import-repository";
import type { ActConfig } from "@/features/act-sync/act-types";
import { logger } from "@/lib/logger";
import { ArchiveProfileImportWorker } from "./archive-profile-import-worker";
import {
  ActOrganizerWorkerLoop,
  systemWorkerLoopScheduler,
  type OrganizerLoopWorker,
  type WorkerLoopScheduler,
} from "./worker-loop";

export interface ActExtractionRuntime {
  start(): void;
  close(): Promise<void>;
}

type ExtractionLoop = ActExtractionRuntime;

export const actExtractionWorkerConcurrency = 1;

export function shouldStartActBackgroundWorkers(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.ACT_BACKGROUND_WORKERS_ENABLED?.trim().toLowerCase() === "true";
}

export function createActExtractionLoopPool(input: {
  concurrency: number;
  createLoop(index: number): ExtractionLoop;
}): ActExtractionRuntime {
  const loops = Array.from({ length: input.concurrency }, (_, index) =>
    input.createLoop(index),
  );
  return {
    start() {
      for (const loop of loops) loop.start();
    },
    async close() {
      await Promise.all(loops.map((loop) => loop.close()));
    },
  };
}

type ShutdownStage = "runtime" | "server" | "pool";

export function createActServerShutdown(input: {
  closeRuntime(): Promise<void>;
  closeServer(): Promise<void>;
  closePool(): Promise<void>;
  onError(stage: ShutdownStage): void;
}): () => Promise<void> {
  let shutdown: Promise<void> | null = null;
  return () => {
    shutdown ??= (async () => {
      for (const [stage, close] of [
        ["runtime", input.closeRuntime],
        ["server", input.closeServer],
        ["pool", input.closePool],
      ] as const) {
        try {
          await close();
        } catch {
          try {
            input.onError(stage);
          } catch {
          }
        }
      }
    })();
    return shutdown;
  };
}

export function createArchiveProfileImportLoop(input: {
  store: ArchiveProfileImportStore;
  createAiClient(): Promise<AiCompletionClient>;
  clock: { now(): Date };
  scheduler?: WorkerLoopScheduler;
}): ActExtractionRuntime {
  return new ActOrganizerWorkerLoop({
    worker: new ArchiveProfileImportWorker({
      store: input.store,
      createAiClient: input.createAiClient,
      clock: input.clock,
    }),
    workerId: `act-archive-profile-import-${process.pid}-${randomUUID()}`,
    clock: input.clock,
    scheduler: input.scheduler ?? systemWorkerLoopScheduler,
  });
}

export function createActArchiveRecoveryLoop(input: {
  worker: OrganizerLoopWorker;
  clock: { now(): Date };
  scheduler?: WorkerLoopScheduler;
}): ActExtractionRuntime {
  return new ActOrganizerWorkerLoop({
    worker: input.worker,
    workerId: `act-archive-recovery-${process.pid}-${randomUUID()}`,
    clock: input.clock,
    scheduler: input.scheduler ?? systemWorkerLoopScheduler,
  });
}

export function createActExtractionClientAdapter(
  client: Pick<
    ActClient,
    "authorize" | "getJsonAuthorized" | "hasValidAuthorization" | "rateLimit"
  >,
): {
  authorization: {
    isReady(now: Date): boolean;
    authorize(): Promise<void>;
  };
  source: ActExtractionSourceClient;
} {
  let authorizationInFlight: Promise<void> | null = null;
  const transport: ActReadTransport = {
    get rateLimit() {
      return client.rateLimit;
    },
    getJson: (input) => client.getJsonAuthorized(input),
  };
  const source = new HttpActMigrationSourceClient(transport);
  return {
    authorization: {
      isReady: (now) => client.hasValidAuthorization(now),
      authorize: () => {
        authorizationInFlight ??= client.authorize().finally(() => {
          authorizationInFlight = null;
        });
        return authorizationInFlight;
      },
    },
    source: {
      listRoot: (kind, request) => source.listRoot(kind, request),
      listContactNotes: (contactId, request) =>
        source.listNotesForContact(contactId, request),
      getDetail: (kind, id) => source.getDetail(kind, id),
      listRelationship: (input) =>
        listRelationship(
          source,
          input.streamType,
          input.parentId,
          input.request,
        ),
    },
  };
}

type ActRuntimeEnvironment =
  | { configured: false }
  | { configured: true; config: ActConfig };

export type ActExtractionRuntimeDependencies = {
  getEnvironment(): ActRuntimeEnvironment;
  createArchiveRuntime(): Promise<ActExtractionRuntime>;
  createConfiguredRuntime(config: ActConfig): Promise<ActExtractionRuntime>;
};

export async function createActExtractionRuntime(
  overrides: Partial<ActExtractionRuntimeDependencies> = {},
): Promise<ActExtractionRuntime> {
  const archiveRuntime = await (overrides.createArchiveRuntime ?? createProductionArchiveRuntime)();
  let environment: ActRuntimeEnvironment;
  try {
    environment = (overrides.getEnvironment ?? getActEnvironment)();
  } catch {
    logger.warn(
      { errorCode: "act_configuration_invalid" },
      "ACT extraction disabled; archived profile import remains active",
    );
    return archiveRuntime;
  }
  if (!environment.configured) return archiveRuntime;
  const configuredRuntime = await (
    overrides.createConfiguredRuntime ?? createProductionConfiguredRuntime
  )(environment.config);
  return combineRuntimes(configuredRuntime, archiveRuntime);
}

async function createProductionArchiveRuntime(): Promise<ActExtractionRuntime> {
  const [
    { db },
    { DrizzleArchiveProfileImportRepository },
    { createAiClient },
    { DrizzleActArchiveRecoveryRepository },
    { ActRecoverySourceLinkResolver },
    { ActEntityRecovery },
    { ActRelationshipRecovery },
    { ActTimelineRecovery },
    { ActArchiveRecoveryWorker },
  ] = await Promise.all([
    import("@/db/client"),
    import("./archive-profile-import-repository"),
    import("../ai-suggestions/ai-client"),
    import("../act-recovery/recovery-repository"),
    import("../act-recovery/source-link-resolver"),
    import("../act-recovery/entity-recovery"),
    import("../act-recovery/relationship-recovery"),
    import("../act-recovery/timeline-recovery"),
    import("../act-recovery/recovery-worker"),
  ]);
  const clock = { now: () => new Date() };
  const archiveProfileImportLoop = createArchiveProfileImportLoop({
    store: new DrizzleArchiveProfileImportRepository(db),
    createAiClient,
    clock,
  });
  const recoveryRepository = new DrizzleActArchiveRecoveryRepository(db);
  await recoveryRepository.createRunsForAllSources({
    requestKey: "act-note-profile-repair-v2",
    requestedBy: "system",
    now: clock.now(),
    streamTypes: ["note", "history", "activity"],
  });
  const resolver = new ActRecoverySourceLinkResolver(db);
  const archiveRecoveryLoop = createActArchiveRecoveryLoop({
    worker: new ActArchiveRecoveryWorker({
      repository: recoveryRepository,
      entityRecovery: new ActEntityRecovery(db, resolver),
      relationshipRecovery: new ActRelationshipRecovery(db, resolver),
      timelineRecovery: new ActTimelineRecovery(db, resolver),
    }),
    clock,
  });
  return {
    start() {
      archiveProfileImportLoop.start();
      archiveRecoveryLoop.start();
    },
    async close() {
      await Promise.all([archiveRecoveryLoop.close(), archiveProfileImportLoop.close()]);
    },
  };
}

async function createProductionConfiguredRuntime(
  config: ActConfig,
): Promise<ActExtractionRuntime> {
  const { db } = await import("@/db/client");
  const clock = { now: () => new Date() };

  const [
    { ActClient },
    { DrizzleActReplacementCheckpointRepository },
    { DrizzleActSourceArchiveRepository },
    { DrizzleActRequestAuditRepository },
    { ActExtractionWorker },
    { ActExtractionWorkerLoop },
    { ProductionActOrganizer, ProductionActOrganizerRecoveryWorker },
    { DrizzleActReviewCommandStore, DrizzleProductionOrganizerStore },
  ] = await Promise.all([
    import("@/features/act-sync/act-client"),
    import("./checkpoint-repository"),
    import("./archive-repository"),
    import("./request-audit-repository"),
    import("./extraction-worker"),
    import("./worker-loop"),
    import("./production-organizer"),
    import("./review-sql-adapter"),
  ]);

  const clientAdapter = createActExtractionClientAdapter(new ActClient(config));
  const worker = new ActExtractionWorker({
    checkpoints: new DrizzleActReplacementCheckpointRepository(db),
    audits: new DrizzleActRequestAuditRepository(db),
    source: clientAdapter.source,
    archive: new DrizzleActSourceArchiveRepository(db),
    authorization: clientAdapter.authorization,
    clock,
  });
  const extractionLoop = createActExtractionLoopPool({
    concurrency: actExtractionWorkerConcurrency,
    createLoop: (index) =>
      new ActExtractionWorkerLoop({
        worker,
        workerId: `act-extraction-${process.pid}-${index}-${randomUUID()}`,
        clock,
        scheduler: systemWorkerLoopScheduler,
      }),
  });
  const organizerStore = new DrizzleProductionOrganizerStore(db, {
    sourceDatabaseKey: config.databaseName,
  });
  const organizer = new ProductionActOrganizer(organizerStore);
  const organizerLoop = new ActOrganizerWorkerLoop({
    worker: new ProductionActOrganizerRecoveryWorker({
      findRecoverableRunId: (now) => organizerStore.findRecoverableRunId(now),
      organize: (runId) => organizer.organize(runId),
    }),
    workerId: `act-organizer-${process.pid}-${randomUUID()}`,
    clock,
    scheduler: systemWorkerLoopScheduler,
  });
  const automaticReviewStore = new DrizzleActReviewCommandStore(
    db,
    { sourceDatabaseKey: config.databaseName },
    {} as never,
  );
  await automaticReviewStore.releaseAbandonedAutomaticReviewClaims(clock.now());
  const automaticReviewLoop = new ActOrganizerWorkerLoop({
    worker: {
      runOne: (input) => automaticReviewStore.recoverOneAutomaticReview(input),
    },
    workerId: `act-automatic-review-${process.pid}-${randomUUID()}`,
    clock,
    scheduler: systemWorkerLoopScheduler,
  });
  return {
    start() {
      extractionLoop.start();
      automaticReviewLoop.start();
      organizerLoop.start();
    },
    async close() {
      await Promise.all([
        automaticReviewLoop.close(),
        organizerLoop.close(),
        extractionLoop.close(),
      ]);
    },
  };
}

function combineRuntimes(
  configuredRuntime: ActExtractionRuntime,
  archiveRuntime: ActExtractionRuntime,
): ActExtractionRuntime {
  return {
    start() {
      configuredRuntime.start();
      archiveRuntime.start();
    },
    async close() {
      await Promise.all([archiveRuntime.close(), configuredRuntime.close()]);
    },
  };
}

type SourceClient = HttpActMigrationSourceClient;

function listRelationship(
  source: SourceClient,
  streamType: ActReplacementStreamType,
  parentId: string,
  request: ActPageRequest,
) {
  switch (streamType) {
    case "company_contact":
      return source.listCompaniesForContact(parentId, request);
    case "opportunity_company":
      return source.listCompaniesForOpportunity(parentId, request);
    case "opportunity_contact":
      return source.listContactsForOpportunity(parentId, request);
    case "group_contact":
      return source.listContactsForGroup(parentId, request);
    case "activity_contact":
      return source.listContactsForActivity(parentId, request);
    case "activity_company":
      return source.listCompaniesForActivity(parentId, request);
    case "activity_opportunity":
      return source.listRelated({ parentKind: "activity", parentId, targetKind: "opportunity", request });
    case "note_contact":
      return source.listContactsForNote(parentId, request);
    case "note_company":
      return source.listCompaniesForNote(parentId, request);
    case "note_opportunity":
      return source.listRelated({ parentKind: "note", parentId, targetKind: "opportunity", request });
    case "history_contact":
      return source.listContactsForHistory(parentId, request);
    case "history_company":
      return source.listCompaniesForHistory(parentId, request);
    case "history_opportunity":
      return source.listRelated({ parentKind: "history", parentId, targetKind: "opportunity", request });
    default:
      throw new Error("Act relationship checkpoint is invalid.");
  }
}
